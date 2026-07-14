import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSimulationObservedReturnComparison } from "../src/lib/simulation-observed-return-comparison.ts";

describe("Simulation observed return comparison", () => {
  it("compounds two aligned complete return series from a shared index of 100", () => {
    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", [0.1, -0.1]),
      readyInput("voo", "VOO", [0.2, 0.05]),
    ]);

    assert.equal(result.status, "ready");
    assert.equal(result.pointCount, 3);
    assert.equal(result.baselineServiceDate, "2026-07-07");
    assert.equal(result.endServiceDate, "2026-07-09");
    assert.deepEqual(
      result.series.map((series) => [
        series.id,
        series.points.map((point) => point.serviceDate),
        series.points.map((point) => point.value),
      ]),
      [
        [
          "kodex200",
          ["2026-07-07", "2026-07-08", "2026-07-09"],
          [100, 110.00000000000001, 99.00000000000001],
        ],
        [
          "voo",
          ["2026-07-07", "2026-07-08", "2026-07-09"],
          [100, 120, 126],
        ],
      ],
    );
  });

  it("blocks the whole comparison when either input is unavailable", () => {
    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", [0.01, 0.02]),
      {
        ...readyInput("voo", "VOO", [0.03, 0.04]),
        status: "unavailable",
        observedReturns: null,
      },
    ]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_unavailable");
    assert.equal(result.pointCount, 0);
    assert.deepEqual(result.series, []);
  });

  it("blocks the whole comparison when the service-date axes differ", () => {
    const shifted = readyInput("voo", "VOO", [0.03, 0.04]);
    shifted.observedReturns[1] = {
      previousServiceDate: "2026-07-08",
      serviceDate: "2026-07-10",
      value: 0.04,
    };

    const result = buildSimulationObservedReturnComparison([
      readyInput("kodex200", "069500", [0.01, 0.02]),
      shifted,
    ]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "axis_mismatch");
  });

  it("rejects non-finite and below-minus-one returns", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1.01]) {
      const result = buildSimulationObservedReturnComparison([
        readyInput("kodex200", "069500", [0.01, value]),
        readyInput("voo", "VOO", [0.03, 0.04]),
      ]);

      assert.equal(result.status, "unavailable");
      assert.equal(result.reason, "invalid_return_series");
    }
  });
});

function readyInput(id, ticker, values) {
  const dates = ["2026-07-07", "2026-07-08", "2026-07-09"];
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
