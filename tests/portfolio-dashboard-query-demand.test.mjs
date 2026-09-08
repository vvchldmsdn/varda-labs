import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherAccountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc";
const assetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherAssetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccd";
const scope = { kind: "all", key: "all", label: "All" };
const tenantContext = { ownerUserId: ownerId };
const emptyDetail = { ticker: null, market: null, holdingAccount: null };
const selectedDetail = { ticker: "QQQ", market: "us", holdingAccount: "brokerage" };
const baseAsset = { id: assetId, accountId, account: "brokerage", ticker: "QQQ", name: "QQQ", market: "us", currency: "USD", assetType: "etf", legacyBase44Id: null, quantity: "10", averageCost: "100", currentPrice: "110", fractionalKrwValue: "0", fractionalAvgCost: null, groupId: null, targetWeight: "50" };
const assets = [baseAsset, { ...baseAsset, id: otherAssetId, accountId: otherAccountId, account: "isa" }];
const event = { id: "event-fixture", assetId, accountId, account: "brokerage", ticker: "QQQ", eventDate: "2025-01-02", eventType: "sell", amountKrw: "154000", quantityDelta: "-1", beforeValue: { average_cost: 100, quantity: 11, currency: "USD" }, afterValue: { average_cost: 100, quantity: 10, currency: "USD" }, price: "110", fxRate: "1400", isSample: false };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture({ settingsGate, eventsGate, targets, assetRows = assets, baselineRows = [], liveRows = [], eventRows = [event] } = {}) {
  const trace = [];
  const fxLimits = [];
  const dialect = new PgDialect();
  const db = { select(projection) {
    const request = { projection, joins: [], limit: null, table: null, predicate: null };
    const builder = {
      from(table) { request.table = getTableName(table); return builder; },
      innerJoin(table, predicate) { request.joins.push({ table: getTableName(table), predicate: dialect.sqlToQuery(predicate) }); return builder; },
      where(predicate) { request.predicate = dialect.sqlToQuery(predicate); return builder; },
      orderBy() { return builder; },
      limit(value) { request.limit = value; return builder; },
      then(resolve, reject) {
        trace.push(request);
        let rows = [];
        if (request.table === "accounts") rows = [{ id: accountId, code: "brokerage", name: "Brokerage" }, { id: otherAccountId, code: "isa", name: "ISA" }];
        if (request.table === "assets") rows = assetRows;
        if (request.table === "daily_position_snapshots" && request.projection?.id) rows = baselineRows;
        if (request.table === "live_price_quotes") rows = liveRows;
        if (request.projection?.count) rows = [{ count: 0 }];
        if (request.table === "event_ledger_entries") rows = eventRows;
        const gate = request.table === "event_ledger_entries" ? eventsGate?.promise : undefined;
        return Promise.resolve(gate).then(() => rows).then(resolve, reject);
      },
    };
    return builder;
  } };
  const [query, model] = await importWithPorts([
    "src/db/queries/portfolio-dashboard.ts", "src/lib/portfolio-dashboard.ts",
  ], {
    "@/db/client": { db },
    "@/db/queries/portfolio-analysis-scope-targets": { getPortfolioAnalysisScopeTargets: async () => targets ?? ({ includesAllOwnedAccounts: true, wholeAccountIds: [], directAssetIds: [] }) },
    "@/db/queries/tenant-group-reads": { loadActiveTenantAllocationGroups: async () => [] },
    "@/db/queries/tenant-settings": { loadLatestTenantPortfolioSettingsRows: async () => { await settingsGate?.promise; return [{ usdKrwRate: "1400" }]; } },
    "@/db/queries/portfolio-fx-rates": { loadUsablePortfolioFxRows: async (limit) => { fxLimits.push(limit); return [{ rateDate: "2026-09-08", usdKrw: "1400", status: "ok", isSample: false }]; } },
  });
  const read = (demand) => query.getReadOnlyTenantPortfolioDashboardSources({ scope, serviceDate: "2026-09-08", tenantContext, demand });
  return { read, trace, fxLimits, model };
}

const historicalPositionReads = (trace) => trace.filter((request) => request.table === "daily_position_snapshots" && request.limit !== null);

describe("dashboard query demand and independent market reads", () => {
  it("starts quote reads after assets even while settings and then the ledger remain pending", async () => {
    const settingsGate = deferred();
    const eventsGate = deferred();
    const f = await fixture({ settingsGate, eventsGate });
    const pending = f.read();
    await new Promise(setImmediate);
    assert.ok(f.trace.some((entry) => entry.table === "live_price_quotes"));
    assert.ok(f.trace.some((entry) => entry.table === "asset_price_snapshots"));
    assert.equal(f.trace.some((entry) => entry.table === "event_ledger_entries"), false);
    settingsGate.resolve();
    await new Promise(setImmediate);
    assert.ok(f.trace.some((entry) => entry.table === "event_ledger_entries"));
    eventsGate.resolve();
    await pending;
    assert.equal(f.trace.filter((entry) => entry.table === "live_price_quotes").length, 1);
  });

  it("omits unused Today history while retaining baseline, latest FX and uncapped cost/trade ledger", async () => {
    const f = await fixture();
    const result = await f.read({ surface: "today", holdingDetail: emptyDetail });
    assert.deepEqual(result.historyAssetIds, []);
    assert.deepEqual(result.recentPositionRows, []);
    assert.deepEqual(result.recentPortfolioRows, []);
    assert.equal(historicalPositionReads(f.trace).length, 0);
    assert.equal(f.trace.filter((entry) => entry.table === "daily_portfolio_snapshots").length, 0);
    assert.deepEqual(f.fxLimits, [1]);
    const baseline = f.trace.find((entry) => entry.table === "daily_position_snapshots" && entry.projection?.id);
    assert.ok(baseline);
    assert.equal(baseline.limit, null);
    const ledger = f.trace.find((entry) => entry.table === "event_ledger_entries");
    assert.equal(ledger.limit, null);
    assert.deepEqual(result.eventRows, [event]);
    assert.match(ledger.predicate.sql, /canonical_owner_user_id/);
    assert.ok(ledger.predicate.params.includes(ownerId));
  });

  it("queries only the uniquely selected scoped UUID and carries snapshot cutoff metadata", async () => {
    const f = await fixture();
    const result = await f.read({ surface: "today", holdingDetail: selectedDetail });
    assert.deepEqual(result.historyAssetIds, [assetId]);
    const [history] = historicalPositionReads(f.trace);
    assert.equal(historicalPositionReads(f.trace).length, 1);
    assert.ok(history.projection.cycleEndAt);
    assert.equal(history.limit, 45 * 3);
    assert.match(history.predicate.sql, /"asset_id" in/);
    assert.ok(history.predicate.params.includes(assetId));
    assert.equal(history.predicate.params.includes(otherAssetId), false);
    assert.ok(history.predicate.params.includes(ownerId));
    assert.match(history.predicate.sql, /"daily_position_snapshots"\."account" = "accounts"\."code"/);
    assert.equal(history.joins[0].table, "accounts");
  });

  for (const detail of [
    { ticker: "QQQ", market: "us", holdingAccount: null },
    { ticker: "OTHER", market: "us", holdingAccount: "brokerage" },
    { ticker: "QQQ", market: "us", holdingAccount: "foreign-account" },
  ]) {
    it(`does not read holding history for an ambiguous or outside-scope selector ${JSON.stringify(detail)}`, async () => {
      const f = await fixture();
      const result = await f.read({ surface: "today", holdingDetail: detail });
      assert.deepEqual(result.historyAssetIds, []);
      assert.equal(historicalPositionReads(f.trace).length, 0);
    });
  }

  it("retains Home history reads and FX trend demand", async () => {
    const f = await fixture();
    const result = await f.read();
    assert.deepEqual(result.historyAssetIds, [assetId, otherAssetId]);
    assert.equal(historicalPositionReads(f.trace).length, 1);
    assert.equal(f.trace.filter((entry) => entry.table === "daily_portfolio_snapshots").length, 1);
    assert.deepEqual(f.fxLimits, [260]);
  });

  it("keeps group/account authorization around a selected history UUID", async () => {
    const f = await fixture({ targets: { includesAllOwnedAccounts: false, wholeAccountIds: [], directAssetIds: [assetId] }, assetRows: [baseAsset] });
    await f.read({ surface: "today", holdingDetail: selectedDetail });
    const [history] = historicalPositionReads(f.trace);
    assert.ok(history.predicate.params.includes(ownerId));
    assert.equal(history.predicate.params.filter((param) => param === assetId).length, 2);
    const ledger = f.trace.find((entry) => entry.table === "event_ledger_entries");
    assert.ok(ledger.predicate.params.includes(assetId));
    assert.equal(ledger.limit, null);
  });

  it("keeps identical valuation, realized cost and intraday trade attribution while projecting only selected history", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T01:00:00Z") });
    const f = await fixture({
      assetRows: [{ ...baseAsset, quantity: "11" }, assets[1]],
      baselineRows: assets.map((asset) => ({ id: `snapshot-${asset.id}`, snapshotDate: "2026-09-08", assetId: asset.id, legacyAssetId: null, account: asset.account,
        ticker: "QQQ", assetName: "QQQ", assetType: "etf", currency: "USD", quantity: "10", unitPrice: "100", marketValueKrw: "1400000", fxRate: "1400" })),
      liveRows: [{ ticker: "QQQ", market: "us", currency: "USD", price: "110", status: "ok", quoteType: "live", fetchedAt: new Date("2026-09-08T01:00:00Z") }],
      eventRows: [event, { ...event, id: "buy-today", eventDate: "2026-09-08", eventType: "buy", quantityDelta: "1", beforeValue: {}, afterValue: {} }],
    });
    const args = { analysisScopes: [scope], scope, tenantContext };
    const home = await f.model.getPortfolioDashboard(args);
    const today = await f.model.getPortfolioDashboard({ ...args, demand: { surface: "today", holdingDetail: selectedDetail } });
    assert.deepEqual(today.holdings, home.holdings);
    assert.deepEqual(today.todayMovement, home.todayMovement);
    for (const key of ["totalValueKrw", "costBasisKrw", "realizedCostBasisKrw", "realizedPnlKrw", "totalPnlKrw", "totalReturnPct"]) assert.equal(today[key], home[key], key);
    assert.equal(today.dataHealth.eventLedgerCount, 2);
    assert.equal(today.todayMovement.ready, true);
    assert.equal(today.todayMovement.changeKrw, 280000);
    assert.equal(today.todayMovement.tradeFlowKrw, 154000);
    assert.equal(today.todayMovement.priceChangeKrw, 280000);
    assert.equal(today.todayMovement.fxChangeKrw, 0);
    assert.equal(today.realizedPnlKrw, 14000);
    assert.equal(today.realizedCostBasisKrw, 140000);
    assert.deepEqual(today.holdingHistory.rows.map((row) => row.holdingId), [assetId]);
    assert.equal(home.holdingHistory.rows.length, 2);
    assert.deepEqual(today.fxTrend, []);
    assert.deepEqual(today.recentSnapshots, []);
    assert.deepEqual(today.eventActivity, []);
    assert.equal(home.eventActivity.length, 2);
  });
});
