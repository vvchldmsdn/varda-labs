import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabFixedMixScenario } from "../src/lib/investment-lab-fixed-mix.ts";
import { resolveInvestmentLabFixedMixSelection } from "../src/lib/investment-lab-fixed-mix-selection.ts";

describe("investment lab KODEX 200 and VOO fixed allocation", () => {
  it("defaults to an explicit 50:50 selection and rejects ambiguous weights", () => {
    assert.deepEqual(resolveInvestmentLabFixedMixSelection(undefined), {
      status: "default",
      kodexWeightPct: 50,
      vooWeightPct: 50,
      kodexWeightBps: 5000,
      vooWeightBps: 5000,
      reason: null,
    });
    assert.equal(resolveInvestmentLabFixedMixSelection("25").status, "selected");
    assert.equal(
      resolveInvestmentLabFixedMixSelection(["25", "50"]).reason,
      "ambiguous_query",
    );
    assert.equal(resolveInvestmentLabFixedMixSelection("25.5").reason, "invalid_format");
    assert.equal(resolveInvestmentLabFixedMixSelection("0").reason, "out_of_range");
    assert.equal(resolveInvestmentLabFixedMixSelection("100").reason, "out_of_range");
  });

  it("splits every flow by weight and combines independently valued legs", () => {
    const model = buildInvestmentLabFixedMixScenario(fixture());

    assert.equal(model.status, "ready");
    assert.deepEqual(model.weights, {
      kodexWeightBps: 5000,
      vooWeightBps: 5000,
    });
    assert.deepEqual(
      model.rows.map((row) => row.scenarioMarketValueKrw),
      [1000, 1100, 1250],
    );
    assert.equal(model.summary.scenarioEndValueKrw, 1250);
    assert.equal(model.summary.endDifferenceKrw, 50);
    assert.equal(model.coverage.componentFlowSourceCount, 1);
    assert.equal(model.coverage.scenarioFlowLegCount, 2);
    assert.equal(model.coverage.splitExecutionDateRows, 1);
    assert.equal(model.returnEstimate.actualReturn, 0.1);
    assert.ok(Number.isFinite(model.returnEstimate.scenarioReturn));
  });

  it("uses the requested allocation without rebalancing component paths", () => {
    const input = fixture();
    input.selection = resolveInvestmentLabFixedMixSelection("25");
    const model = buildInvestmentLabFixedMixScenario(input);

    assert.equal(model.status, "ready");
    assert.deepEqual(
      model.rows.map((row) => row.scenarioMarketValueKrw),
      [1000, 1000, 1125],
    );
    assert.equal(model.weights.kodexWeightBps, 2500);
    assert.equal(model.weights.vooWeightBps, 7500);
  });

  it("fails the whole scenario for a missing leg, axis drift, or flow drift", () => {
    const missingLeg = fixture();
    missingLeg.vooPath = { ...missingLeg.vooPath, status: "blocked" };
    assert.deepEqual(
      buildInvestmentLabFixedMixScenario(missingLeg).blockers,
      ["component_path_unavailable"],
    );

    const axisDrift = fixture();
    axisDrift.vooPath = {
      ...axisDrift.vooPath,
      rows: axisDrift.vooPath.rows.map((row, index) =>
        index === 1 ? { ...row, serviceDate: "2026-01-04" } : row,
      ),
    };
    assert.deepEqual(
      buildInvestmentLabFixedMixScenario(axisDrift).blockers,
      ["valuation_axis_mismatch"],
    );

    const flowDrift = fixture();
    flowDrift.vooPath = {
      ...flowDrift.vooPath,
      appliedFlows: [{ ...flowDrift.vooPath.appliedFlows[0], amountKrw: 99 }],
    };
    assert.deepEqual(
      buildInvestmentLabFixedMixScenario(flowDrift).blockers,
      ["component_flow_mismatch"],
    );
  });

  it("requires both component return estimates to use the same actual basis", () => {
    const unavailable = fixture();
    unavailable.vooReturnEvidence = null;
    assert.deepEqual(
      buildInvestmentLabFixedMixScenario(unavailable).blockers,
      ["return_evidence_unavailable"],
    );

    const mismatch = fixture();
    mismatch.vooReturnEvidence = { status: "ready", actualReturn: 0.2 };
    assert.deepEqual(
      buildInvestmentLabFixedMixScenario(mismatch).blockers,
      ["actual_return_mismatch"],
    );
  });

  it("keeps the feature server-rendered and free of runtime authority", () => {
    const pureSource = [
      "src/lib/investment-lab-fixed-mix.ts",
      "src/lib/investment-lab-fixed-mix-flows.ts",
      "src/lib/investment-lab-fixed-mix-selection.ts",
      "src/lib/investment-lab-fixed-mix-types.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const componentSource = readFileSync(
      "src/components/investment-lab/investment-lab-fixed-mix.tsx",
      "utf8",
    );
    const pageSource = readFileSync("src/app/investment-lab/page.tsx", "utf8");

    assert.doesNotMatch(pureSource, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      pureSource,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
    assert.doesNotMatch(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
    assert.match(componentSource, /data-section="investment-lab-fixed-mix"/);
    assert.match(componentSource, /name="kodexWeight"/);
    assert.match(pageSource, /params\.kodexWeight/);
    assert.match(pageSource, /model\.fixedMixScenario/);
  });
});

function fixture() {
  const actualPath = [
    { serviceDate: "2026-01-02", totalMarketValueKrw: 1000 },
    { serviceDate: "2026-01-05", totalMarketValueKrw: 1100 },
    { serviceDate: "2026-01-06", totalMarketValueKrw: 1200 },
  ];
  return {
    selection: resolveInvestmentLabFixedMixSelection(undefined),
    actualPath,
    kodexPath: path(actualPath, [1000, 1300, 1500], "2026-01-05"),
    vooPath: path(actualPath, [1000, 900, 1000], "2026-01-06"),
    kodexReturnEvidence: { status: "ready", actualReturn: 0.1 },
    vooReturnEvidence: { status: "ready", actualReturn: 0.1 },
  };
}

function path(actualPath, values, executionServiceDate) {
  return {
    status: "ready",
    rows: actualPath.map((actual, index) => ({
      serviceDate: actual.serviceDate,
      actualMarketValueKrw: actual.totalMarketValueKrw,
      investedMarketValueKrw: values[index],
      comparisonBasis: "position_value_only",
    })),
    appliedFlows: [
      {
        sourceIndex: 0,
        executionServiceDate,
        direction: "inflow",
        amountKrw: 100,
      },
    ],
  };
}
