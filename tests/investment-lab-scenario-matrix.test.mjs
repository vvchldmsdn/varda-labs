import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabScenarioMatrix } from "../src/lib/investment-lab-scenario-matrix.ts";

describe("investment lab scenario comparison matrix", () => {
  it("projects eight existing scenarios in a fixed neutral order", () => {
    const matrix = buildInvestmentLabScenarioMatrix({
      model: readyModel(),
      anchorBasketScenario: readyAnchor(),
      anchorValueWeightScenario: readyValueWeight(),
    });

    assert.equal(matrix.status, "ready");
    assert.deepEqual(
      matrix.rows.map((row) => row.id),
      [
        "actual",
        "zero_return",
        "kodex200",
        "voo",
        "fixed_mix",
        "preperiod_min_volatility",
        "anchor_basket",
        "anchor_value_weight",
      ],
    );
    assert.equal(matrix.coverage.readyRowCount, 8);
    assert.equal(matrix.coverage.unavailableRowCount, 0);
    const rowsById = Object.fromEntries(
      matrix.rows.map((row) => [row.id, row]),
    );
    assert.equal(rowsById.actual.endValueKrw, 1_000);
    assert.equal(rowsById.actual.endDifferenceKrw, 0);
    assert.equal(rowsById.kodex200.returnEstimate.value, 0.2);
    assert.equal(
      rowsById.voo.fxBasis,
      "stored_snapshot_and_execution_usdkrw",
    );
    assert.equal(rowsById.zero_return.returnEstimate.value, 0);
    assert.equal(rowsById.zero_return.riskMetrics.maximumDrawdown, 0);
    assert.equal(rowsById.kodex200.riskMetrics.maximumDrawdown, 0.15);
    assert.equal(rowsById.kodex200.riskMetrics.annualizedVolatility, 0.25);
    assert.ok(matrix.rows.every((row) => row.riskMetrics.status === "ready"));
    assert.equal(rowsById.anchor_basket.flowCount, 2);
    assert.equal(
      rowsById.anchor_basket.priceBasis,
      "anchor_instrument_raw_close",
    );
    assert.equal(rowsById.anchor_value_weight.flowCount, 2);
  });

  it("labels a manual-valued anchor basket without claiming raw closes", () => {
    const anchor = readyAnchor();
    anchor.anchor.instruments = [
      { valuationModel: "listed_close" },
      { valuationModel: "stored_manual" },
    ];

    const matrix = buildInvestmentLabScenarioMatrix({
      model: readyModel(),
      anchorBasketScenario: anchor,
      anchorValueWeightScenario: readyValueWeight(),
    });
    const row = matrix.rows.find(
      (candidate) => candidate.id === "anchor_basket",
    );

    assert.equal(
      row?.priceBasis,
      "anchor_instrument_close_and_stored_manual",
    );
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
      anchorValueWeightScenario: readyValueWeight(),
    });
    const row = matrix.rows.find((candidate) => candidate.id === "anchor_basket");

    assert.ok(row);
    assert.equal(row.status, "unavailable");
    assert.equal(row.endValueKrw, null);
    assert.equal(row.flowCount, null);
    assert.ok(row.reasonCodes.includes("tickerless_anchor_holding"));
    assert.equal(matrix.coverage.readyRowCount, 7);
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
      anchorValueWeightScenario: readyValueWeight(),
    });
    const row = matrix.rows.find((candidate) => candidate.id === "anchor_basket");

    assert.equal(row?.status, "unavailable");
    assert.deepEqual(row?.reasonCodes, ["period_mismatch"]);
    assert.equal(matrix.coverage.readyRowCount, 7);
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
      anchorValueWeightScenario: readyValueWeight(),
    });

    assert.equal(matrix.rows[0].status, "ready");
    assert.equal(matrix.rows[0].returnEstimate.status, "ready");
    const kodexRow = matrix.rows.find((row) => row.id === "kodex200");
    assert.equal(kodexRow?.status, "ready");
    assert.equal(kodexRow?.returnEstimate.status, "unavailable");
    assert.ok(kodexRow?.reasonCodes.includes("price_basis_mismatch"));
  });

  it("fails all rows when the base comparison period is unavailable", () => {
    const model = readyModel();
    model.status = "blocked";
    model.summary = null;
    model.blockers = ["actual_path_incomplete"];
    model.observedPath = {
      status: "unavailable",
      summary: null,
      rows: [],
      returnEstimate: {
        status: "unavailable",
        blockers: ["actual_path_incomplete"],
      },
      blockers: ["actual_path_incomplete"],
    };

    const matrix = buildInvestmentLabScenarioMatrix({
      model,
      anchorBasketScenario: readyAnchor(),
      anchorValueWeightScenario: readyValueWeight(),
    });

    assert.equal(matrix.status, "unavailable");
    assert.equal(matrix.coverage.readyRowCount, 0);
    assert.equal(matrix.coverage.unavailableRowCount, 8);
    assert.ok(matrix.rows.every((row) => row.endValueKrw === null));
  });

  it("isolates a KODEX outage from actual, cash, and VOO rows", () => {
    const model = readyModel();
    model.status = "blocked";
    model.summary = null;
    model.returnEstimate = null;
    model.rows = [];
    model.blockers = ["scenario_close_evidence_invalid"];
    model.fixedMixScenario = {
      status: "unavailable",
      summary: null,
      blockers: ["component_path_unavailable"],
    };
    model.preperiodMinVolatility = {
      ...model.preperiodMinVolatility,
      status: "path_unavailable",
      scenario: { status: "unavailable", summary: null },
      blockers: ["component_path_unavailable"],
    };

    const matrix = buildInvestmentLabScenarioMatrix({
      model,
      anchorBasketScenario: readyAnchor(),
      anchorValueWeightScenario: readyValueWeight(),
    });
    const rows = Object.fromEntries(matrix.rows.map((row) => [row.id, row]));

    assert.equal(matrix.status, "ready");
    assert.equal(rows.actual.status, "ready");
    assert.equal(rows.zero_return.status, "ready");
    assert.equal(rows.voo.status, "ready");
    assert.equal(rows.anchor_basket.status, "ready");
    assert.equal(rows.anchor_value_weight.status, "ready");
    assert.equal(rows.kodex200.status, "unavailable");
    assert.equal(rows.fixed_mix.status, "unavailable");
    assert.equal(rows.preperiod_min_volatility.status, "unavailable");
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
    assert.match(componentSource, /관측 기준 MDD/);
    assert.match(componentSource, /minimumAnnualizedVolatilityPeriods/);
    assert.match(componentSource, /annualizationFactor/);
    assert.match(componentSource, /연속 1일/);
    assert.match(componentSource, /날짜축 불연속/);
    assert.match(componentSource, /근거 축적 중/);
    assert.doesNotMatch(
      componentSource,
      /최고 시나리오|추천 시나리오|주문하기|data-rank/,
    );
  });
});

function readyModel() {
  return {
    status: "ready",
    observedPath: {
      status: "ready",
      summary: {
        startServiceDate: "2026-01-02",
        endServiceDate: "2026-01-05",
        endValueKrw: 1_000,
        comparisonDateCount: 3,
      },
      rows: [
        { serviceDate: "2026-01-02", marketValueKrw: 800 },
        { serviceDate: "2026-01-03", marketValueKrw: 900 },
        { serviceDate: "2026-01-05", marketValueKrw: 1_000 },
      ],
      returnEstimate: {
        status: "ready",
        method: { version: "modified_dietz_daily_weighted_eod_v1" },
        actualReturn: 0.1,
        riskMetrics: risk(0.1, 0.2),
        blockers: [],
      },
      blockers: [],
    },
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
      scenarioRiskMetrics: risk(0.15, 0.25),
      blockers: [],
    },
    vooComparison: {
      status: "ready",
      summary: scenarioSummary(1_100, 100),
      returnEstimate: {
        status: "ready",
        method: { version: "modified_dietz_daily_weighted_eod_v1" },
        scenarioReturn: 0.15,
        scenarioRiskMetrics: risk(0.08, 0.18),
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
        scenarioRiskMetrics: risk(0.09, 0.19),
      },
      coverage: {
        componentFlowSourceCount: 2,
        pendingComparisonRows: 1,
      },
      blockers: [],
    },
    preperiodMinVolatility: {
      status: "ready",
      weights: { kodexWeightBps: 4500, vooWeightBps: 5500 },
      blockers: [],
      scenario: {
        status: "ready",
        summary: scenarioSummary(1_140, 140),
        returnEstimate: {
          method: { version: "modified_dietz_daily_weighted_eod_v1" },
          scenarioReturn: 0.16,
          scenarioRiskMetrics: risk(0.085, 0.185),
        },
        coverage: {
          componentFlowSourceCount: 2,
          pendingComparisonRows: 1,
        },
      },
    },
    cashComparison: {
      status: "ready",
      summary: scenarioSummary(900, -100),
      returnComparison: {
        status: "ready",
        cashReturn: 0,
        scenarioRiskMetrics: risk(0, 0),
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
      scenarioRiskMetrics: risk(0.12, 0.22),
    },
    anchor: { blockers: [], instruments: [] },
    evidenceBlockers: [],
    blockers: [],
    coverage: {
      componentCount: 2,
      sourceFlowCount: 2,
      scenarioFlowLegCount: 4,
      splitExecutionDateRows: 1,
      delayedExecutionLegs: 1,
      pendingComparisonRows: 1,
      manualValuationComponentCount: 0,
      manualObservationRows: 0,
      manualCarryRows: 0,
    },
  };
}

function readyValueWeight() {
  const anchor = readyAnchor();
  return {
    ...anchor,
    weights: [
      { instrumentKey: "korea:KRW:AAA", label: "AAA", weight: 0.6 },
      { instrumentKey: "us:USD:BBB", label: "BBB", weight: 0.4 },
    ],
    summary: {
      ...anchor.summary,
      allocationBasis: "single_scope_anchor_value_weight",
      scenarioEndValueKrw: 1_075,
      endDifferenceKrw: 75,
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

function risk(maximumDrawdown, annualizedVolatility) {
  return {
    status: "ready",
    policy: { version: "cashflow_adjusted_linked_path_risk_v2" },
    maximumDrawdown,
    annualizedVolatility,
    periodCount: 2,
    blockers: [],
  };
}
