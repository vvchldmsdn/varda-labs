import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  historyPointMetric,
  historyPointsWithMetric,
  selectHistoryRange,
  summarizeHistoryRange,
} from "../src/lib/history-explorer.ts";

function point(date, valueKrw, totalReturnPct) {
  return Object.freeze({
    date,
    valueKrw,
    cashValueKrw: null,
    investedAmountKrw: null,
    totalPnlKrw: null,
    totalReturnPct,
    movementKrw: null,
    movementPct: null,
    gapDays: null,
    drawdownKrw: 0,
    drawdownPct: 0,
    source: "test",
    rowKind: "stored",
    risk: null,
    events: Object.freeze([]),
  });
}

const points = Object.freeze([
  point("2026-07-20", 100, null),
  point("2026-07-28", 150, 5),
  point("2026-08-01", 120, -2),
  point("2026-08-27", 180, 8),
]);

describe("history explorer", () => {
  it("selects a fixed date window without filling absent dates", () => {
    assert.deepEqual(
      selectHistoryRange(points, "30D").map((item) => item.date),
      ["2026-07-28", "2026-08-01", "2026-08-27"],
    );
    assert.equal(selectHistoryRange(points, "ALL"), points);
  });

  it("uses only explicit stored return evidence in return mode", () => {
    assert.deepEqual(
      historyPointsWithMetric(points, "return").map((item) => item.date),
      ["2026-07-28", "2026-08-01", "2026-08-27"],
    );
    assert.equal(historyPointMetric(points[0], "value"), 100);
    assert.equal(historyPointMetric(points[0], "return"), null);
  });

  it("recomputes range change, peak, and drawdown from the visible points", () => {
    const summary = summarizeHistoryRange(points);

    assert.equal(summary.startValueKrw, 100);
    assert.equal(summary.endValueKrw, 180);
    assert.equal(summary.changeKrw, 80);
    assert.equal(summary.changePct, 80);
    assert.equal(summary.peakValueKrw, 180);
    assert.equal(summary.peakDate, "2026-08-27");
    assert.equal(summary.maxDrawdownPct, -20);
    assert.equal(summary.maxDrawdownDate, "2026-08-01");
  });
});
