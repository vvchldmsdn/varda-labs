import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDashboardFxTrend } from "../src/lib/fx-trend.ts";

describe("dashboard FX trend", () => {
  it("builds rolling 60 and 120 observation averages without calendar filling", () => {
    const rows = Array.from({ length: 125 }, (_, index) => ({
      rateDate: addDays("2026-01-01", index * 2),
      usdKrw: 1_400 + index,
    })).toReversed();
    const result = buildDashboardFxTrend(rows);

    assert.equal(result.length, 125);
    assert.equal(result[58].ma60, null);
    assert.equal(result[59].ma60, average(1_400, 1_459));
    assert.equal(result[118].ma120, null);
    assert.equal(result[119].ma120, average(1_400, 1_519));
    assert.equal(result.at(-1).ma60, average(1_465, 1_524));
  });

  it("keeps the first valid row for duplicate dates and rejects invalid values", () => {
    const result = buildDashboardFxTrend([
      { rateDate: "2026-08-21", usdKrw: "1493.62" },
      { rateDate: "2026-08-21", usdKrw: "9999" },
      { rateDate: "invalid", usdKrw: 1_500 },
      { rateDate: "2026-08-20", usdKrw: 0 },
    ]);

    assert.deepEqual(result, [
      { date: "2026-08-21", rate: 1_493.62, ma60: null, ma120: null },
    ]);
  });

  it("caps the rendered series to the requested number of observations", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      rateDate: addDays("2026-01-01", index),
      usdKrw: 1_400 + index,
    }));
    const result = buildDashboardFxTrend(rows, 5);

    assert.equal(result.length, 5);
    assert.equal(result[0].date, addDays("2026-01-01", 15));
    assert.equal(result.at(-1).date, addDays("2026-01-01", 19));
  });
});

function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function average(first, last) {
  return (first + last) / 2;
}
