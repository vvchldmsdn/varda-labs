import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioDashboardHoldingHistory,
  buildPortfolioDashboardPositionTrend,
} from "../src/lib/portfolio-dashboard-history.ts";

const holdings = [
  {
    id: "asset-kodex",
    name: "KODEX 200",
    ticker: "069500",
    account: "brokerage",
    currentWeight: 55,
  },
  {
    id: "asset-voo",
    name: "Vanguard S&P 500 ETF",
    ticker: "VOO",
    account: "brokerage",
    currentWeight: 45,
  },
];

describe("portfolio dashboard holding history", () => {
  it("builds a name-first date matrix without hiding partial evidence", () => {
    const result = buildPortfolioDashboardHoldingHistory({
      holdings,
      maxDates: 2,
      rows: [
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-kodex",
          unitValueChangePct: 1.25,
          capturedAt: "2026-08-02T07:00:00.000Z",
        }),
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-kodex",
          unitValueChangePct: 2.5,
          marketValueChangePct: 9,
          capturedAt: "2026-08-02T08:00:00.000Z",
          source: "varda_manual_daily_snapshot",
        }),
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-voo",
          unitValueChangePct: null,
          marketValueChangePct: -1.2,
        }),
        row({
          snapshotDate: "2026-08-02",
          assetId: "asset-kodex",
          unitValueChangePct: null,
          marketValueChangePct: null,
        }),
        row({
          snapshotDate: "2026-08-02",
          assetId: "asset-voo",
          unitValueChangePct: 0,
        }),
      ],
    });

    assert.deepEqual(result.dates, ["2026-08-01", "2026-08-02"]);
    assert.equal(result.rows[0]?.name, "KODEX 200");
    assert.equal(result.rows[0]?.ticker, "069500");
    assert.equal(result.rows[0]?.cells[0]?.changePct, 2.5);
    assert.equal(result.rows[0]?.cells[0]?.basis, "unit_value");
    assert.equal(result.rows[0]?.cells[1]?.basis, "missing");
    assert.equal(result.rows[1]?.cells[0]?.basis, "market_value");
    assert.equal(result.observedCellCount, 3);
    assert.equal(result.expectedCellCount, 4);
    assert.equal(result.coveragePct, 75);
  });

  it("derives a group trend from one preferred row per holding and date", () => {
    const result = buildPortfolioDashboardPositionTrend({
      holdings,
      rows: [
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-kodex",
          marketValueKrw: 100,
          costKrw: 90,
          pnlKrw: 10,
          capturedAt: "2026-08-02T07:00:00.000Z",
        }),
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-kodex",
          marketValueKrw: 110,
          costKrw: 99,
          pnlKrw: 11,
          capturedAt: "2026-08-02T08:00:00.000Z",
        }),
        row({
          snapshotDate: "2026-08-01",
          assetId: "asset-voo",
          marketValueKrw: 50,
          costKrw: 45,
          pnlKrw: 5,
        }),
        row({
          snapshotDate: "2026-08-02",
          assetId: "asset-kodex",
          marketValueKrw: 112,
          costKrw: null,
          pnlKrw: null,
        }),
      ],
    });

    assert.equal(result[0]?.totalMarketValue, 160);
    assert.equal(result[0]?.totalPnl, 16);
    assert.ok(Math.abs((result[0]?.totalReturnPct ?? 0) - 11.1111111111) < 1e-8);
    assert.deepEqual(result[1], {
      date: "2026-08-02",
      totalMarketValue: 112,
      totalPnl: null,
      totalReturnPct: null,
    });
  });
});

function row(overrides) {
  return {
    snapshotDate: "2026-08-01",
    assetId: null,
    ticker: null,
    assetName: null,
    account: "brokerage",
    unitValueChangePct: null,
    marketValueChangePct: null,
    marketValueChangeKrw: null,
    priceChangeKrw: null,
    fxChangeKrw: null,
    marketValueKrw: null,
    costKrw: null,
    pnlKrw: null,
    source: "base44_import",
    capturedAt: null,
    createdAt: "2026-08-02T06:00:00.000Z",
    ...overrides,
  };
}
