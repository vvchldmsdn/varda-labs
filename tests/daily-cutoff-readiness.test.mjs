import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { buildCronMarketCyclePlan } from "../src/lib/cron-market-cycle.ts";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const cutoff = new Date("2026-09-09T22:00:00Z");
const observed = new Date("2026-09-09T21:59:00Z");

describe("daily cutoff readiness through the legacy writer and Cron plan", () => {
  it("price-only and FX-only evidence cannot complete a foreign holding snapshot", async () => {
    const priceOnly=await fixture({close:false});priceOnly.rows.fx_rates.length=0;
    await assert.rejects(priceOnly.run({dryRun:true}),e=>e.code==='missing_fx_rate');
    await assert.rejects(priceOnly.run(),e=>e.code==='missing_fx_rate');assert.equal(priceOnly.writes.length,0);
    const fxOnly=await fixture({live:false,close:false});
    assert.equal((await fxOnly.run({dryRun:true})).writeReady,false);
    await assert.rejects(fxOnly.run(),e=>e.code==='missing_cutoff_price_evidence');assert.equal(fxOnly.writes.length,0);
  });
  it("writes 10 × $105 × 1300 without a separate official close", async () => {
    const f = await fixture({ close: false });
    const preflight = await f.run({ dryRun: true });
    assert.equal(preflight.freshClose.missingCount, 1);
    assert.equal(preflight.cutoffValuation.missing.length, 0);
    assert.equal(preflight.writeReady, true);
    const plan = planFor(preflight);
    assert.equal(plan.action, "write_snapshot");
    assert.equal(plan.closeTargetCount, 0);
    assert.deepEqual(preflight.closeSyncPlan.suggestedKisBatches, []);
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 1365000);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(Number(position.currentPrice), 105);
    assert.equal(Number(position.unitPrice), 105);
    assert.equal(Number(position.unitValueKrw), 136500);
    assert.equal(Number(position.marketValueKrw), 1365000);
    assert.equal(position.closePrice, null);
  });

  it("keeps a fresh execution quote ahead of the official $100 reference", async () => {
    const f = await fixture();
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 1365000);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(Number(position.closePrice), 100);
    assert.equal(position.priceBasis, "cutoff_live");
  });

  it("uses only a verified close fallback, and otherwise requests missing evidence", async () => {
    const fallback = await fixture({ live: false });
    assert.equal((await fallback.run()).results.brokerage.totalMarketValue, 1300000);
    const missing = await fixture({ live: false, close: false });
    const result = await missing.run({ dryRun: true });
    assert.equal(result.writeReady, false);
    assert.equal(result.cutoffValuation.missing.length, 1);
    assert.equal(planFor(result).action, "sync_closes_then_snapshot");
    await assert.rejects(missing.run(), error => error.code === "missing_cutoff_price_evidence");
    assert.equal(missing.writes.length, 0);
  });

  it("admits a quote collected by the actual run even when it is after 07:00", async () => {
    const f = await fixture({ close: false });
    f.rows.live_price_quotes[0].fetchedAt = new Date("2026-09-09T22:20:00Z");
    f.rows.live_price_quotes[0].priceAsOf = new Date("2026-09-09T22:20:00Z");
    const result = await f.run({ dryRun: true });
    assert.equal(result.writeReady, true);
    assert.equal(result.cutoffValuation.missing.length, 0);
    const saved = await f.run();
    assert.equal(saved.cycle.cycleEndAt, "2026-09-09T22:20:00.000Z");
    assert.equal(saved.cutoffValuation.policy, "execution_quote_else_exact_official_close");
  });

  it("uses execution prices and FX instead of retained 07:00 observations", async () => {
    const f = await fixture({ close: false });
    f.retained.quotes.push({ ...f.rows.live_price_quotes[0], priceAsOf: observed, fetchedAt: observed, observedAt: null, timestampBasis: "collection" });
    f.retained.fxRows.push({ ...f.rows.fx_rates[0], providerObservedAt: null, timestampBasis: "collection" });
    Object.assign(f.rows.live_price_quotes[0], { price: "110", priceAsOf: new Date("2026-09-09T22:20:00Z"), fetchedAt: new Date("2026-09-09T22:20:00Z") });
    Object.assign(f.rows.fx_rates[0], { usdKrw: "1310", observedAt: new Date("2026-09-09T22:20:00Z"), fetchedAt: new Date("2026-09-09T22:20:00Z") });
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 1441000);
    assert.equal(planFor(result).closeTargetCount, 0);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.match(position.description, /price_reference_at=2026-09-09T22:20:00.000Z/);
    assert.match(position.description, /fx_reference_at=2026-09-09T22:20:00.000Z/);
    assert.match(position.description, /price_observed_at=unknown/);
    assert.match(position.description, /fx_observed_at=2026-09-09T22:20:00.000Z/);
    assert.match(position.description, /price_timestamp_basis=collection/);
    assert.match(position.description, /fx_timestamp_basis=collection/);
    assert.match(position.description, /(?:^|; )valuation_policy=execution_collection_v1(?:;|$)/);
  });

  it("preserves a completed cutoff on a direct writer retry with changed market evidence", async () => {
    const f = await fixture();
    await f.run();
    for (const write of f.writes) f.rows[write.table] = write.rows.map((row, index) => ({ ...row, id: `${write.table}-${index}` }));
    const saved = JSON.stringify([f.rows.daily_portfolio_snapshots, f.rows.daily_position_snapshots]);
    f.writes.length = 0;
    f.rows.live_price_quotes[0].price = "110";
    f.rows.fx_rates[0].usdKrw = "1310";
    const retry = await f.run({ now: new Date(cutoff.getTime() + 40 * 60_000) });
    assert.equal(f.writes.length, 0);
    assert.equal(retry.results.brokerage.totalMarketValue, 1365000);
    assert.equal(JSON.stringify([f.rows.daily_portfolio_snapshots, f.rows.daily_position_snapshots]), saved);
    assert.equal(retry.plannedWrites.dailyPortfolioSnapshots.update, 0);
    assert.equal(planFor(retry).action, "no_action");
    assert.equal(retry.cycle.cycleEndAt, "2026-09-09T22:20:00.000Z");
    f.rows.fx_rates.length = 0;
    f.rows.live_price_quotes.length = 0;
    f.rows.assets[0].quantity = "20";
    f.rows.assets[0].updatedAt = new Date(cutoff.getTime() + 60000);
    const expiredEvidence = await f.run();
    assert.equal(expiredEvidence.results.brokerage.totalMarketValue, 1365000);
    assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify([f.rows.daily_portfolio_snapshots, f.rows.daily_position_snapshots]), saved);
  });

  it("includes holdings created after 07:00 but before execution without reconstructing an earlier balance", async () => {
    const f = await fixture();
    Object.assign(f.rows.assets[0], { createdAt: new Date(cutoff.getTime() + 5 * 60_000), updatedAt: new Date(cutoff.getTime() + 10 * 60_000), quantity: "12" });
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 1638000);
    assert.equal(result.cycle.cycleEndAt, "2026-09-09T22:20:00.000Z");
  });

  it("rejects prices and holdings that are later than the actual run", async () => {
    const price = await fixture({ close: false });
    Object.assign(price.rows.live_price_quotes[0], { fetchedAt: new Date(cutoff.getTime() + 21 * 60_000), priceAsOf: new Date(cutoff.getTime() + 21 * 60_000) });
    await assert.rejects(price.run(), error => error.code === "missing_cutoff_price_evidence");
    const holding = await fixture();
    holding.rows.assets[0].updatedAt = new Date(cutoff.getTime() + 21 * 60_000);
    await assert.rejects(holding.run(), error => error.code === "holdings_changed_after_cutoff");
  });

  it("uses actual fractional shares and never derives shares from an entered amount", async () => {
    const f = await fixture();
    f.rows.assets[0].quantity = "0.125";
    f.rows.assets[0].fractionalKrwValue = "5000";
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 22062.5);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(Number(position.quantity), 0.125);
    assert.equal(Number(position.totalQuantity), 0.125);
    assert.equal(position.estimatedFractionalQuantity, null);
    assert.equal(Number(position.fractionalKrwValue), 5000);
    assert.match(position.description, /fractional_value_basis=entered_krw_amount/);
  });

  it("saves a KRW-only valuation without inventing a USD/KRW rate of one", async () => {
    const f = await fixture({ close: false });
    Object.assign(f.rows.assets[0], { currency: "KRW", market: "korea" });
    Object.assign(f.rows.live_price_quotes[0], { currency: "KRW", market: "korea", price: "10000" });
    f.rows.fx_rates.length = 0;
    const result = await f.run();
    assert.equal(result.results.brokerage.totalMarketValue, 100000);
    assert.equal(result.fx.usdKrw, null);
    const portfolio = f.writes.find(row => row.table === "daily_portfolio_snapshots").rows[0];
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(portfolio.usdKrw, null);
    assert.equal(portfolio.fxRate, null);
    assert.equal(Number(position.fxRate), 1);
  });

  it("saves a tickerless current manual input without inventing an observed market timestamp", async () => {
    const f = await fixture({ live: false, close: false });
    Object.assign(f.rows.assets[0], { ticker: null, currency: "KRW", currentPrice: "10000", priceAsOf: null, priceFetchedAt: null });
    assert.equal((await f.run({ dryRun: true })).writeReady, true);
    assert.equal((await f.run()).results.brokerage.totalMarketValue, 100000);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(Number(position.quantity), 10);
    assert.equal(Number(position.currentPrice), 10000);
    assert.equal(position.priceBasis, "manual_current");
    assert.match(position.description, /manual_input_recorded_at=2026-09-01T00:00:00.000Z/);
    assert.match(position.description, /price_timestamp_basis=manual_input/);
    assert.match(position.description, /price_observed_at=unknown/);
    assert.match(position.description, /price_fetched_at=unknown/);
  });

  it("keeps explicit manual observation provenance when it is available", async () => {
    const f = await fixture({ live: false, close: false });
    Object.assign(f.rows.assets[0], { ticker: null, currency: "KRW", currentPrice: "10000" });
    Object.assign(f.rows.assets[0], { priceAsOf: "2026-09-09T10:00:00Z", priceSource: "manual_entry", priceQuoteType: "manual_valuation", priceFetchedAt: null });
    assert.equal((await f.run()).results.brokerage.totalMarketValue, 100000);
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.match(position.description, /price_observed_at=2026-09-09T10:00:00.000Z/);
    assert.equal(position.priceBasis, "manual_current");
  });

  it("does not use current manual inputs to reconstruct a historical cutoff without price evidence", async () => {
    const f = await fixture({ live: false, close: false });
    Object.assign(f.rows.assets[0], { ticker: null, currency: "KRW", currentPrice: "10000", priceAsOf: null });
    const historical = await f.run({ dryRun: true, snapshotDate: "2026-09-09" });
    assert.equal(historical.writeReady, false);
    assert.equal(historical.cutoffValuation.missing.length, 1);
    assert.equal(f.writes.length, 0);
  });

  it("rejects a manual input or manual observation timestamp later than execution", async () => {
    const input = await fixture({ live: false, close: false });
    Object.assign(input.rows.assets[0], { ticker: null, currency: "KRW", currentPrice: "10000", priceAsOf: null, updatedAt: "2026-09-09T22:21:00Z" });
    await assert.rejects(input.run(), error => error.code === "holdings_changed_after_cutoff");
    assert.equal(input.writes.length, 0);
    const quote = await fixture({ live: false, close: false });
    Object.assign(quote.rows.assets[0], { ticker: null, currency: "KRW", currentPrice: "10000", priceAsOf: "2026-09-09T22:21:00Z" });
    await assert.rejects(quote.run(), error => error.code === "missing_cutoff_price_evidence");
    assert.equal(quote.writes.length, 0);
  });

  it("does not attribute new shares to price or FX movement without trade evidence", async () => {
    const f = await fixture();
    f.rows.daily_position_snapshots = [{ id: "prior", canonicalOwnerUserId: owner, assetId: "asset-a", account: "brokerage", accountId: "account-a", snapshotDate: "2026-09-09", source: "varda_manual_daily_snapshot", isSample: false,
      quantity: "5", totalQuantity: "5", fractionalKrwValue: "0", unitPrice: "100", fxRate: "1300", marketValueKrw: "650000" }];
    await f.run();
    const position = f.writes.find(row => row.table === "daily_position_snapshots").rows[0];
    assert.equal(Number(position.marketValueChangeKrw), 715000);
    assert.equal(position.priceChangeKrw, null);
    assert.equal(position.fxChangeKrw, null);
    assert.match(position.description, /movement_attribution=holdings_change_without_trade_bridge/);
  });
});

function planFor(result) {
  return buildCronMarketCyclePlan({ kisCooldownActive: false, snapshotJob: { ok: result.ok, writeReady: result.writeReady,
    snapshotDate: result.snapshotDate, targetCount: 1, failedCount: 0,
    targets: [{ status: result.writeReady ? "ready" : "blocked", result }] } });
}

async function fixture({ live = true, close = true } = {}) {
  const asset = { id: "asset-a", canonicalOwnerUserId: owner, legacyBase44Id: null, name: "Synthetic USD", ticker: "TESTUSD", market: "us", currency: "USD", assetType: "stock", category: null,
    account: "brokerage", accountId: "account-a", quantity: "10", currentPrice: "110", averageCost: null,
    fractionalKrwValue: null, fractionalAvgCost: null, groupId: null, targetWeight: null, maAssetClass: null,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };
  const rows = { accounts: [{ id: "account-a", canonicalOwnerUserId: owner, code: "brokerage", name: "Synthetic", accountType: "investment", currency: "USD", isActive: true }], assets: [asset],
    fx_rates: [{ rateDate: "2026-09-09", usdKrw: "1300", source: "synthetic", status: "ok", isSample: false, observedAt: new Date(cutoff.getTime()+19*60_000), fetchedAt: new Date(cutoff.getTime()+19*60_000), rateKind: "spot" }],
    asset_price_snapshots: close ? [{ ticker: asset.ticker, market: asset.market, currency: "USD", priceDate: "2026-09-09", closePrice: "100", source: "kis", isSample: false, fetchedAt: observed }] : [],
    live_price_quotes: live ? [{ ticker: asset.ticker, market: asset.market, currency: "USD", provider: "kis", source: "kis_overseas_price:NAS", quoteType: "live", status: "ok", price: "105", priceAsOf: new Date(cutoff.getTime()+19*60_000), fetchedAt: new Date(cutoff.getTime()+19*60_000) }] : [] };
  const writes = [];
  const select = () => { let table; let condition; const query = { from(value) { table = getTableName(value); return query; }, where(value) { condition = value; return query; }, innerJoin() { return query; }, orderBy() { return query; }, limit() { return query; },
    then(resolve, reject) { let result = rows[table] ?? [];
      if (table.startsWith("daily_") && condition) {
        const sql = new PgDialect().sqlToQuery(condition).sql;
        if (sql.includes('"snapshot_date" <')) result = result.filter(row => row.snapshotDate < "2026-09-10");
        else if (sql.includes('"snapshot_date" =')) result = result.filter(row => row.snapshotDate === "2026-09-10");
      }
      return Promise.resolve(result).then(resolve, reject); } }; return query; };
  const record = (table, values) => { writes.push({ table: getTableName(table), rows: Array.isArray(values) ? values : [values] });
    const q = { where() { return q; }, onConflictDoNothing() { return q; }, toSQL: () => ({ sql: "select 1", params: [] }) }; return q; };
  const retained = { quotes: [], fxRows: [] };
  const [module] = await importWithPorts(["src/lib/snapshots/daily.ts"], { "./holdings-revision-repair": { repairHoldingsSnapshotRevisions: async () => ({status:"ready",repaired:0}) }, "@/db/queries/snapshot-cutoff-observations": { readSnapshotCutoffObservations: async () => retained }, "@/db/client": { sqlClient: { transaction: async build => build({ query: () => [] }) }, db: {
    select, selectDistinct: select, insert: table => ({ values: value => record(table, value) }), update: table => ({ set: value => record(table, value) }) } } });
  return { rows, writes, retained, run: options => module.runDailySnapshot({ tenantContext: { ownerUserId: owner }, now: new Date(cutoff.getTime() + 20 * 60_000), dryRun: false, account: "brokerage", ...options }) };
}
