import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_PATH_RISK_POLICY,
  calculateInvestmentLabPathRisk,
} from "../src/lib/investment-lab-path-risk.ts";
import { calculateInvestmentLabModifiedDietz } from "../src/lib/investment-lab-modified-dietz.ts";

describe("investment lab cashflow-adjusted path risk", () => {
  it("calculates peak-to-trough drawdown from linked period returns", () => {
    const returns = [0.1, -0.2, 0.25, ...Array.from({ length: 17 }, () => 0)];
    const result = calculateInvestmentLabPathRisk(returns.map(period));

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.maximumDrawdown, 0.2));
    assert.ok(
      closeTo(
        result.annualizedVolatility,
        sampleVolatility(returns) * Math.sqrt(252),
      ),
    );
    assert.equal(result.periodCount, 20);
  });

  it("does not mistake a same-day external inflow for investment risk", () => {
    const result = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-02", 1_100),
        value("2026-01-03", 1_100),
      ],
      flows: [flow("2026-01-02", 0, "inflow", 100)],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.totalReturn, 0);
    assert.equal(result.riskMetrics.status, "partial");
    assert.equal(result.riskMetrics.maximumDrawdown, 0);
    assert.equal(result.riskMetrics.annualizedVolatility, null);
    assert.deepEqual(result.riskMetrics.blockers, [
      "insufficient_volatility_periods",
    ]);
  });

  it("preserves MDD when only one return period exists", () => {
    const result = calculateInvestmentLabPathRisk([period(-0.1)]);

    assert.equal(result.status, "partial");
    assert.ok(closeTo(result.maximumDrawdown, 0.1));
    assert.equal(result.annualizedVolatility, null);
    assert.deepEqual(result.blockers, ["insufficient_volatility_periods"]);
  });

  it("requires the pinned minimum before annualizing volatility", () => {
    const belowMinimum = calculateInvestmentLabPathRisk(
      Array.from({ length: 19 }, () => period(0.01)),
    );
    const atMinimum = calculateInvestmentLabPathRisk(
      Array.from({ length: 20 }, () => period(0.01)),
    );

    assert.equal(belowMinimum.status, "partial");
    assert.equal(belowMinimum.maximumDrawdown, 0);
    assert.equal(belowMinimum.annualizedVolatility, null);
    assert.equal(atMinimum.status, "ready");
    assert.equal(atMinimum.annualizedVolatility, 0);
  });

  it("rejects invalid return factors instead of substituting values", () => {
    const result = calculateInvestmentLabPathRisk([period(-1.1), period(0)]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.maximumDrawdown, null);
    assert.equal(result.annualizedVolatility, null);
    assert.deepEqual(result.blockers, ["invalid_period_return"]);
  });

  it("is a pure calculation with an explicit 252-observation basis", () => {
    const source = readFileSync(
      "src/lib/investment-lab-path-risk.ts",
      "utf8",
    );

    assert.equal(INVESTMENT_LAB_PATH_RISK_POLICY.annualizationFactor, 252);
    assert.equal(
      INVESTMENT_LAB_PATH_RISK_POLICY.minimumAnnualizedVolatilityPeriods,
      20,
    );
    assert.equal(
      INVESTMENT_LAB_PATH_RISK_POLICY.returnSource,
      "modified_dietz_period_returns",
    );
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
  });
});

function period(periodReturn) {
  return { periodReturn };
}

function value(serviceDate, valueKrw) {
  return { serviceDate, valueKrw };
}

function flow(effectiveServiceDate, sequence, direction, amountKrw) {
  return { effectiveServiceDate, sequence, direction, amountKrw };
}

function sampleVolatility(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
