import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { snapshotPositionCostBasisKrw, summarizeSnapshotCostEvidence } from "../src/lib/snapshots/cost-evidence.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const base = { quantity: "2", averageCost: "100", fractionalKrwValue: null, fractionalAvgCost: null, currency: "KRW" };

describe("snapshot purchase cost evidence", () => {
  it("does not substitute valuation for unknown cost, including fractional holdings", () => {
    assert.equal(snapshotPositionCostBasisKrw({ ...base, averageCost: null, currentPrice: "999" }, 1500), null);
    assert.equal(snapshotPositionCostBasisKrw({ ...base, fractionalKrwValue: "50" }, 1500), null);
    assert.equal(snapshotPositionCostBasisKrw({ ...base, averageCost: "0" }, 1500), null);
    assert.equal(snapshotPositionCostBasisKrw({ ...base, currency: "USD", fractionalKrwValue: "500", fractionalAvgCost: "400" }, 1500), 300400);
    assert.equal(snapshotPositionCostBasisKrw({ ...base, quantity: "0", averageCost: null, fractionalKrwValue: "500", fractionalAvgCost: "400" }, 1500), 400);
  });

  it("propagates an unknown holding or account into portfolio cost and return totals", () => {
    assert.deepEqual(summarizeSnapshotCostEvidence([{ costKrw: 200, pnlKrw: 40 }, { costKrw: null, pnlKrw: null }], 50, 10), {
      openCostKrw: null, unrealizedPnlKrw: null, totalCost: null, totalPnl: null, totalReturnPct: null,
    });
    assert.deepEqual(summarizeSnapshotCostEvidence([{ costKrw: 200, pnlKrw: 40 }], 50, 10), {
      openCostKrw: 200, unrealizedPnlKrw: 40, totalCost: 250, totalPnl: 50, totalReturnPct: 20,
    });
  });

  it("writes actual valuation but null cost and PnL for an unknown-cost position, account, and all-account snapshot", async () => {
    const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const now = new Date("2026-09-09T00:00:00.000Z");
    const holdings = [null, "80"].map((averageCost, index) => ({
      ...base, averageCost, id: `asset-${index}`, canonicalOwnerUserId: owner, legacyBase44Id: null,
      name: `Asset ${index}`, ticker: index === 0 ? "005930" : "000660", market: "korea", assetType: "stock", category: null,
      account: `acct${index}`, accountId: `account-${index}`, currentPrice: "100", groupId: null, targetWeight: null, maAssetClass: null,
    }));
    const rowsByTable = {
      accounts: holdings.map((row) => ({ id: row.accountId, canonicalOwnerUserId: owner, code: row.account, name: row.account, accountType: "investment", currency: "KRW", isActive: true })),
      assets: holdings,
      fx_rates: [{ rateDate: "2026-09-09", usdKrw: "1500", source: "test", status: "ok" }],
      asset_price_snapshots: holdings.map((row) => ({ ...row, priceDate: "2026-09-08", closePrice: "105", isSample: false, source: "kis", fetchedAt: now })),
      live_price_quotes: holdings.map((row) => ({ ticker: row.ticker, market: row.market, currency: row.currency, price: "110", source: "kis", provider: "kis", quoteType: "live", status: "ok", fetchedAt: now, priceAsOf: now })),
    };
    const writes = [];
    const selection = () => {
      let table;
      const query = {
        from(value) { table = getTableName(value); return query; },
        where() { return query; }, innerJoin() { return query; }, orderBy() { return query; }, limit() { return query; },
        then(resolve, reject) { return Promise.resolve(rowsByTable[table] ?? []).then(resolve, reject); },
      };
      return query;
    };
    const [module] = await importWithPorts(["src/lib/snapshots/daily.ts"], {
      "@/db/client": { db: {
        select: selection, selectDistinct: selection,
        insert: (table) => ({ values: (rows) => { writes.push({ table: getTableName(table), rows: Array.isArray(rows) ? rows : [rows] }); return {}; } }),
        batch: async () => [],
      } },
    });
    const result = await module.runDailySnapshot({ tenantContext: { ownerUserId: owner }, now, dryRun: false });
    assert.equal(result.ok, true);
    assert.equal(result.results.acct0.totalMarketValue, 220);
    assert.equal(result.results.acct0.totalCost, null);
    assert.equal(result.results.acct1.totalCost, 160);
    assert.equal(result.results.all.totalMarketValue, 440);
    assert.equal(result.results.all.totalCost, null);
    assert.equal(result.results.all.totalPnl, null);
    const portfolios = writes.filter((write) => write.table === "daily_portfolio_snapshots").flatMap((write) => write.rows);
    const positions = writes.filter((write) => write.table === "daily_position_snapshots").flatMap((write) => write.rows);
    assert.equal(portfolios.length, 3);
    for (const row of portfolios.filter((row) => row.account !== "acct1")) {
      assert.equal(row.totalCost, null);
      assert.equal(row.totalPnl, null);
      assert.equal(row.totalReturnPct, null);
      assert.match(row.description, /open_cost_krw=unknown/);
    }
    const unknown = positions.find((row) => row.assetId === "asset-0");
    assert.equal(Number(unknown.marketValueKrw), 220);
    assert.equal(unknown.avgCost, null);
    assert.equal(unknown.costKrw, null);
    assert.equal(unknown.pnlKrw, null);
    assert.equal(unknown.pnlPct, null);
    assert.match(unknown.description, /cost_basis_source=unknown/);
    const known = positions.find((row) => row.assetId === "asset-1");
    assert.equal(Number(known.costKrw), 160);
    assert.equal(Number(known.pnlKrw), 60);
  });
});
