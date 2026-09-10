import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

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

async function fixture({ settingsGate, eventsGate, targets, assetRows = assets, baselineRows = [], liveRows = [], priceRows = [], eventRows = [event] } = {}) {
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
        if (request.table === "asset_price_snapshots") rows = priceRows;
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
  it("withholds a delayed cutoff's multi-day movement at 08:43 while keeping live value and price returns", async (t) => {
    const now = new Date("2026-09-09T23:43:00Z");
    t.mock.timers.enable({ apis: ["Date"], now });
    const koreanAsset = { ...baseAsset, ticker: "069500", name: "KODEX 200", market: "korea", currency: "KRW" };
    const f = await fixture({ assetRows: [koreanAsset], eventRows: [],
      baselineRows: [{ id: "delayed-snapshot", snapshotDate: "2026-09-09", assetId, account: "brokerage", ticker: "069500", assetType: "etf", quantity: "10", unitPrice: "100", marketValueKrw: "1000", fxRate: "1" }],
      liveRows: [{ ticker: "069500", market: "korea", currency: "KRW", price: "110", status: "ok", quoteType: "live", fetchedAt: now, priceAsOf: now }],
      priceRows: ["2026-09-08", "2026-09-09"].map(priceDate => ({ ticker: "069500", market: "korea", currency: "KRW", priceDate, closePrice: priceDate === "2026-09-09" ? "110" : "100", fxRate: "1" })),
    });
    const args = { analysisScopes: [scope], scope, tenantContext };
    const home = await f.model.getPortfolioDashboard(args);
    const today = await f.model.getPortfolioDashboard({ ...args, demand: { surface: "today", holdingDetail: emptyDetail } });
    assert.equal(home.totalValueKrw, 1100, "the current valuation is never replaced or cleared");
    assert.equal(home.movementBaselineDate, "2026-09-08", "keep the last historical baseline explicit");
    assert.equal(home.dataHealth.latestSnapshotPositions, 1);
    assert.equal(home.todayMovement.ready, false);
    assert.equal(home.todayMovement.reason, "stale_baseline_snapshot");
    assert.equal(home.dataHealth.movementReason, "stale_baseline_snapshot");
    for (const key of ["todayChangeKrw", "todayReturnPct", "todayFxChangeKrw"]) assert.equal(home[key], null, key);
    for (const key of ["changeKrw", "priceChangeKrw", "fxChangeKrw", "returnPct", "scopePreviousTotalKrw", "scopeCurrentTotalKrw"]) assert.equal(home.todayMovement[key], null, key);
    assert.deepEqual(home.todayMovement.contributionRows, []);
    assert.deepEqual(home.topMovers, []);
    assert.equal(home.holdings[0].dailyChangeKrw, null);
    assert.equal(home.holdings[0].dailyReturnPct, null);
    assert.deepEqual(home.todayMovement.exclusions.map(row => row.reason), ["stale_baseline_snapshot"]);
    assert.deepEqual(today.todayMovement, home.todayMovement);
    const cell = home.holdingHistory.rows[0].cells.at(-1);
    assert.equal(cell.date, "2026-09-10");
    assert.equal(cell.changePct, 0, "the separately evidenced unchanged unit price stays available");
    assert.equal(cell.marketValueKrw, 1100);
    assert.equal(cell.changeKrw, null, "the stale portfolio movement cannot leak into today's heatmap detail");

    const [{ PortfolioDashboard }, { TodayMovement }, { LocaleProvider }] = await importUiWithPorts([
      "src/components/portfolio-dashboard.tsx", "src/components/today-movement.tsx", "src/components/i18n/locale-provider.tsx",
    ], {
      "next/navigation": { usePathname: () => "/", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh() { throw new Error("SSR must not refresh"); } }) },
      "next/link": { default: ({ children, ...props }) => createElement("a", Object.fromEntries(Object.entries(props).filter(([name]) => !["prefetch", "scroll"].includes(name))), children), useLinkStatus: () => ({ pending: false }) },
      "next/image": { default: props => createElement("img", Object.fromEntries(Object.entries(props).filter(([name]) => name !== "priority"))) },
    });
    for (const [initialLocale, pendingLabel, baselineLabel] of [["ko", "07:00 KST 기준 기록 준비 중", "마지막 기준일"], ["en", "Awaiting the 07:00 KST baseline", "Last baseline"]]) {
      for (const component of [PortfolioDashboard, TodayMovement]) {
        const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale }, createElement(component, { data: home })));
        const summary = html.match(/<section class="stageSummary"[\s\S]*?<\/section>/)?.[0];
        assert.ok(summary?.includes(pendingLabel), `${component.name}/${initialLocale}: cutoff delay appears in the primary content`);
        assert.ok(summary.includes(baselineLabel), `${component.name}/${initialLocale}: the older date is labeled as the last baseline`);
        assert.ok(summary.includes("2026.09.08"));
        assert.ok(summary.includes("stageWarning"), "the notice uses the visible mobile and desktop warning slot");
        assert.doesNotMatch(html, /data-holding-detail-trigger="(?:row|summary)"/, "there are no stale contribution actions");
      }
    }
  });

  for (const scenario of [
    { label: "the new cutoff's unchanged KRW prices", now: "2026-09-09T23:43:00Z", snapshotDate: "2026-09-10", currency: "KRW", fxRate: "1", expectedFx: 0 },
    { label: "FX-only movement with a current cutoff", now: "2026-09-09T23:43:00Z", snapshotDate: "2026-09-10", currency: "USD", fxRate: "1399", expectedFx: 1100 },
    { label: "the existing cycle immediately before 07:00", now: "2026-09-09T21:59:59Z", snapshotDate: "2026-09-09", currency: "KRW", fxRate: "1", expectedFx: 0 },
  ]) {
    it(`preserves ${scenario.label}`, async (t) => {
      const now = new Date(scenario.now);
      t.mock.timers.enable({ apis: ["Date"], now });
      const instrument = { ticker: scenario.currency === "USD" ? "QQQ" : "069500", market: scenario.currency === "USD" ? "us" : "korea", currency: scenario.currency };
      const f = await fixture({ assetRows: [{ ...baseAsset, ...instrument }], eventRows: [],
        baselineRows: [{ id: "current-snapshot", snapshotDate: scenario.snapshotDate, assetId, account: "brokerage", ...instrument, assetType: "etf", quantity: "10", unitPrice: "110", marketValueKrw: String(1100 * Number(scenario.fxRate)), fxRate: scenario.fxRate }],
        liveRows: [{ ...instrument, price: "110", status: "ok", quoteType: "live", fetchedAt: now, priceAsOf: now }],
      });
      const home = await f.model.getPortfolioDashboard({ analysisScopes: [scope], scope, tenantContext });
      assert.equal(home.todayMovement.ready, true);
      assert.equal(home.todayMovement.reason, null);
      assert.equal(home.todayMovement.changeKrw, scenario.expectedFx);
      assert.equal(home.todayMovement.priceChangeKrw, 0);
      assert.equal(home.todayMovement.fxChangeKrw, scenario.expectedFx);
      assert.equal(home.todayMovement.contributionRows.length, 1);
    });
  }

  it("connects today's KST heatmap to native price return while preserving separate FX movement", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-08T15:20:00Z") });
    const f = await fixture({ assetRows: [baseAsset], eventRows: [],
      baselineRows: [{ id: "snapshot-fixture", snapshotDate: "2026-09-08", assetId, legacyAssetId: null, account: "brokerage", ticker: "QQQ", assetName: "QQQ", assetType: "etf", currency: "USD", quantity: "10", unitPrice: "100", marketValueKrw: "1000000", fxRate: "1000" }],
      liveRows: [{ ticker: "QQQ", market: "us", currency: "USD", price: "103", status: "ok", quoteType: "live", fetchedAt: new Date("2026-09-08T15:19:30Z"), priceAsOf: new Date("2026-09-08T15:19:00Z") }],
      priceRows: [{ ticker: "QQQ", market: "us", currency: "USD", priceDate: "2026-09-04", closePrice: "100", adjustedClosePrice: "98", fxRate: "1000", closePriceKrw: "100000" }],
    });
    const home = await f.model.getPortfolioDashboard({ analysisScopes: [scope], scope, tenantContext });
    assert.equal(home.holdingHistory.dates.at(-1), "2026-09-09");
    const cell = home.holdingHistory.rows[0].cells.at(-1);
    assert.equal(home.holdings[0].dailyPriceReturn.changePct, 3);
    assert.equal(cell.changePct, 3);
    assert.equal(cell.basis, "live_price");
    assert.equal(cell.changeKrw, 442_000);
    assert.equal(cell.priceChangeKrw, 30_000);
    assert.equal(cell.fxChangeKrw, 412_000);
    assert.equal(home.holdings[0].dailyReturnPct, 44.2);
    assert.equal(home.totalValueKrw, 1_442_000);
  });

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
