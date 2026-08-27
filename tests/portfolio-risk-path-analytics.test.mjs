import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculatePortfolioRiskPathAnalytics } from "../src/lib/portfolio-risk-path-analytics.ts";

describe("portfolio risk path analytics", () => {
  it("computes maximum drawdown and benchmark beta from aligned returns", () => {
    const result = calculatePortfolioRiskPathAnalytics({
      instruments: [
        instrument("a", 0.5),
        instrument("b", 0.5),
      ],
      returnRows: [
        returnRow("2026-01-02", [0.1, 0.1]),
        returnRow("2026-01-03", [-0.2, -0.2]),
        returnRow("2026-01-04", [0.05, 0.05]),
      ],
      benchmarks: [
        {
          id: "kodex200",
          label: "KODEX 200",
          ticker: "069500",
          currency: "KRW",
          returnRows: [
            benchmarkRow("2026-01-02", 0.05),
            benchmarkRow("2026-01-03", -0.1),
            benchmarkRow("2026-01-04", 0.025),
          ],
        },
      ],
    });

    assertClose(result.maximumDrawdownPct.value, 20);
    assertClose(result.benchmarkBetas[0].beta.value, 2);
    assert.equal(result.benchmarkBetas[0].observationCount, 3);
  });

  it("keeps missing portfolio and flat benchmark evidence explicit", () => {
    const missing = calculatePortfolioRiskPathAnalytics({
      instruments: [],
      returnRows: [],
      benchmarks: [],
    });
    assert.equal(
      missing.maximumDrawdownPct.reason,
      "portfolio_returns_unavailable",
    );

    const flat = calculatePortfolioRiskPathAnalytics({
      instruments: [instrument("a", 1)],
      returnRows: [
        returnRow("2026-01-02", [0.01], ["a"]),
        returnRow("2026-01-03", [0.02], ["a"]),
      ],
      benchmarks: [
        {
          id: "voo",
          label: "Vanguard S&P 500 ETF",
          ticker: "VOO",
          currency: "USD",
          returnRows: [
            benchmarkRow("2026-01-02", 0.01),
            benchmarkRow("2026-01-03", 0.01),
          ],
        },
      ],
    });
    assert.equal(flat.benchmarkBetas[0].beta.reason, "zero_benchmark_variance");
  });
});

function instrument(instrumentKey, weight) {
  return {
    instrumentKey,
    ticker: instrumentKey.toUpperCase(),
    names: [instrumentKey.toUpperCase()],
    market: "korea",
    currency: "KRW",
    accounts: ["brokerage"],
    quantity: 1,
    endValueKrw: weight * 1_000_000,
    weight,
  };
}

function returnRow(serviceDate, values, keys = ["a", "b"]) {
  return {
    previousServiceDate: shiftDate(serviceDate, -1),
    serviceDate,
    returns: values.map((value, index) => ({
      instrumentKey: keys[index],
      value,
    })),
  };
}

function benchmarkRow(serviceDate, value) {
  return returnRow(serviceDate, [value], ["benchmark"]);
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function assertClose(actual, expected, tolerance = 1e-10) {
  assert.ok(actual !== null);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
