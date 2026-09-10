import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioDashboardHoldingHistory,
  buildPortfolioDashboardPositionTrend,
  portfolioDashboardHistoryDisplayDate,
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
  it("does not publish a group return from only the positions with known cost or PnL", () => {
    for (const [costKrw, pnlKrw, totalPnl] of [[null, null, null], [null, 50, 150], [850, null, null]]) {
      const result = buildPortfolioDashboardPositionTrend({ holdings, rows: [
        row({ snapshotDate: "2026-09-09", assetId: "asset-kodex", marketValueKrw: 1100, costKrw: 1000, pnlKrw: 100 }),
        row({ snapshotDate: "2026-09-09", assetId: "asset-voo", marketValueKrw: 900, costKrw, pnlKrw }),
        row({ snapshotDate: "2026-09-09", assetId: "outside-group", marketValueKrw: 9999, costKrw: 1, pnlKrw: 9998 }),
      ] });
      assert.deepEqual(result, [{ date: "2026-09-09", totalMarketValue: 2000, totalPnl, totalReturnPct: null }]);
    }
  });

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
          snapshotDate: "2026-08-02",
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

  it("uses native price return for today while retaining separate KRW movement and unchanged history", () => {
    const currentHoldings = [
      {
        ...holdings[0],
        valueKrw: 1_300_000,
        dailyChangeKrw: 30_000,
        dailyReturnPct: 2.3622,
        dailyPriceReturn: priceReturn(3),
        priceDailyChangeKrw: 24_000,
        fxDailyChangeKrw: 6_000,
      },
      {
        ...holdings[1],
        valueKrw: 900_000,
        dailyChangeKrw: 0,
        dailyReturnPct: 0,
        dailyPriceReturn: priceReturn(0),
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
      changePct: 3,
      marketValueKrw: 1_300_000,
      changeKrw: 30_000,
      priceChangeKrw: 24_000,
      fxChangeKrw: 6_000,
      basis: "live_price",
      priceReturnEvidence: priceReturn(3),
    });
    assert.equal(result.rows[1]?.cells[1]?.changePct, 0);
    assert.equal(result.rows[1]?.cells[1]?.basis, "live_price");
  });

  it("preserves Friday, weekend, Monday and today's live movement on separate service days", () => {
    const result = buildPortfolioDashboardHoldingHistory({
      currentDate: "2026-09-08",
      holdings: [{ ...holdings[0], valueKrw: 1000, dailyChangeKrw: -10, dailyReturnPct: -1, dailyPriceReturn: priceReturn(-1) }],
      rows: [["2026-09-05", 2], ["2026-09-06", 0], ["2026-09-07", 0], ["2026-09-08", 1]].map(([date, change]) => row({
        snapshotDate: date, assetId: "asset-kodex", source: "varda_manual_daily_snapshot",
        cycleEndAt: new Date(`${date}T07:00:00+09:00`),
        unitValueChangePct: change, marketValueChangeKrw: change * 10,
      })),
    });
    assert.deepEqual(result.dates, ["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    assert.deepEqual(result.rows[0].cells.map((cell) => cell.changePct), [2, 0, 0, 1, -1]);
    assert.equal(result.observedCellCount, 5);
  });

  it("uses the verified cutoff rather than holiday quote reference dates or capture time", () => {
    const generated = row({
      snapshotDate: "2026-09-08", source: "varda_manual_daily_snapshot",
      cycleEndAt: "2026-09-07T22:00:00Z", capturedAt: "2026-09-10T01:00:00Z",
      referenceDate: "2026-09-04", fxReferenceDate: "2026-09-08",
    });
    assert.equal(portfolioDashboardHistoryDisplayDate(generated), "2026-09-07");
    assert.equal(portfolioDashboardHistoryDisplayDate({ ...generated, cycleEndAt: null }), "2026-09-07");
    assert.equal(portfolioDashboardHistoryDisplayDate({ ...generated, cycleEndAt: "invalid" }), "2026-09-07");
    for (const source of ["base44_import", "legacy_automation", null]) {
      assert.equal(portfolioDashboardHistoryDisplayDate({ ...generated, source }), "2026-09-08");
    }
  });

  it("keeps a holiday FX-only change rather than coercing weekends or holidays to zero", () => {
    const result = buildPortfolioDashboardHoldingHistory({
      currentDate: "2026-09-08", holdings: [holdings[1]],
      rows: [row({ snapshotDate: "2026-09-08", assetId: "asset-voo", source: "varda_manual_daily_snapshot",
        unitValueChangePct: 0.062793, marketValueChangeKrw: 627.93, priceChangeKrw: 0, fxChangeKrw: 627.93 })],
    });
    assert.equal(result.rows[0].cells[0].date, "2026-09-07");
    assert.equal(result.rows[0].cells[0].changePct, 0.062793);
    assert.equal(result.rows[0].cells[0].priceChangeKrw, 0);
    assert.equal(result.rows[0].cells[0].fxChangeKrw, 627.93);
    assert.equal(result.rows[0].cells[1].basis, "missing");
    assert.equal(result.observedCellCount, 1);
  });

  for (const dailyPriceReturn of [undefined, { ...priceReturn(null), reason: "missing_previous_close" }]) {
    it("does not use portfolio returns or a stored zero when today's price evidence is unavailable", () => {
      const result = buildPortfolioDashboardHoldingHistory({
        currentDate: "2026-09-08",
        holdings: [{ ...holdings[0], valueKrw: 1000, dailyReturnPct: 1, dailyChangeKrw: 10, dailyPriceReturn }],
        rows: [row({ snapshotDate: "2026-09-08", assetId: "asset-kodex", unitValueChangePct: 0, marketValueChangeKrw: 0, marketValueKrw: 1000 })],
      });
      assert.equal(result.rows[0].cells[0].basis, "missing");
      assert.equal(result.rows[0].cells[0].changePct, null);
      assert.equal(result.rows[0].cells[0].changeKrw, 10, "available money movement is independent from missing price-return evidence");
      assert.equal(result.observedCellCount, 0);
      assert.equal(result.coveragePct, 0);
    });
  }
  for (const missing of ["dailyReturnPct", "dailyChangeKrw", "valueKrw"]) {
    it(`retains native price change when portfolio ${missing} is missing`, () => {
      const result = buildPortfolioDashboardHoldingHistory({ currentDate: "2026-09-09", rows: [],
        holdings: [{ ...holdings[0], valueKrw: 1000, dailyReturnPct: 1, dailyChangeKrw: 10, dailyPriceReturn: priceReturn(3), [missing]: null }] });
      assert.equal(result.rows[0].cells.at(-1).changePct, 3);
      assert.equal(result.rows[0].cells.at(-1).basis, "live_price");
      if (missing === "dailyChangeKrw") assert.equal(result.rows[0].cells.at(-1).changeKrw, null);
      if (missing === "valueKrw") assert.equal(result.rows[0].cells.at(-1).marketValueKrw, null);
    });
  }
});

function priceReturn(changePct) {
  return { changePct, currentPrice: changePct === null ? null : 100 + changePct, previousClose: 100,
    previousCloseDate: "2026-08-21", currency: "KRW", observedAt: "2026-08-24T01:00:00Z", reason: null };
}

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
