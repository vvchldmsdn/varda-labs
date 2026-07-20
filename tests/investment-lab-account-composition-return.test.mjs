import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY,
  composeInvestmentLabNamedAccountReturns,
} from "../src/lib/investment-lab-account-composition-return.ts";
import { calculateInvestmentLabModifiedDietz } from "../src/lib/investment-lab-modified-dietz.ts";

describe("investment lab named-account return composition", () => {
  it("recomputes Modified Dietz from summed period evidence", () => {
    const brokerage = modifiedDietz(
      [value("2026-01-01", 100), value("2026-01-03", 132), value("2026-01-05", 145)],
      [flow("2026-01-02", 0, "inflow", 20)],
    );
    const isa = modifiedDietz(
      [value("2026-01-01", 200), value("2026-01-03", 230), value("2026-01-05", 207)],
      [flow("2026-01-03", 1, "inflow", 30)],
    );
    const irp = modifiedDietz(
      [value("2026-01-01", 50), value("2026-01-03", 55), value("2026-01-05", 60)],
      [],
    );
    const expected = modifiedDietz(
      [value("2026-01-01", 350), value("2026-01-03", 417), value("2026-01-05", 412)],
      [
        flow("2026-01-02", 0, "inflow", 20),
        flow("2026-01-03", 1, "inflow", 30),
      ],
    );

    const result = composeInvestmentLabNamedAccountReturns([
      brokerage.periods,
      isa.periods,
      irp.periods,
    ]);

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.totalReturn, expected.totalReturn));
    assert.equal(result.flowCount, 2);
    assert.deepEqual(
      result.periods.map((period) => period.periodReturn),
      expected.periods.map((period) => period.periodReturn),
    );
    const naiveFirstPeriod =
      (brokerage.periods[0].periodReturn +
        isa.periods[0].periodReturn +
        irp.periods[0].periodReturn) /
      3;
    assert.ok(!closeTo(result.periods[0].periodReturn, naiveFirstPeriod));
  });

  it("preserves MDD while the volatility evidence threshold is unmet", () => {
    const periods = modifiedDietz(
      [
        value("2026-01-01", 100),
        value("2026-01-02", 110),
        value("2026-01-03", 88),
        value("2026-01-04", 99),
      ],
      [],
    ).periods;

    const result = composeInvestmentLabNamedAccountReturns([
      periods,
      periods,
      periods,
    ]);

    assert.equal(result.status, "ready");
    assert.equal(result.riskMetrics.status, "partial");
    assert.ok(closeTo(result.riskMetrics.maximumDrawdown, 0.2));
    assert.equal(result.riskMetrics.annualizedVolatility, null);
    assert.deepEqual(result.riskMetrics.blockers, [
      "insufficient_volatility_periods",
    ]);
  });

  it("fails closed when named-account period axes differ", () => {
    const first = modifiedDietz(
      [value("2026-01-01", 100), value("2026-01-02", 101)],
      [],
    );
    const second = modifiedDietz(
      [value("2026-01-01", 100), value("2026-01-03", 101)],
      [],
    );

    const result = composeInvestmentLabNamedAccountReturns([
      first.periods,
      second.periods,
    ]);

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.blockers, ["period_axis_mismatch"]);
  });

  it("is pure and explicitly forbids pooled-return reuse", () => {
    const source = readFileSync(
      "src/lib/investment-lab-account-composition-return.ts",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY.pooledReturnReuse,
      "forbidden",
    );
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
  });
});

function modifiedDietz(valuations, flows) {
  const result = calculateInvestmentLabModifiedDietz({ valuations, flows });
  assert.equal(result.status, "ready");
  return result;
}

function value(serviceDate, valueKrw) {
  return { serviceDate, valueKrw };
}

function flow(effectiveServiceDate, sequence, direction, amountKrw) {
  return { effectiveServiceDate, sequence, direction, amountKrw };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
