import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabScenarioMatrix } from "../src/lib/investment-lab-scenario-matrix.ts";

describe("investment lab scenario comparison matrix", () => {
  it("projects six existing scenarios in a fixed neutral order", () => {
    const matrix = buildInvestmentLabScenarioMatrix({
      model: readyModel(),
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(matrix.status, "ready");
    assert.deepEqual(
      matrix.rows.map((row) => row.id),
      [
        "actual",
        "kodex200",
        "voo",
        "fixed_mix",
        "zero_return",
        "anchor_basket",
      ],
    );
    assert.equal(matrix.coverage.readyRowCount, 6);
    assert.equal(matrix.coverage.unavailableRowCount, 0);
    assert.equal(matrix.rows[0].endValueKrw, 1_000);
    assert.equal(matrix.rows[0].endDifferenceKrw, 0);
    assert.equal(matrix.rows[1].returnEstimate.value, 0.2);
    assert.equal(matrix.rows[2].fxBasis, "stored_snapshot_and_execution_usdkrw");
    assert.equal(matrix.rows[4].returnEstimate.value, 0);
    assert.equal(matrix.rows[5].flowCount, 2);
  });

  it("preserves an unavailable anchor without substituting a partial basket", () => {
    const anchor = readyAnchor();
    anchor.status = "unavailable";
    anchor.summary = null;
    anchor.returnEstimate = null;
    anchor.anchor.blockers = ["tickerless_anchor_holding"];
    anchor.coverage = {
      componentCount: 0,
      sourceFlowCount: 0,
      scenarioFlowLegCount: 0,
      splitExecutionDateRows: 0,
      delayedExecutionLegs: 0,
      pendingComparisonRows: 0,
    };
    anchor.blockers = [
      {
        reason: "anchor_selection_unavailable",
        instrumentKey: null,
        detail: null,
      },
    ];

    const matrix = buildInvestmentLabScenarioMatrix({
      model: readyModel(),
      anchorBasketScenario: anchor,
    });
    const row = matrix.rows.find((candidate) => candidate.id === "anchor_basket");

    assert.ok(row);
    assert.equal(row.status, "unavailable");
    assert.equal(row.endValueKrw, null);
    assert.equal(row.flowCount, null);
    assert.ok(row.reasonCodes.includes("tickerless_anchor_holding"));
    assert.equal(matrix.coverage.readyRowCount, 5);
  });

  it("fails only a source row whose period differs from the common period", () => {
    const anchor = readyAnchor();
    anchor.summary = {
      ...anchor.summary,
      startServiceDate: "2026-01-03",
      comparisonDateCount: 2,
    };

    const matrix = buildInvestmentLabScenarioMatrix({
      model: readyModel(),
      anchorBasketScenario: anchor,
    });
    const row = matrix.rows.find((candidate) => candidate.id === "anchor_basket");

    assert.equal(row?.status, "unavailable");
    assert.deepEqual(row?.reasonCodes, ["period_mismatch"]);
    assert.equal(matrix.coverage.readyRowCount, 5);
    assert.equal(matrix.rows[1].status, "ready");
  });

  it("keeps a ready value path when only its return estimate is unavailable", () => {
    const model = readyModel();
    model.returnEstimate = {
      status: "blocked",
      method: { version: "modified_dietz_daily_weighted_eod_v1" },
      actualReturn: null,
      scenarioReturn: null,
      blockers: ["price_basis_mismatch"],
    };

    const matrix = buildInvestmentLabScenarioMatrix({
      model,
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(matrix.rows[0].status, "ready");
    assert.equal(matrix.rows[0].returnEstimate.status, "unavailable");
    assert.equal(matrix.rows[1].status, "ready");
    assert.ok(matrix.rows[1].reasonCodes.includes("price_basis_mismatch"));
  });

  it("fails all rows when the base comparison period is unavailable", () => {
    const model = readyModel();
    model.status = "blocked";
    model.summary = null;
    model.blockers = ["actual_path_incomplete"];

    const matrix = buildInvestmentLabScenarioMatrix({
      model,
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(matrix.status, "unavailable");
    assert.equal(matrix.coverage.readyRowCount, 0);
    assert.equal(matrix.coverage.unavailableRowCount, 6);
    assert.ok(matrix.rows.every((row) => row.endValueKrw === null));
  });

  it("stays pure and server-rendered without authority or I/O", () => {
    const pureSource = readFileSync(
      "src/lib/investment-lab-scenario-matrix.ts",
      "utf8",
    );
    const componentSource = readFileSync(
      "src/components/investment-lab/investment-lab-scenario-matrix.tsx",
      "utf8",
    );

    assert.doesNotMatch(
      pureSource,
      /server-only|@\/db|process\.env|\bfetch\s*\(/,
    );
    assert.doesNotMatch(
      pureSource,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
    assert.doesNotMatch(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
    assert.match(
      componentSource,
      /data-section="investment-lab-scenario-matrix"/,
    );
    assert.doesNotMatch(
      componentSource,
      /최고 시나리오|추천 시나리오|주문하기|data-rank/,
    );
  });
});

function readyModel() {
  return {
    status: "ready",
    summary: {
      startServiceDate: "2026-01-02",
      endServiceDate: "2026-01-05",
      actualEndValueKrw: 1_000,
      scenarioEndValueKrw: 1_200,
      endDifferenceKrw: 200,
      comparisonDateCount: 3,
    },
    returnEstimate: {
      status: "ready",
      method: { version: "modified_dietz_daily_weighted_eod_v1" },
      actualReturn: 0.1,
      scenarioReturn: 0.2,
      blockers: [],
    },
    vooComparison: {
      status: "ready",
      summary: scenarioSummary(1_100, 100),
      returnEstimate: {
        status: "ready",
        method: { version: "modified_dietz_daily_weighted_eod_v1" },
        scenarioReturn: 0.15,
        blockers: [],
      },
      coverage: {
        appliedFlowRows: 2,
        pendingComparisonRows: 1,
      },
      blockers: [],
    },
    fixedMixScenario: {
      status: "ready",
      weights: { kodexWeightBps: 5000, vooWeightBps: 5000 },
      summary: scenarioSummary(1_150, 150),
      returnEstimate: {
        method: { version: "modified_dietz_daily_weighted_eod_v1" },
        scenarioReturn: 0.17,
      },
      coverage: {
        componentFlowSourceCount: 2,
        pendingComparisonRows: 1,
      },
      blockers: [],
    },
    cashComparison: {
      status: "ready",
      summary: scenarioSummary(900, -100),
      returnComparison: {
        status: "ready",
        cashReturn: 0,
        blockers: [],
      },
      coverage: { appliedFlowRows: 2 },
      blockers: [],
    },
    coverage: {
      eligibleFlowRows: 2,
      appliedFlowRows: 2,
      pendingComparisonRows: 1,
    },
    blockers: [],
  };
}

function readyAnchor() {
  return {
    status: "ready",
    summary: {
      ...scenarioSummary(1_050, 50),
      instrumentCount: 2,
      equalWeightPct: 50,
    },
    returnEstimate: {
      method: { version: "modified_dietz_daily_weighted_eod_v1" },
      scenarioReturn: 0.12,
    },
    anchor: { blockers: [] },
    evidenceBlockers: [],
    blockers: [],
    coverage: {
      componentCount: 2,
      sourceFlowCount: 2,
      scenarioFlowLegCount: 4,
      splitExecutionDateRows: 1,
      delayedExecutionLegs: 1,
      pendingComparisonRows: 1,
    },
  };
}

function scenarioSummary(scenarioEndValueKrw, endDifferenceKrw) {
  return {
    startServiceDate: "2026-01-02",
    endServiceDate: "2026-01-05",
    actualEndValueKrw: 1_000,
    scenarioEndValueKrw,
    endDifferenceKrw,
    comparisonDateCount: 3,
  };
}
