import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCurrentAllocationStartingWeights,
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
  value,
  ticker = "069500",
}) {
  return Object.freeze({
    accountCode: accountId === ACCOUNT_A ? "brokerage" : "second",
    accountId,
    accountName: accountId === ACCOUNT_A ? "증권" : "두 번째 계좌",
    assetId,
    assetName: ticker ?? "금현물",
    market: "korea",
    currency: "KRW",
    ticker,
    currentValueKrw: value,
  });
}
