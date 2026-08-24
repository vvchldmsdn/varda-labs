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
          marketValueKrw: 1_250_000,
          marketValueChangeKrw: 25_000,
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
    assert.equal(result.rows[0]?.cells[0]?.marketValueKrw, 1_250_000);
    assert.equal(result.rows[0]?.cells[0]?.changeKrw, 25_000);
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

  it("keeps every holding and exposes missing calendar dates without inventing zero", () => {
    const extendedHoldings = [
      ...holdings,
      {
        id: "asset-schd",
        name: "Schwab US Dividend Equity ETF",
        ticker: "SCHD",
        account: "brokerage",
        currentWeight: 10,
      },
    ];
    const result = buildPortfolioDashboardHoldingHistory({
      holdings: extendedHoldings,
      maxDates: 3,
      rows: [
        row({ snapshotDate: "2026-08-20", assetId: "asset-kodex", unitValueChangePct: 0 }),
        row({ snapshotDate: "2026-08-22", assetId: "asset-kodex", unitValueChangePct: 1 }),
        row({ snapshotDate: "2026-08-22", assetId: "asset-voo", unitValueChangePct: -1 }),
      ],
    });

    assert.deepEqual(result.dates, ["2026-08-20", "2026-08-21", "2026-08-22"]);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0]?.cells[0]?.changePct, 0);
    assert.equal(result.rows[0]?.cells[1]?.changePct, null);
    assert.equal(result.rows[0]?.cells[1]?.basis, "missing");
    assert.equal(result.rows[2]?.cells.every((cell) => cell.basis === "missing"), true);
  });

  it("uses live movement for the current service date without rewriting history", () => {
    const currentHoldings = [
      {
        ...holdings[0],
        valueKrw: 1_300_000,
        dailyChangeKrw: 30_000,
        dailyReturnPct: 2.3622,
        priceDailyChangeKrw: 24_000,
        fxDailyChangeKrw: 6_000,
      },
      {
        ...holdings[1],
        valueKrw: 900_000,
        dailyChangeKrw: 0,
        dailyReturnPct: 0,
        priceDailyChangeKrw: 0,
        fxDailyChangeKrw: 0,
      },
    ];
    const result = buildPortfolioDashboardHoldingHistory({
      currentDate: "2026-08-24",
      holdings: currentHoldings,
      maxDates: 2,
      rows: [
        row({
          snapshotDate: "2026-08-23",
          assetId: "asset-kodex",
          unitValueChangePct: -1,
        }),
        row({
          snapshotDate: "2026-08-24",
          assetId: "asset-kodex",
          unitValueChangePct: -9,
        }),
      ],
    });

    assert.deepEqual(result.dates, ["2026-08-23", "2026-08-24"]);
    assert.equal(result.rows[0]?.cells[0]?.changePct, -1);
    assert.deepEqual(result.rows[0]?.cells[1], {
      date: "2026-08-24",
      changePct: 2.3622,
      marketValueKrw: 1_300_000,
      changeKrw: 30_000,
      priceChangeKrw: 24_000,
      fxChangeKrw: 6_000,
      basis: "live_movement",
    });
    assert.equal(result.rows[1]?.cells[1]?.changePct, 0);
    assert.equal(result.rows[1]?.cells[1]?.basis, "live_movement");
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
