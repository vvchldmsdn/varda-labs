import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHistoryOverview } from "../src/lib/history-overview.ts";
import { buildPortfolioHistoryDisplayRows } from "../src/lib/history-balance.ts";
import { buildPortfolioGroupHistoryRows } from "../src/lib/history-portfolio-scope.ts";
import { historyPointsWithMetric } from "../src/lib/history-explorer.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const manual = "varda_manual_daily_snapshot";
const raw = (extra = {}) => ({ snapshotDate: "2026-09-11", account: "qa-account", source: manual,
  totalMarketValue: "1150972.9", totalCost: "1157957.1", totalPnl: "-6984.2", totalReturnPct: "-0.603",
  cashValue: null, investedAmount: null, ...extra });
const live = (date = "2026-09-11", valueKrw = 1146699) => ({ state: "ready", date,
  capturedAt: `${date}T06:57:44Z`, valueKrw, holdingCount: 4, excludedHoldingCount: 0,
  freshQuoteCount: 0, recordedPriceCount: 4, oldestPriceAt: null, priceSources: [] });
const display = rows => buildPortfolioHistoryDisplayRows({ rows, account: "qa-account" });

describe("History completed service date", () => {
  it("keeps the first completed day and today's current valuation as two observations", () => {
    const rows = Object.freeze(display([raw()]).map(Object.freeze));
    const before = structuredClone(rows);
    const model = buildHistoryOverview({ rows, liveValuation: live() });
    assert.deepEqual(model.points.map(p => p.date), ["2026-09-10", "2026-09-11"]);
    assert.equal(model.points[0].storageSnapshotDate, "2026-09-11");
    assert.ok(Math.abs(model.points[1].movementKrw - (-4273.9)) < 0.00001);
    assert.equal(model.points[1].gapDays, 1);
    assert.equal(model.points[1].totalReturnPct, null);
    assert.equal(historyPointsWithMetric(model.points, "return").length, 1);
    assert.deepEqual(rows, before);
  });

  it("retains imported and unknown dates and preserves genuine same-date return evidence", () => {
    for (const source of ["base44_import", "unknown_writer", "varda_daily_snapshot_v1"]) {
      const model = buildHistoryOverview({ rows: display([raw({ source })]), liveValuation: live() });
      assert.equal(model.pointCount, 1);
      assert.equal(model.points[0].date, "2026-09-11");
      assert.equal(model.points[0].recordedPoint.storageSnapshotDate, "2026-09-11");
      assert.equal(historyPointsWithMetric(model.points, "return")[0].totalReturnPct, -0.603);
    }
  });

  it("uses calendar service days across year and holiday boundaries, including before 07:00", () => {
    for (const [snapshotDate, expected] of [["2027-01-01", "2026-12-31"], ["2026-09-07", "2026-09-06"]]) {
      const current = { ...live(snapshotDate), capturedAt: `${expected}T21:00:00Z` };
      const model = buildHistoryOverview({ rows: display([raw({ snapshotDate })]), liveValuation: current });
      assert.deepEqual(model.points.map(p => p.date), [expected, snapshotDate]);
      assert.equal(model.points[0].storageSnapshotDate, snapshotDate);
    }
    const model = buildHistoryOverview({ rows: display([raw()]), events: [{ eventDate: "2026-09-10", eventType: "buy", assetName: "Fixture", accountName: null, amountKrw: 1, quantityDelta: 1 }] });
    assert.equal(model.points[0].events.length, 1);
  });

  it("retains storage-day group membership while giving account, total, and group the same display date", () => {
    const rows = [raw({ totalMarketValue: "700", account: "one" }), raw({ totalMarketValue: "400", account: "two" })];
    const all = buildPortfolioHistoryDisplayRows({ rows, account: "all", expectedAccounts: ["one", "two"] });
    const account = buildPortfolioHistoryDisplayRows({ rows, account: "one" });
    const positions = rows.map((r, i) => ({ snapshotDate: r.snapshotDate, source: r.source, account: r.account,
      accountId: r.account, assetId: `asset-${i}`, marketValueKrw: r.totalMarketValue, costKrw: "600", pnlKrw: "100" }));
    const group = buildPortfolioGroupHistoryRows({ rows: positions, scopeKey: "portfolio:qa",
      accountMemberships: [{ targetId: "one", validFrom: "2026-09-11", validTo: null }, { targetId: "two", validFrom: "2026-09-10", validTo: "2026-09-11" }], assetMemberships: [] });
    assert.equal(group[0].totalMarketValue, "700");
    assert.equal(group[0].snapshotDate, "2026-09-11");
    const groupDisplay = buildPortfolioHistoryDisplayRows({ rows: group, account: "portfolio:qa" });
    for (const candidate of [account, all, groupDisplay]) {
      const model = buildHistoryOverview({ rows: candidate });
      assert.equal(model.points[0].date, "2026-09-10");
      assert.equal(model.points[0].storageSnapshotDate, "2026-09-11");
    }
    assert.equal(all[0].totalMarketValue, 1100);
  });

  it("does not put conflicting aggregate dates or invalid dates on the chart", () => {
    const rows = [raw({ account: "one", valuationDate: "2026-09-10" }), raw({ account: "two", valuationDate: "2026-09-09" })];
    const all = buildPortfolioHistoryDisplayRows({ rows, account: "all", expectedAccounts: ["one", "two"] });
    assert.equal(all[0].valuationDate, null);
    assert.equal(all[0].totalMarketValue, 2301945.8);
    assert.equal(buildHistoryOverview({ rows: all }).pointCount, 0);
    const group = buildPortfolioGroupHistoryRows({
      scopeKey: "portfolio:qa", accountMemberships: [],
      assetMemberships: [{ targetId: "one", validFrom: "2026-09-10", validTo: null }, { targetId: "two", validFrom: "2026-09-10", validTo: null }],
      rows: rows.map(r => ({ ...r, assetId: r.account, accountId: null, marketValueKrw: r.totalMarketValue, costKrw: r.totalCost, pnlKrw: r.totalPnl })),
    });
    assert.equal(group[0].valuationDate, null);
    assert.equal(group[0].snapshotDate, "2026-09-11");
    assert.equal(buildHistoryOverview({ rows: buildPortfolioHistoryDisplayRows({ rows: group, account: "portfolio:qa" }) }).pointCount, 0);
    const invalid = display([raw({ snapshotDate: "invalid" }), raw({ snapshotDate: "2026-02-30" })]);
    assert.equal(buildHistoryOverview({ rows: invalid }).excludedInvalidRowCount, 2);
  });

  it("projects portfolio and group cycle dates without changing exact detail lookup keys", async () => {
    const calls = [];
    const sqlRow = { snapshot_date: "2026-09-11", source: manual, account: "qa-account", cycle_end_at: "2026-09-10 22:00:00+00",
      cash_value: null, invested_amount: null, total_cost: "10", total_market_value: "12", total_pnl: "2", total_return_pct: "20",
      avg_correlation: null, enb: null, portfolio_volatility: null, regime_label: null, regime_score: null,
      account_id: "qa-id", asset_id: "asset-id", market_value_krw: "12", cost_krw: "10", pnl_krw: "2" };
    const [queries] = await importWithPorts(["src/db/queries/tenant-history-snapshots.ts"], {
      "@/db/tenant-transaction-context": { runTenantReadTransaction: async (owner, work) => Promise.all(work({ query: async (sql, params) => {
        calls.push({ owner, sql, params });
        return sql.includes("limit $5") ? [] : [sqlRow];
      } })) },
    });
    const tenantContext = { ownerUserId: "qa-owner" };
    for (const result of [await queries.loadTenantHistoryPortfolioRows({ tenantContext }), await queries.loadTenantHistoryGroupPositionRows({ tenantContext, accountIds: ["qa-id"], assetIds: [], earliestMembershipDate: "2026-09-11" })]) {
      assert.equal(result[0].snapshotDate, "2026-09-11");
      assert.equal(result[0].valuationDate, "2026-09-10");
    }
    await queries.loadTenantHistoryPositionDetailRows({ tenantContext, account: "qa-account", accountId: "qa-id", snapshotDate: "2026-09-11", source: manual, limit: 10 });
    assert.deepEqual(calls[2].params, ["qa-id", "qa-account", "2026-09-11", manual, 10]);
    assert.ok(calls.every(c => c.owner === "qa-owner"));
    assert.ok(calls.slice(0, 2).every(c => c.sql.includes("snapshot.cycle_end_at")));
    // Capture/storage labels are not substituted for the writer's actual cycle end.
    sqlRow.cycle_end_at = "2026-09-09 22:00:00+00";
    const [differentCycle] = await queries.loadTenantHistoryPortfolioRows({ tenantContext });
    assert.equal(differentCycle.snapshotDate, "2026-09-11");
    assert.equal(differentCycle.valuationDate, "2026-09-09");
    sqlRow.source = "base44_import";
    const [imported] = await queries.loadTenantHistoryPortfolioRows({ tenantContext });
    assert.equal(imported.valuationDate, "2026-09-11");
  });
});
