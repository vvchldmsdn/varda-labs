import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  calculateInvestmentLabModifiedDietz,
} from "../src/lib/investment-lab-modified-dietz.ts";

describe("investment lab Modified Dietz estimate", () => {
  it("geometrically links observed periods without flows", () => {
    const result = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-02", 1_100),
        value("2026-01-03", 1_210),
      ],
      flows: [],
    });

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.totalReturn, 0.21));
    assert.deepEqual(
      result.periods.map((period) => period.periodReturn),
      [0.1, 0.1],
    );
  });

  it("weights an end-of-day flow by its remaining calendar fraction", () => {
    const result = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_200),
      ],
      flows: [flow("2026-01-06", 0, "inflow", 100)],
    });

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.totalReturn, 100 / 1_050));
    assert.deepEqual(result.periods[0], {
      startServiceDate: "2026-01-01",
      endServiceDate: "2026-01-11",
      calendarDays: 10,
      beginningValueKrw: 1_000,
      endingValueKrw: 1_200,
      netExternalFlowKrw: 100,
      weightedExternalFlowKrw: 50,
      denominatorKrw: 1_050,
      flowCount: 1,
      periodReturn: 100 / 1_050,
    });
  });

  it("gives an end-date flow zero denominator weight", () => {
    const result = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_100),
      ],
      flows: [flow("2026-01-11", 0, "inflow", 100)],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.totalReturn, 0);
    assert.equal(result.periods[0].weightedExternalFlowKrw, 0);
  });

  it("keeps outflows signed in the Modified Dietz numerator and denominator", () => {
    const result = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_000),
      ],
      flows: [flow("2026-01-06", 0, "outflow", 100)],
    });

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.totalReturn, 100 / 950));
    assert.equal(result.periods[0].netExternalFlowKrw, -100);
    assert.equal(result.periods[0].weightedExternalFlowKrw, -50);
  });

  it("does not claim equal returns when execution service dates differ", () => {
    const early = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_200),
      ],
      flows: [flow("2026-01-02", 0, "inflow", 100)],
    });
    const late = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_200),
      ],
      flows: [flow("2026-01-11", 0, "inflow", 100)],
    });

    assert.equal(early.status, "ready");
    assert.equal(late.status, "ready");
    assert.ok(closeTo(early.totalReturn, 100 / 1_090));
    assert.ok(closeTo(late.totalReturn, 0.1));
    assert.notEqual(early.totalReturn, late.totalReturn);
  });

  it("fails closed for ambiguous windows and impossible denominators", () => {
    const duplicateDate = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-01", 1_100),
      ],
      flows: [],
    });
    const outsideFlow = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 1_000),
        value("2026-01-11", 1_100),
      ],
      flows: [flow("2026-01-01", 0, "inflow", 100)],
    });
    const zeroDenominator = calculateInvestmentLabModifiedDietz({
      valuations: [
        value("2026-01-01", 100),
        value("2026-01-11", 10),
      ],
      flows: [flow("2026-01-06", 0, "outflow", 200)],
    });

    assert.equal(duplicateDate.status, "blocked");
    assert.ok(
      duplicateDate.blockers.some(
        (blocker) => blocker.reason === "duplicate_valuation_date",
      ),
    );
    assert.deepEqual(outsideFlow.blockers, [
      {
        reason: "flow_outside_valuation_window",
        sourceIndex: 0,
        serviceDate: "2026-01-01",
      },
    ]);
    assert.deepEqual(zeroDenominator.blockers, [
      {
        reason: "non_positive_denominator",
        sourceIndex: null,
        serviceDate: "2026-01-11",
      },
    ]);
    assert.deepEqual(zeroDenominator.periods, []);
  });

  it("keeps the helper pure and labels the result as an estimate", () => {
    const source = readFileSync(
      "src/lib/investment-lab-modified-dietz.ts",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_MODIFIED_DIETZ_POLICY.classification,
      "estimated_time_weighted_return",
    );
    assert.equal(INVESTMENT_LAB_MODIFIED_DIETZ_POLICY.complianceClaim, "none");
    assert.doesNotMatch(source, /server-only|\bfetch\s*\(|DATABASE_URL|process\.env/);
    assert.doesNotMatch(
      source,
      /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
    );
  });
});

function value(serviceDate, valueKrw) {
  return { serviceDate, valueKrw };
}

function flow(effectiveServiceDate, sequence, direction, amountKrw) {
  return { effectiveServiceDate, sequence, direction, amountKrw };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
