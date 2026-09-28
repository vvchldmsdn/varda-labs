import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCurrentAllocationStartingWeights,
  preservePortfolioTargetDraft,
  buildPortfolioTargetPolicyRecord,
  createPortfolioTargetUniverseHash,
  normalizePortfolioTargetUniverse,
  parseTargetWeightPercent,
  serializePortfolioTargetPolicyRows,
} from "../src/lib/portfolio-target-policy.ts";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const ASSET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const allScope = Object.freeze({ kind: "all", key: "all", label: "전체" });

describe("portfolio target policy", () => {
  it("retains explicit zero and prior intent after new holdings without assigning new targets", () => {
    const universe = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 600, ticker: "AAA" }),
      holding({ accountId: ACCOUNT_A, assetId: ASSET_B, value: 300, ticker: "BBB" }),
      holding({ accountId: ACCOUNT_B, assetId: ASSET_C, value: 100, ticker: "AAA" }),
    ]).rows;
    const previous = universe.slice(0, 2).map((row, i) => ({ ...row, targetWeightBps: i === 0 ? 0 : 10_000 }));
    const draft = preservePortfolioTargetDraft(universe, previous);
    assert.equal(draft.get(ASSET_A), 0);
    assert.equal(draft.get(ASSET_B), 10_000);
    assert.equal(draft.get(ASSET_C), null, "same ticker in another account never inherits an intent");
    assert.equal(preservePortfolioTargetDraft([{...universe[0], currency: "USD"}], previous).get(ASSET_A), null);
    assert.equal(preservePortfolioTargetDraft(universe, [...previous, previous[0]]).get(ASSET_A), null);
  });
  it("uses account and asset identity when the same ticker exists in two accounts", () => {
    const universe = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_B, assetId: ASSET_B, value: 400, ticker: "VOO" }),
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 600, ticker: "VOO" }),
    ]);

    assert.equal(universe.status, "ready");
    assert.deepEqual(
      universe.rows.map((row) => [row.accountId, row.assetId, row.ticker]),
      [
        [ACCOUNT_A, ASSET_A, "VOO"],
        [ACCOUNT_B, ASSET_B, "VOO"],
      ],
    );

    const record = buildPortfolioTargetPolicyRecord({
      decisions: [
        { assetId: ASSET_A, targetWeightBps: 6_000 },
        { assetId: ASSET_B, targetWeightBps: 4_000 },
      ],
      effectiveServiceDate: "2026-08-13",
      scope: allScope,
      universe: universe.rows,
    });
    assert.equal(record.status, "ready");
    assert.match(record.universeHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(record.vectorHash, /^sha256:[0-9a-f]{64}$/);
  });

  it("preserves an explicit zero row for an asset that is not buyable", () => {
    const universe = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 1_000 }),
      holding({
        accountId: ACCOUNT_A,
        assetId: ASSET_C,
        assetName: "Fount",
        assetType: "managed_portfolio",
        value: 200,
        ticker: null,
      }),
    ]);
    const accepted = buildPortfolioTargetPolicyRecord({
      decisions: [
        { assetId: ASSET_A, targetWeightBps: 10_000 },
        { assetId: ASSET_C, targetWeightBps: 0 },
      ],
      effectiveServiceDate: "2026-08-13",
      scope: allScope,
      universe: universe.rows,
    });
    const rejected = buildPortfolioTargetPolicyRecord({
      decisions: [
        { assetId: ASSET_A, targetWeightBps: 9_000 },
        { assetId: ASSET_C, targetWeightBps: 1_000 },
      ],
      effectiveServiceDate: "2026-08-13",
      scope: allScope,
      universe: universe.rows,
    });

    assert.equal(accepted.status, "ready");
    assert.equal(accepted.rows.find((row) => row.assetId === ASSET_C)?.targetWeightBps, 0);
    assert.equal(rejected.status, "blocked");
    assert.ok(rejected.blockers.includes("positive_target_not_buyable"));
  });

  it("allows the reviewed manual KRX gold holding to have a positive target", () => {
    const universe = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 900 }),
      holding({
        accountId: ACCOUNT_A,
        assetId: ASSET_C,
        assetName: "금현물",
        assetType: "commodity",
        value: 100,
        ticker: null,
      }),
    ]);
    const record = buildPortfolioTargetPolicyRecord({
      decisions: [
        { assetId: ASSET_A, targetWeightBps: 9_000 },
        { assetId: ASSET_C, targetWeightBps: 1_000 },
      ],
      effectiveServiceDate: "2026-08-13",
      scope: allScope,
      universe: universe.rows,
    });

    assert.equal(universe.status, "ready");
    assert.equal(
      universe.rows.find((row) => row.assetId === ASSET_C)?.buyability,
      "buyable",
    );
    assert.equal(record.status, "ready");
    assert.equal(
      record.rows.find((row) => row.assetId === ASSET_C)?.targetWeightBps,
      1_000,
    );
  });

  it("builds deterministic hashes and exact current-allocation starting weights", () => {
    const forward = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 2 }),
      holding({ accountId: ACCOUNT_B, assetId: ASSET_B, value: 1 }),
    ]);
    const reverse = normalizePortfolioTargetUniverse([
      holding({ accountId: ACCOUNT_B, assetId: ASSET_B, value: 1 }),
      holding({ accountId: ACCOUNT_A, assetId: ASSET_A, value: 2 }),
    ]);

    assert.equal(
      createPortfolioTargetUniverseHash({ scope: allScope, universe: forward.rows }),
      createPortfolioTargetUniverseHash({ scope: allScope, universe: reverse.rows }),
    );
    const weights = buildCurrentAllocationStartingWeights(forward.rows);
    assert.equal([...weights.values()].reduce((sum, value) => sum + value, 0), 10_000);
    assert.deepEqual([weights.get(ASSET_A), weights.get(ASSET_B)], [6_667, 3_333]);
  });

  it("parses percent input to exact basis points", () => {
    assert.equal(parseTargetWeightPercent("35"), 3_500);
    assert.equal(parseTargetWeightPercent("12.34"), 1_234);
    assert.equal(parseTargetWeightPercent("100.01"), null);
    assert.equal(parseTargetWeightPercent("1.234"), null);
  });

  it("serializes persistence rows with the exact PostgreSQL record keys", () => {
    const rows = JSON.parse(
      serializePortfolioTargetPolicyRows([
        {
          accountId: ACCOUNT_A,
          assetId: ASSET_A,
          assetName: "KODEX 200",
          market: "korea",
          currency: "KRW",
          ticker: "069500",
          buyability: "buyable",
          targetWeightBps: 10_000,
        },
      ]),
    );

    assert.deepEqual(rows, [
      {
        account_id: ACCOUNT_A,
        asset_id: ASSET_A,
        asset_name: "KODEX 200",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        buyability: "buyable",
        target_weight_bps: 10_000,
      },
    ]);
    assert.equal("accountId" in rows[0], false);
    assert.equal("targetWeightBps" in rows[0], false);
  });
});

function holding({
  accountId,
  assetId,
  assetName,
  assetType = "etf",
  value,
  ticker = "069500",
}) {
  return Object.freeze({
    accountCode: accountId === ACCOUNT_A ? "brokerage" : "second",
    accountId,
    accountName: accountId === ACCOUNT_A ? "증권" : "두 번째 계좌",
    assetId,
    assetName: assetName ?? ticker ?? "관리형 자산",
    assetType,
    market: "korea",
    currency: "KRW",
    ticker,
    currentValueKrw: value,
  });
}


describe("independent target plan identities",()=>{
  it("retains 0/50/50 intent across first purchase and liquidation without creating holdings",async()=>{
    const {unionTargetPlanRows,targetPlanRowId}=await import("../src/lib/portfolio-target-plan.ts");
    const accounts=[{id:ACCOUNT_A,code:"brokerage",name:"Synthetic"}];
    const a=holding({accountId:ACCOUNT_A,assetId:ASSET_A,value:60,ticker:"AAA"});
    const b=holding({accountId:ACCOUNT_A,assetId:ASSET_B,value:40,ticker:"BBB"});
    const id=targetPlanRowId(ASSET_A,ACCOUNT_A,"korea","KRW","CCC");
    const saved=[{...a,originAssetId:ASSET_A,targetWeightBps:0},{...b,originAssetId:ASSET_B,targetWeightBps:5000},{...a,assetId:id,originAssetId:null,ticker:"CCC",assetName:"Candidate",targetWeightBps:5000}];
    const before=unionTargetPlanRows([a,b],saved,accounts);
    assert.equal(before.length,3);assert.equal(before.reduce((n,r)=>n+r.currentValueKrw,0),100);
    assert.equal(before.find(r=>r.assetId===id).heldAssetId,null);
    const after=unionTargetPlanRows([a,b,{...a,assetId:ASSET_C,ticker:"CCC",currentValueKrw:25}],saved,accounts);
    assert.equal(after.length,3);assert.equal(after.find(r=>r.assetId===id).heldAssetId,ASSET_C);
    const sold=unionTargetPlanRows([a],saved,accounts);
    assert.equal(sold.find(r=>r.assetId===ASSET_B).currentValueKrw,0);
    assert.equal(sold.find(r=>r.assetId===ASSET_B).heldAssetId,null);
    assert.deepEqual(saved.map(r=>r.targetWeightBps),[0,5000,5000]);
    assert.throws(()=>unionTargetPlanRows([a,a],saved,accounts),/ambiguous_holding/);
    assert.throws(()=>unionTargetPlanRows([],saved,[]),/target_account/);
    assert.notEqual(targetPlanRowId(ASSET_A,ACCOUNT_B,"korea","KRW","CCC"),id);
    const record=buildPortfolioTargetPolicyRecord({scope:allScope,effectiveServiceDate:"2026-09-29",policyVersion:"portfolio_target_policy_v2",universe:normalizePortfolioTargetUniverse(before).rows,decisions:saved.map(r=>({assetId:r.assetId,targetWeightBps:r.targetWeightBps}))});
    assert.equal(record.status,"ready");
    const serialized=JSON.parse(serializePortfolioTargetPolicyRows(record.rows,record.policyVersion));
    assert.equal(serialized.find(r=>r.asset_id===id).origin_asset_id,null);
  });
});
