import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvestmentLabCashComparison,
  INVESTMENT_LAB_CASH_COMPARISON_POLICY,
} from "../src/lib/investment-lab-cash-comparison.ts";

describe("investment lab all-cash same-flow comparison", () => {
  it("keeps a zero-return cash path while applying the same dated KRW flows", () => {
    const result = buildInvestmentLabCashComparison({
      actualPath: actualPath(),
      boundaryFlows: flows(),
      actualReturnEstimate: readyActualReturn(0.12),
    });

    assert.equal(result.status, "ready");
    assert.equal(
      result.policy.version,
      "zero_return_same_flow_cash_v1",
    );
    assert.deepEqual(
      result.rows.map((row) => row.scenarioMarketValueKrw),
      [1_000, 1_110, 1_110, 1_231],
    );
    assert.equal(result.summary.scenarioEndValueKrw, 1_231);
    assert.equal(result.summary.endDifferenceKrw, 81);
    assert.equal(result.coverage.appliedFlowRows, 3);
    assert.equal(result.returnComparison.status, "ready");
    assert.equal(result.returnComparison.cashReturn, 0);
    assert.equal(result.returnComparison.actualReturn, 0.12);
    assert.equal(result.returnComparison.differencePercentagePoints, -12);
  });

  it("keeps cash constant when the window has no boundary flows", () => {
    const result = buildInvestmentLabCashComparison({
      actualPath: actualPath(),
      boundaryFlows: [],
      actualReturnEstimate: readyActualReturn(0.01),
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.rows.map((row) => row.scenarioMarketValueKrw),
      [1_000, 1_000, 1_000, 1_000],
    );
    assert.equal(result.returnComparison.cashReturn, 0);
  });

  it("keeps the path but withholds the return difference when actual return evidence is blocked", () => {
    const result = buildInvestmentLabCashComparison({
      actualPath: actualPath(),
      boundaryFlows: flows(),
      actualReturnEstimate: { status: "blocked" },
    });

    assert.equal(result.status, "ready");
    assert.equal(result.returnComparison.status, "unavailable");
    assert.equal(result.returnComparison.cashReturn, 0);
    assert.deepEqual(result.returnComparison.blockers, [
      "actual_return_unavailable",
    ]);
  });

  it("fails closed when a hypothetical withdrawal would make cash negative", () => {
    const result = buildInvestmentLabCashComparison({
      actualPath: actualPath(),
      boundaryFlows: [flow("2026-01-03", 0, "outflow", 1_500)],
      actualReturnEstimate: readyActualReturn(0),
    });

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.blockers, ["cash_balance_negative"]);
    assert.deepEqual(result.rows, []);
  });

  it("rejects invalid and duplicate boundary-flow identity", () => {
    for (const boundaryFlows of [
      [flow("invalid", 0, "inflow", 10)],
      [
        flow("2026-01-03", 0, "inflow", 10),
        flow("2026-01-03", 0, "outflow", 5),
      ],
    ]) {
      const result = buildInvestmentLabCashComparison({
        actualPath: actualPath(),
        boundaryFlows,
        actualReturnEstimate: readyActualReturn(0),
      });

      assert.equal(result.status, "unavailable");
      assert.deepEqual(result.blockers, ["invalid_boundary_flow"]);
    }
  });

  it("allows the same sequence number on different event dates", () => {
    const result = buildInvestmentLabCashComparison({
      actualPath: actualPath(),
      boundaryFlows: [
        flow("2026-01-03", 0, "inflow", 10),
        flow("2026-01-04", 0, "outflow", 5),
      ],
      actualReturnEstimate: readyActualReturn(0),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.appliedFlowRows, 2);
    assert.equal(result.rows[1].scenarioMarketValueKrw, 1_005);
  });

  it("does not serialize identity or secret-shaped fields", () => {
    const serialized = JSON.stringify(
      buildInvestmentLabCashComparison({
        actualPath: actualPath(),
        boundaryFlows: flows(),
        actualReturnEstimate: readyActualReturn(0.05),
      }),
    );

    assert.equal(INVESTMENT_LAB_CASH_COMPARISON_POLICY.persistence, "none");
    assert.doesNotMatch(
      serialized,
      /legacy|assetId|ownerUserId|authorization|api[_-]?key|password|secret|token|cookie/i,
    );
  });
});

function actualPath() {
  return [
    { serviceDate: "2026-01-02", totalMarketValueKrw: 1_000 },
    { serviceDate: "2026-01-05", totalMarketValueKrw: 1_050 },
    { serviceDate: "2026-01-06", totalMarketValueKrw: 1_100 },
    { serviceDate: "2026-01-07", totalMarketValueKrw: 1_150 },
  ];
}

function flows() {
  return [
    flow("2026-01-03", 0, "inflow", 220),
    flow("2026-01-04", 1, "outflow", 110),
    flow("2026-01-06", 2, "inflow", 121),
  ];
}

function flow(eventDate, sequence, direction, amountKrw) {
  return { eventDate, sequence, direction, amountKrw };
}

function readyActualReturn(actualReturn) {
  return { status: "ready", actualReturn };
}
