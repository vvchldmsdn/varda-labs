import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTodayMovementAttribution,
  selectTodayHoldingHistory,
} from "../src/lib/today-movement-view.ts";

describe("today movement view attribution", () => {
  it("keeps trade flow outside price and FX performance attribution", () => {
    assert.deepEqual(
      buildTodayMovementAttribution({
        ready: true,
        previousTotalKrw: 10_000,
        changeKrw: 700,
        fxChangeKrw: 200,
        tradeFlowKrw: 1_000,
      }),
      {
        changeKrw: 700,
        currentEvidenceKrw: 11_700,
        fxImpactKrw: 200,
        priceImpactKrw: 500,
        tradeFlowKrw: 1_000,
      },
    );
  });

  it("returns pending values when aggregate movement is not ready", () => {
    assert.deepEqual(
      buildTodayMovementAttribution({
        ready: false,
        previousTotalKrw: 10_000,
        changeKrw: null,
        fxChangeKrw: 200,
        tradeFlowKrw: 1_000,
      }),
      {
        changeKrw: null,
        currentEvidenceKrw: null,
        fxImpactKrw: null,
        priceImpactKrw: null,
        tradeFlowKrw: null,
      },
    );
  });
});

describe("today selected holding history", () => {
  it("selects only finite stored valuation evidence for the requested holding", () => {
    const history = {
      dates: ["2026-08-20", "2026-08-21", "2026-08-22"],
      rows: [
        {
          holdingId: "holding-a",
          name: "Alpha",
          ticker: "AAA",
          account: "brokerage",
          currentWeight: 50,
          cells: [
            { date: "2026-08-20", changePct: 1, marketValueKrw: 100, changeKrw: 1, priceChangeKrw: 1, fxChangeKrw: 0, basis: "unit_value" },
            { date: "2026-08-21", changePct: null, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "missing" },
            { date: "2026-08-22", changePct: -2, marketValueKrw: 98, changeKrw: -2, priceChangeKrw: -2, fxChangeKrw: 0, basis: "unit_value" },
          ],
        },
        {
          holdingId: "holding-b",
          name: "Beta",
          ticker: "BBB",
          account: "isa",
          currentWeight: 50,
          cells: [
            { date: "2026-08-20", changePct: 3, marketValueKrw: 300, changeKrw: 9, priceChangeKrw: 9, fxChangeKrw: 0, basis: "unit_value" },
          ],
        },
      ],
      observedCellCount: 3,
      expectedCellCount: 4,
      coveragePct: 75,
    };

    assert.deepEqual(selectTodayHoldingHistory(history, "holding-a"), [
      { basis: "market_value", chartValue: 100, changePct: 1, date: "2026-08-20", marketValueKrw: 100 },
      { basis: "market_value", chartValue: 98, changePct: -2, date: "2026-08-22", marketValueKrw: 98 },
    ]);
    assert.deepEqual(selectTodayHoldingHistory(history, "missing"), []);
  });

  it("uses a normalized return path when legacy rows lack valuation amounts", () => {
    const history = {
      dates: ["2026-08-20", "2026-08-21", "2026-08-22"],
      rows: [{
        holdingId: "holding-a",
        name: "Alpha",
        ticker: "AAA",
        account: "brokerage",
        currentWeight: 100,
        cells: [
          { date: "2026-08-20", changePct: 1, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
          { date: "2026-08-21", changePct: -2, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
          { date: "2026-08-22", changePct: 3, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
        ],
      }],
      observedCellCount: 3,
      expectedCellCount: 3,
      coveragePct: 100,
    };

    const points = selectTodayHoldingHistory(history, "holding-a");
    assert.equal(points.length, 3);
    assert.deepEqual(points.map((point) => point.basis), [
      "normalized_return",
      "normalized_return",
      "normalized_return",
    ]);
    assert.equal(points[0].chartValue, 100);
    assert.equal(points[1].chartValue, 98);
    assert.ok(Math.abs(points[2].chartValue - 100.94) < 1e-9);
  });
});
