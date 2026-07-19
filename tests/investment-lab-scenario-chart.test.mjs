import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabScenarioChart } from "../src/lib/investment-lab-scenario-chart.ts";

describe("investment lab multi-scenario chart", () => {
  it("projects all ready scenarios on the observed date axis", () => {
    const chart = buildInvestmentLabScenarioChart({
      model: readyModel(),
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(chart.status, "ready");
    assert.deepEqual(
      chart.lines.map((line) => line.id),
      [
        "actual",
        "zero_return",
        "kodex200",
        "voo",
        "fixed_mix",
        "anchor_basket",
      ],
    );
    assert.equal(chart.period.comparisonDateCount, 3);
    assert.deepEqual(chart.unavailableScenarioIds, []);
  });

  it("omits only KODEX-dependent lines when KODEX evidence is unavailable", () => {
    const model = readyModel();
    model.status = "blocked";
    model.summary = null;
    model.rows = [];
    model.fixedMixScenario = {
      status: "unavailable",
      weights: { kodexWeightBps: 5000, vooWeightBps: 5000 },
      rows: [],
    };

    const chart = buildInvestmentLabScenarioChart({
      model,
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(chart.status, "partial");
    assert.deepEqual(
      chart.lines.map((line) => line.id),
      ["actual", "zero_return", "voo", "anchor_basket"],
    );
    assert.deepEqual(chart.unavailableScenarioIds, ["kodex200", "fixed_mix"]);
  });

  it("does not trim or interpolate a scenario with a mismatched axis", () => {
    const model = readyModel();
    model.vooComparison.rows = model.vooComparison.rows.slice(1);

    const chart = buildInvestmentLabScenarioChart({
      model,
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(chart.status, "partial");
    assert.equal(chart.lines.some((line) => line.id === "voo"), false);
    assert.ok(chart.unavailableScenarioIds.includes("voo"));
  });

  it("omits a path whose initial value does not match the observed anchor", () => {
    const model = readyModel();
    model.cashComparison.rows[0] = {
      ...model.cashComparison.rows[0],
      scenarioMarketValueKrw: 900,
    };

    const chart = buildInvestmentLabScenarioChart({
      model,
      anchorBasketScenario: readyAnchor(),
    });

    assert.equal(chart.status, "partial");
    assert.equal(chart.lines.some((line) => line.id === "zero_return"), false);
    assert.ok(chart.unavailableScenarioIds.includes("zero_return"));
    assert.equal(
      chart.policy.initialAnchorRequirement,
      "same_scope_adjusted_initial_value",
    );
    assert.equal(chart.policy.yDomain, "single_domain_across_ready_paths");
  });

  it("remains server-rendered and free of ranking or data I/O", () => {
    const pureSource = readFileSync(
      "src/lib/investment-lab-scenario-chart.ts",
      "utf8",
    );
    const componentSource = readFileSync(
      "src/components/investment-lab/investment-lab-scenario-chart.tsx",
      "utf8",
    );

    assert.doesNotMatch(pureSource, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(componentSource, /^["']use client["'];/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(
      `${pureSource}\n${componentSource}`,
      /data-rank|최고 시나리오|추천 시나리오/i,
    );
  });
});

function readyModel() {
  const dates = ["2026-01-02", "2026-01-05", "2026-01-06"];
  const actual = [1000, 1050, 1100];
  return {
    status: "ready",
    observedPath: {
      status: "ready",
      summary: {
        startServiceDate: dates[0],
        endServiceDate: dates.at(-1),
        endValueKrw: actual.at(-1),
        comparisonDateCount: dates.length,
      },
      rows: dates.map((serviceDate, index) => ({
        serviceDate,
        marketValueKrw: actual[index],
      })),
    },
    summary: scenarioSummary(dates, actual, [1000, 1100, 1200]),
    rows: scenarioRows(dates, actual, [1000, 1100, 1200]),
    cashComparison: {
      status: "ready",
      rows: scenarioRows(dates, actual, [1000, 1000, 1000]),
    },
    vooComparison: {
      status: "ready",
      rows: scenarioRows(dates, actual, [1000, 1075, 1150]),
    },
    fixedMixScenario: {
      status: "ready",
      weights: { kodexWeightBps: 5000, vooWeightBps: 5000 },
      rows: scenarioRows(dates, actual, [1000, 1088, 1175]),
    },
  };
}

function readyAnchor() {
  const dates = ["2026-01-02", "2026-01-05", "2026-01-06"];
  return {
    status: "ready",
    summary: {
      allocationBasis: "single_scope_equal_weight",
    },
    rows: scenarioRows(dates, [1000, 1050, 1100], [1000, 1060, 1120]),
  };
}

function scenarioRows(dates, actual, scenario) {
  return dates.map((serviceDate, index) => ({
    serviceDate,
    actualMarketValueKrw: actual[index],
    scenarioMarketValueKrw: scenario[index],
    hasPendingExecution: false,
  }));
}

function scenarioSummary(dates, actual, scenario) {
  return {
    startServiceDate: dates[0],
    endServiceDate: dates.at(-1),
    actualEndValueKrw: actual.at(-1),
    scenarioEndValueKrw: scenario.at(-1),
    endDifferenceKrw: scenario.at(-1) - actual.at(-1),
    comparisonDateCount: dates.length,
  };
}
