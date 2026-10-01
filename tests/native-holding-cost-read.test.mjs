import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { applyNativeEvent, createNativePortfolioState } from "../src/lib/native-portfolio-ledger.ts";
import { projectNativeHoldingCosts, projectNativeLegacyTrade } from "../src/lib/native-legacy-trade-projection.ts";
import { buildReturnMetricsSummary } from "../src/lib/portfolio-return-metrics-core.ts";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";
const start = "2026-05-01T00:00:00Z";
const at = "2026-05-02T00:00:00Z";
const lot = { amount: "1000", currency: "KRW", at: start, source: "user_native_ledger", remaining: { n: "1", d: "1" } };
const asset = { id: assetId, legacyBase44Id: null, account: "brokerage", ticker: "SYN", name: "Synthetic", currency: "KRW", quantity: "20", averageCost: "100", currentPrice: "50", fractionalAvgCost: null };
function opening(costLots = [lot]) {
  const result = createNativePortfolioState({ accountId, at: start, cash: { KRW: "10000", USD: "0" }, positions: [{ assetId, currency: "KRW", quantity: "10", costLots }] });
  assert.equal(result.ok, true);
  return result.state;
}
function costs(state, asOf = null) {
  return projectNativeHoldingCosts({ accountId, account: "brokerage", state, assets: [{ id: assetId, currency: "KRW" }], asOf });
}
function metric(events, holding, evidence, extra = {}) {
  return [...buildReturnMetricsSummary(events, [holding], 1500, { nativeHoldingCosts: evidence, ...extra }).metricsByAssetKey.values()][0];
}

it("keeps original KRW cost through a split without generating a trade", () => {
  const split = applyNativeEvent(opening(), { id: "split", sequence: 1, source: "user_native_ledger", at, type: "split", assetId, ratio: { n: "2", d: "1" } });
  assert.equal(split.ok, true);
  assert.equal(split.next.positions[0].quantity, "20");
  const result = metric([], asset, costs(split.next));
  assert.equal(result.costBasisKrw, 1000, "20 shares after a 2:1 split still cost 1000, not 20 x old average100");
  assert.equal(result.nativeCostBasis, true);
  assert.equal(result.missingCost, false);
  assert.equal(result.realizedPnlKrw, 0);
});

it("uses completed acquisition cost instead of the older unknown buy-state cost", () => {
  const buyEvent = { id: "buy", sequence: 1, source: "user_native_ledger", at, type: "buy", assetId, currency: "KRW", quantity: "1", price: "100" };
  const buy = applyNativeEvent(opening(null), buyEvent);
  assert.equal(buy.ok, true);
  const completion = applyNativeEvent(buy.next, { id: "basis", sequence: 2, source: "user_native_ledger", at: "2026-05-03T00:00:00Z", type: "cost_basis", assetId, costLots: [{ ...lot, amount: "1100" }] });
  assert.equal(completion.ok, true);
  const trade = projectNativeLegacyTrade({ id: "buy", accountId, recordedAt: at, data: { event: buyEvent, state: buy.next, effect: buy } }, { id: accountId, code: "brokerage", assets: [{ id: assetId, name: "Synthetic" }] });
  assert.equal(trade.nativeRemainingCostKrw, null);
  const result = metric([trade], { ...asset, quantity: "11" }, costs(completion.next));
  assert.equal(result.costBasisKrw, 1100);
  assert.equal(result.missingCost, false);
  assert.equal(result.realizedCostBasisKrw, 0);
});

it("does not convert unknown or foreign native acquisition cost using current FX", () => {
  for (const state of [opening(null), opening([{ ...lot, currency: "USD", amount: "100" }])]) {
    const result = metric([], { ...asset, quantity: "10" }, costs(state));
    assert.equal(result.costBasisKrw, null);
    assert.equal(result.missingCost, true);
  }
  const mismatch = metric([], asset, costs(opening()));
  assert.equal(mismatch.costBasisKrw, null, "a concurrent quantity change cannot borrow another state's cost");
});

it("does not replace historical cost with current evidence or another account's evidence", () => {
  const current = costs(opening([{ ...lot, amount: "700" }]));
  const historical = { ...asset, quantity: "10" };
  assert.equal(metric([], historical, current, { asOfDate: "2026-05-02" }).costBasisKrw, 1000);
  assert.equal(metric([], historical, current.map(row => ({ ...row, account: "other" }))).costBasisKrw, 1000);
  assert.equal(metric([], historical, costs(opening([{ ...lot, amount: "700" }]), "2026-05-01T22:00:00Z"), { asOfDate: "2026-05-02" }).costBasisKrw, 700);
});

it("reads only owned current state and the effective state before the requested cutoff", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table accounts(id uuid,canonical_owner_user_id uuid,code text,is_active boolean,native_state jsonb);
      create table assets(id uuid,account_id uuid,canonical_owner_user_id uuid,currency text);
      create table effective_native_ledger_entries(account_id uuid,canonical_owner_user_id uuid,native_data jsonb,native_sequence integer);`);
    const early = opening([{ ...lot, amount: "700" }]);
    const late = { ...opening(), at, sequence: 1 };
    await pg.query("insert into accounts values($1,$2,'brokerage',true,$3)", [accountId, owner, JSON.stringify(late)]);
    await pg.query("insert into assets values($1,$2,$3,'KRW')", [assetId, accountId, owner]);
    await pg.query("insert into assets values('33333333-3333-4333-8333-333333333333',$1,$2,'KRW')", [accountId, other]);
    for (const state of [early, late]) await pg.query("insert into effective_native_ledger_entries values($1,$2,$3,$4)", [accountId, owner, JSON.stringify({ state, event: { at: state.at } }), state.sequence]);
    // A foreign row cannot outrank the owner's effective state at this cutoff.
    await pg.query("insert into effective_native_ledger_entries values($1,$2,$3,99)", [accountId, other, JSON.stringify({ state: late, event: { at: start } })]);
    const sql = { transaction: async build => {
      const queries = build({ query: (text, params) => ({ text, params }) });
      const rows = [];
      for (const query of queries) rows.push((await pg.query(query.text, query.params)).rows);
      return rows;
    } };
    const [module] = await importWithPorts(["src/db/queries/native-legacy-trades.ts"], { "@/db/tenant-client": { getTenantSqlClient: () => sql } });
    const current = await module.loadNativeHoldingCosts({ ownerUserId: owner });
    assert.equal(current.length, 1);
    assert.equal(current[0].costKrw, "1000");
    const before = await module.loadNativeHoldingCosts({ ownerUserId: owner }, { asOf: new Date(at) });
    assert.equal(before[0].costKrw, "700", "an event exactly at the cutoff is excluded");
    assert.equal(before[0].asOf, "2026-05-02T00:00:00.000Z");
    const inclusive = await module.loadNativeHoldingCosts({ ownerUserId: owner }, { asOf: new Date(at), boundary: "inclusive" });
    assert.equal(inclusive[0].costKrw, "1000", "execution valuation includes the state exactly at its observation instant");
    assert.equal(inclusive[0].stateAt, at);
    assert.deepEqual(await module.loadNativeHoldingCosts({ ownerUserId: other }), []);
    assert.deepEqual(await module.loadNativeHoldingCosts({ ownerUserId: owner }, { asOf: new Date(start) }), [], "pre-opening legacy history is not replaced by a later native state");
    await pg.exec(`alter table accounts add column name text default 'Synthetic', add column sort_order integer default 0;
      alter table assets add column name text default 'Synthetic', add column ticker text default 'SYN', add column legacy_base44_id text;
      alter table effective_native_ledger_entries add column id uuid default gen_random_uuid(), add column recorded_at timestamptz default '2026-05-03T01:00:00Z';`);
    for (const tradeAt of [at, "2026-05-03T00:00:00Z"]) {
      const event = { type: "buy", at: tradeAt, assetId, currency: "KRW", quantity: "1", price: "100" };
      await pg.query("insert into effective_native_ledger_entries(account_id,canonical_owner_user_id,native_data,native_sequence) values($1,$2,$3,2)", [accountId, owner, JSON.stringify({ state: { ...late, at: tradeAt }, event })]);
    }
    const beforeTrades = await module.loadNativeLegacyTrades({ ownerUserId: owner }, { asOf: new Date("2026-05-03T00:00:00Z") });
    assert.equal(beforeTrades.length, 1);
    assert.equal(beforeTrades[0].nativeData.event.at, at, "a trade exactly at the valuation cutoff cannot leak into earlier metrics");
    const inclusiveTrades = await module.loadNativeLegacyTrades({ ownerUserId: owner }, { asOf: new Date("2026-05-03T00:00:00Z"), boundary: "inclusive" });
    assert.equal(inclusiveTrades.length, 2, "execution valuation explicitly admits the trade at that same instant");
  } finally { await pg.close(); }
});
