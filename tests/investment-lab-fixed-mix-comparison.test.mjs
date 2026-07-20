import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabFixedMixComparison,
  INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY,
  summarizeInvestmentLabFixedMixComparison,
} from "../src/lib/investment-lab-fixed-mix-comparison.ts";

describe("investment lab standard fixed-mix comparison", () => {
  it("builds the three standard mixes in fixed order from shared evidence", () => {
    const comparison = buildInvestmentLabFixedMixComparison(fixture());

    assert.equal(comparison.status, "ready");
    assert.equal(comparison.readyScenarioCount, 3);
    assert.equal(comparison.unavailableScenarioCount, 0);
    assert.deepEqual(
      comparison.scenarios.map((entry) => [
        entry.kodexWeightPct,
        entry.vooWeightPct,
      ]),
      [
        [25, 75],
        [50, 50],
        [75, 25],
      ],
    );
    assert.deepEqual(
      comparison.scenarios.map(
        (entry) => entry.scenario.summary.scenarioEndValueKrw,
      ),
      [1125, 1250, 1375],
    );
    assert.equal(INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY.ranking, "forbidden");
    assert.equal(
      INVESTMENT_LAB_FIXED_MIX_COMPARISON_POLICY.recommendation,
      "forbidden",
    );
  });

  it("retains every preset and its blocker when a shared leg is unavailable", () => {
    const input = fixture();
    input.vooPath = { ...input.vooPath, status: "unavailable" };
    const comparison = buildInvestmentLabFixedMixComparison(input);

    assert.equal(comparison.status, "unavailable");
    assert.equal(comparison.scenarios.length, 3);
    assert.equal(comparison.readyScenarioCount, 0);
    assert.ok(
      comparison.scenarios.every(
        (entry) =>
          entry.scenario.status === "unavailable" &&
          entry.scenario.blockers.includes("component_path_unavailable"),
      ),
    );
  });

  it("summarizes partial results without discarding ready scenarios", () => {
    const ready = buildInvestmentLabFixedMixComparison(fixture());
    const comparison = summarizeInvestmentLabFixedMixComparison([
      ready.scenarios[0],
      {
        ...ready.scenarios[1],
        scenario: {
          ...ready.scenarios[1].scenario,
          status: "unavailable",
          summary: null,
          returnEstimate: null,
          rows: [],
          coverage: {
            componentFlowSourceCount: 0,
            scenarioFlowLegCount: 0,
            splitExecutionDateRows: 0,
            pendingComparisonRows: 0,
          },
          blockers: ["component_path_unavailable"],
        },
      },
      ready.scenarios[2],
    ]);

    assert.equal(comparison.status, "partial");
    assert.equal(comparison.readyScenarioCount, 2);
    assert.equal(comparison.unavailableScenarioCount, 1);
    assert.equal(comparison.scenarios.length, 3);
  });

  it("keeps the comparison server-rendered and read-only", () => {
    const component = readFileSync(
      "src/components/investment-lab/investment-lab-fixed-mix.tsx",
      "utf8",
    );
    const chart = readFileSync(
      "src/components/investment-lab/investment-lab-fixed-mix-comparison-chart.tsx",
      "utf8",
    );
    const standardComparison = readFileSync(
      "src/components/investment-lab/investment-lab-fixed-mix-standard-comparison.tsx",
      "utf8",
    );
    const page = readFileSync("src/app/investment-lab/page.tsx", "utf8");

    assert.doesNotMatch(component, /^"use client";/);
    assert.doesNotMatch(chart, /^"use client";/);
    assert.doesNotMatch(standardComparison, /^"use client";/);
    assert.doesNotMatch(
      `${component}\n${chart}\n${standardComparison}`,
      /\bfetch\s*\(/,
    );
    assert.match(
      standardComparison,
      /data-section="investment-lab-fixed-mix-comparison"/,
    );
    assert.match(page, /comparison=\{model\.fixedMixComparison\}/);
  });
});

function fixture() {
  const actualPath = [
    { serviceDate: "2026-01-02", totalMarketValueKrw: 1000 },
    { serviceDate: "2026-01-05", totalMarketValueKrw: 1100 },
    { serviceDate: "2026-01-06", totalMarketValueKrw: 1200 },
  ];
  return {
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
