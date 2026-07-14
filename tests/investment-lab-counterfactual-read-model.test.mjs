import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";
import { resolveInvestmentLabFixedMixSelection } from "../src/lib/investment-lab-fixed-mix-selection.ts";

describe("investment lab counterfactual read model", () => {
  it("builds a minimized aggregate KODEX 200 comparison", () => {
    const result = buildInvestmentLabCounterfactualReadModel(fixture());

    assert.equal(result.status, "ready");
    assert.deepEqual(result.summary, {
      startServiceDate: "2026-01-02",
      endServiceDate: "2026-01-07",
      actualEndValueKrw: 1_150,
      scenarioEndValueKrw: 1_452,
      endDifferenceKrw: 302,
      comparisonDateCount: 4,
    });
    assert.equal(result.coverage.snapshotSourceRows, 12);
    assert.equal(result.coverage.completeComparisonDates, 4);
    assert.equal(result.coverage.eligibleFlowRows, 3);
    assert.equal(result.coverage.appliedFlowRows, 3);
    assert.equal(result.coverage.delayedExecutionRows, 2);
    assert.equal(result.coverage.pendingComparisonRows, 2);
    assert.equal(result.coverage.pendingAtEndRows, 0);
    assert.equal(result.rows[1].hasPendingExecution, true);
    assert.equal(result.rows.at(-1).scenarioMarketValueKrw, 1_452);
    assert.equal(result.returnEstimate.status, "ready");
    assert.ok(closeTo(result.returnEstimate.scenarioReturn, 0.21));
    assert.equal(result.returnEstimate.periodCount, 3);
    assert.equal(result.returnEstimate.actualFlowCount, 3);
    assert.equal(result.returnEstimate.scenarioFlowCount, 3);
    assert.equal(result.returnEstimate.evidence.status, "ready");
    assert.equal(result.vooReadiness.status, "ready");
    assert.equal(result.vooReadiness.valuationPriceReadyCount, 4);
    assert.equal(result.vooReadiness.snapshotFxReadyCount, 4);
    assert.equal(result.vooReadiness.snapshotFxProvenanceReadyCount, 4);
    assert.equal(result.vooComparison.status, "ready");
    assert.equal(result.vooComparison.rows.length, 4);
    assert.equal(result.vooComparison.coverage.appliedFlowRows, 3);
    assert.equal(result.vooComparison.returnEstimate.status, "ready");
    assert.equal(result.cashComparison.status, "ready");
    assert.deepEqual(
      result.cashComparison.rows.map((row) => row.scenarioMarketValueKrw),
      [1_000, 1_110, 1_110, 1_231],
    );
    assert.equal(result.cashComparison.summary.endDifferenceKrw, 81);
    assert.equal(result.cashComparison.coverage.appliedFlowRows, 3);
    assert.equal(result.cashComparison.returnComparison.status, "ready");
    assert.equal(result.cashComparison.returnComparison.cashReturn, 0);
    assert.deepEqual(
      result.contributionExperimentScenarios.map((scenario) =>
        scenario.scenarioId,
      ),
      ["kodex200", "voo"],
    );
    assert.equal(
      result.contributionExperimentScenarios[0].points[0].unitValueKrw,
      100,
    );
    assert.equal(
      result.contributionExperimentScenarios[1].points[0].unitValueKrw,
      130_000,
    );
  });

  it("builds the fixed mix only when an explicit selection is requested", () => {
    const withoutSelection = buildInvestmentLabCounterfactualReadModel(
      fixture(),
    );
    const withSelection = buildInvestmentLabCounterfactualReadModel(
      fixture(),
      {
        fixedMixSelection: resolveInvestmentLabFixedMixSelection("25"),
      },
    );

    assert.equal(withoutSelection.fixedMixScenario, null);
    assert.equal(withSelection.fixedMixScenario.status, "ready");
    assert.equal(withSelection.fixedMixScenario.weights.kodexWeightBps, 2500);
    assert.equal(withSelection.fixedMixScenario.weights.vooWeightBps, 7500);
    assert.equal(withSelection.fixedMixScenario.rows.length, 4);
    assert.equal(
      withSelection.fixedMixScenario.coverage.scenarioFlowLegCount,
      6,
    );
    assert.equal(withSelection.fixedMixScenario.returnEstimate.method.version,
      "modified_dietz_daily_weighted_eod_v1");
  });

  it("blocks duplicate snapshot evidence without returning partial values", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: [...source.snapshotRows, source.snapshotRows[0]],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.summary, null);
    assert.deepEqual(result.rows, []);
    assert.equal(result.cashComparison, null);
    assert.deepEqual(result.contributionExperimentScenarios, []);
    assert.deepEqual(result.blockers, ["snapshot_evidence_invalid"]);
  });

  it("blocks a stored all row that disagrees with the named-account sum", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: [
        ...source.snapshotRows,
        {
          snapshotDate: "2026-01-02",
          account: "all",
          totalMarketValue: 999,
        },
      ],
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      "actual_path_reconciliation_mismatch",
    ]);
  });

  it("accepts a zero-valued named account inside a positive aggregate", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: source.snapshotRows.map((row) =>
        row.account === "irp"
          ? { ...row, totalMarketValue: 0 }
          : row,
      ),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.completeComparisonDates, 4);
  });

  it("blocks only the return estimate when close bases diverge", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      closeRows: source.closeRows.map((row, index) =>
        index === 0 ? { ...row, closePrice: 99 } : row,
      ),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.rows.length, 4);
    assert.equal(result.returnEstimate.status, "blocked");
    assert.deepEqual(result.returnEstimate.blockers, [
      "price_basis_mismatch",
    ]);
    assert.equal(result.returnEstimate.basisMismatchRows, 1);
    assert.equal(result.cashComparison.status, "ready");
    assert.equal(
      result.cashComparison.returnComparison.status,
      "unavailable",
    );
  });

  it("blocks only the return estimate when cash evidence is nonzero", () => {
    const source = fixture();
    source.snapshotRows[0] = { ...source.snapshotRows[0], cashValue: 1 };
    const result = buildInvestmentLabCounterfactualReadModel(source);

    assert.equal(result.status, "ready");
    assert.equal(result.rows.length, 4);
    assert.equal(result.returnEstimate.status, "blocked");
    assert.deepEqual(result.returnEstimate.blockers, [
      "nonzero_cash_evidence",
    ]);
  });

  it("blocks only the return estimate for financial lifecycle payload", () => {
    const source = fixture();
    const index = source.eventRows.findIndex(
      (row) => row.eventType === "asset_added",
    );
    source.eventRows[index] = { ...source.eventRows[index], amountKrw: 1 };
    const result = buildInvestmentLabCounterfactualReadModel(source);

    assert.equal(result.status, "ready");
    assert.equal(result.returnEstimate.status, "blocked");
    assert.deepEqual(result.returnEstimate.blockers, [
      "ambiguous_position_metadata_event",
    ]);
  });

  it("keeps KODEX results while VOO evidence is unavailable", () => {
    const source = fixture();
    source.fxRows = [];
    const result = buildInvestmentLabCounterfactualReadModel(source);

    assert.equal(result.status, "ready");
    assert.equal(result.returnEstimate.status, "ready");
    assert.equal(result.vooReadiness.status, "unavailable");
    assert.equal(result.vooComparison.status, "unavailable");
    assert.deepEqual(
      result.contributionExperimentScenarios.map((scenario) =>
        scenario.scenarioId,
      ),
      ["kodex200"],
    );
    assert.deepEqual(result.vooReadiness.blockers, [
      "missing_execution_fx",
    ]);
  });

  it("keeps internal identifiers and secret-shaped fields out of the model", () => {
    const serialized = JSON.stringify(
      buildInvestmentLabCounterfactualReadModel(fixture()),
    );

    assert.doesNotMatch(serialized, /legacyBase44Id|assetId|holdingId|ownerUserId|canonicalOwner/i);
    assert.doesNotMatch(serialized, /authorization|api[_-]?key|password|secret|token|cookie/i);
  });

  it("keeps the route server-rendered, read-only, and Basic Auth protected", () => {
    const query = readFileSync("src/db/queries/investment-lab.ts", "utf8");
    const page = readFileSync("src/app/investment-lab/page.tsx", "utf8");
    const contribution = readFileSync(
      "src/components/investment-lab/investment-lab-contribution-experiment.tsx",
      "utf8",
    );
    const cashComparison = readFileSync(
      "src/components/investment-lab/investment-lab-cash-comparison.tsx",
      "utf8",
    );
    const view = readFileSync(
      "src/components/investment-lab/investment-lab-view.tsx",
      "utf8",
    );
    const proxy = readFileSync("src/proxy.ts", "utf8");

    assert.match(query, /^import "server-only";/);
    assert.doesNotMatch(query, /\.select\(\s*\)/);
    assert.doesNotMatch(query, /\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(
      query,
      /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
    );
    assert.doesNotMatch(page, /["']use client["']|\bfetch\s*\(/);
    assert.match(page, /getReadOnlyInvestmentLabCounterfactual/);
    assert.match(contribution, /^["']use client["'];/);
    assert.match(contribution, /calculateInvestmentLabContributionExperiment/);
    assert.doesNotMatch(
      contribution,
      /\bfetch\s*\(|\/api\/|localStorage|sessionStorage|URLSearchParams|console\./,
    );
    assert.doesNotMatch(cashComparison, /["']use client["']/);
    assert.doesNotMatch(
      cashComparison,
      /\bfetch\s*\(|\/api\/|localStorage|sessionStorage|URLSearchParams|console\./,
    );
    assert.match(view, /InvestmentLabCashComparisonView/);
    assert.match(proxy, /"\/investment-lab"/);
  });
});

function fixture() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", 1_000),
      ...snapshotDate("2026-01-05", 1_050),
      ...snapshotDate("2026-01-06", 1_100),
      ...snapshotDate("2026-01-07", 1_150),
    ],
    eventRows: [
      event("2026-01-03", 0, "buy", 220),
      event("2026-01-04", 1, "sell", 110),
      event("2026-01-06", 2, "buy", 121),
      event("2026-01-04", 3, "asset_added", null),
    ],
    closeRows: [
      price("2026-01-01", 100, 100),
      price("2026-01-05", 110, 110),
      price("2026-01-06", 121, 121),
    ],
    vooCloseRows: [
      price("2025-12-31", 100, 101),
      price("2026-01-02", 101, 102),
      price("2026-01-05", 102, 103),
      price("2026-01-06", 103, 104),
    ],
    fxRows: [
      {
        rateDate: "2026-01-05",
        usdKrw: 1_300,
        source: "fx_fixture",
        status: "ok",
      },
      {
        rateDate: "2026-01-06",
        usdKrw: 1_301,
        source: "fx_fixture",
        status: "ok",
      },
    ],
  };
}

function snapshotDate(snapshotDate, total) {
  return [
    {
      snapshotDate,
      account: "brokerage",
      cashValue: 0,
      totalMarketValue: total * 0.5,
      usdKrw: 1_300,
      source: "snapshot_fixture",
      ruleVersion: "snapshot-fixture-v1",
    },
    {
      snapshotDate,
      account: "isa",
      cashValue: 0,
      totalMarketValue: total * 0.3,
      usdKrw: 1_300,
      source: "snapshot_fixture",
      ruleVersion: "snapshot-fixture-v1",
    },
    {
      snapshotDate,
      account: "irp",
      cashValue: 0,
      totalMarketValue: total * 0.2,
      usdKrw: 1_300,
      source: "snapshot_fixture",
      ruleVersion: "snapshot-fixture-v1",
    },
  ];
}

function event(eventDate, sequence, eventType, amountKrw) {
  return {
    eventDate,
    eventType,
    sequence,
    amountKrw,
    quantityDelta: null,
    price: null,
    fxRate: null,
    assetCurrency: "KRW",
    isCorrection: false,
  };
}

function price(priceDate, closePrice, adjustedClosePrice) {
  return {
    priceDate,
    closePrice,
    adjustedClosePrice,
    source: "price_fixture",
  };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
