import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationObservedReturnComparison,
  SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY,
} from "../src/lib/simulation-observed-return-comparison.ts";

const RETURN_COUNT =
  SIMULATION_OBSERVED_RETURN_COMPARISON_POLICY.expectedReturnCount;

describe("Simulation observed return comparison", () => {
  it("compounds two aligned 90-return series from a shared index of 100", () => {
    const kodexReturns = returnValues();
    kodexReturns[0] = 0.1;
    kodexReturns[1] = -0.1;
    const vooReturns = returnValues();
    vooReturns[0] = 0.2;
    vooReturns[1] = 0.05;

    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", kodexReturns),
      readyInput("voo", "VOO", vooReturns),
    ]);

    assert.equal(result.status, "ready");
    assert.equal(result.pointCount, 91);
    assert.equal(result.baselineServiceDate, "2026-04-10");
    assert.equal(result.endServiceDate, "2026-07-09");
    assert.deepEqual(
      result.series.map((series) => [
        series.id,
        series.points.slice(0, 3).map((point) => point.value),
        series.points.at(-1).value,
      ]),
      [
        ["kodex200", [100, 110.00000000000001, 99.00000000000001], 99.00000000000001],
        ["voo", [100, 120, 126], 126],
      ],
    );
  });

  it("blocks the whole comparison when either input is unavailable", () => {
    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", returnValues(0.01)),
      {
        ...readyInput("voo", "VOO", returnValues(0.02)),
        status: "unavailable",
        observedReturns: null,
      },
    ]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_unavailable");
    assert.equal(result.pointCount, 0);
    assert.deepEqual(result.series, []);
  });

  it("requires exactly 90 returns at the helper boundary", () => {
    for (const count of [89, 91]) {
      const result = buildSimulationObservedReturnComparison([
        readyInput("kodex200", "069500", returnValues(0.01, count)),
        readyInput("voo", "VOO", returnValues(0.02, count)),
      ]);

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "invalid_return_count");
      assert.equal(result.pointCount, 0);
    }
  });

  it("blocks the whole comparison when complete service-date axes differ", () => {
    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", returnValues(0.01)),
      readyInput("voo", "VOO", returnValues(0.02), "2026-04-11"),
    ]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "axis_mismatch");
  });

  it("rejects non-finite and below-minus-one returns", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1.01]) {
      const invalidReturns = returnValues(0.01);
      invalidReturns[45] = value;
      const result = buildSimulationObservedReturnComparison([
        readyInput("kodex200", "069500", invalidReturns),
        readyInput("voo", "VOO", returnValues(0.02)),
      ]);

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "invalid_return_series");
    }
  });
});

function readyInput(id, ticker, values, startDate = "2026-04-10") {
  const dates = calendarDates(startDate, values.length + 1);
  return {
    id,
    ticker,
    name: ticker,
    status: "matrix_ready",
    observedReturns: values.map((value, index) => ({
      previousServiceDate: dates[index],
      serviceDate: dates[index + 1],
      value,
    })),
  };
}

function returnValues(value = 0, count = RETURN_COUNT) {
  return Array.from({ length: count }, () => value);
}

function calendarDates(startDate, count) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
