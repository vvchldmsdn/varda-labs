import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabPreperiodMinVolatility,
  INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY,
} from "../src/lib/investment-lab-preperiod-min-volatility.ts";
import { estimateTwoAssetMinimumVariance } from "../src/lib/two-asset-minimum-variance.ts";

describe("investment lab pre-period minimum-volatility research", () => {
  it("estimates fixed weights only from the latest 60 pre-period common returns", () => {
    const result = buildInvestmentLabPreperiodMinVolatility(fixture());

    assert.equal(result.status, "ready");
    assert.equal(result.training.returnObservationCount, 60);
    assert.equal(result.training.usedPriceDateCount, 61);
    assert.ok(result.training.endPriceDate < "2026-01-10");
    assert.equal(
      result.weights.kodexWeightBps + result.weights.vooWeightBps,
      10_000,
    );
    assert.ok(result.weights.kodexWeightBps >= 1);
    assert.ok(result.weights.vooWeightBps >= 1);
    assert.equal(result.scenario.status, "ready");
    assert.equal(result.scenario.rows.length, 3);
    assert.equal(result.policy.rebalancing, "none");
  });

  it("does not let rows on or after the observed start change the weights", () => {
    const source = fixture();
    const baseline = buildInvestmentLabPreperiodMinVolatility(source);
    const changed = buildInvestmentLabPreperiodMinVolatility({
      ...source,
      kodexPriceRows: [
        ...source.kodexPriceRows,
        price("2026-01-10", 1_000_000, 1_000_000),
        price("2026-02-01", 1, 1),
      ],
      vooPriceRows: [
        ...source.vooPriceRows,
        price("2026-01-10", 1, 1),
        price("2026-02-01", 1_000_000, 1_000_000),
      ],
      fxRows: [
        ...source.fxRows,
        fx("2026-01-10", 10_000),
        fx("2026-02-01", 100),
      ],
    });

    assert.equal(baseline.status, "ready");
    assert.equal(changed.status, "ready");
    assert.deepEqual(changed.weights, baseline.weights);
    assert.deepEqual(changed.training, baseline.training);
  });

  it("leaves only this scenario unavailable when common training rows are short", () => {
    const source = fixture();
    const result = buildInvestmentLabPreperiodMinVolatility({
      ...source,
      kodexPriceRows: source.kodexPriceRows.slice(-40),
      vooPriceRows: source.vooPriceRows.slice(-40),
      fxRows: source.fxRows.slice(-40),
    });

    assert.equal(result.status, "training_unavailable");
    assert.equal(result.training, null);
    assert.equal(result.scenario, null);
    assert.deepEqual(result.blockers, [
      "insufficient_common_preperiod_rows",
    ]);
  });

  it("keeps estimated weights when the evaluation path is unavailable", () => {
    const source = fixture();
    const result = buildInvestmentLabPreperiodMinVolatility({
      ...source,
      kodexPath: { status: "unavailable", rows: [], appliedFlows: [] },
    });

    assert.equal(result.status, "path_unavailable");
    assert.ok(result.training);
    assert.equal(result.weights.kodexWeightBps + result.weights.vooWeightBps, 10_000);
    assert.equal(result.scenario.status, "unavailable");
    assert.ok(result.blockers.includes("component_path_unavailable"));
  });

  it("omits an ambiguous date without blocking a still-complete training window", () => {
    const source = fixture();
    const duplicate = source.kodexPriceRows.at(-10);
    const result = buildInvestmentLabPreperiodMinVolatility({
      ...source,
      kodexPriceRows: [...source.kodexPriceRows, { ...duplicate }],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.invalidOrAmbiguousKodexDates, 1);
    assert.equal(result.training.returnObservationCount, 60);
  });

  it("shares the same stable two-asset estimator and preserves both legs", () => {
    const result = estimateTwoAssetMinimumVariance({
      leftReturns: Array.from({ length: 60 }, () => 0),
      rightReturns: Array.from({ length: 60 }, (_, index) =>
        index % 2 === 0 ? 0.05 : -0.04,
      ),
      covarianceShrinkage: 0.1,
      varianceFloor: 1e-12,
      annualizationFactor: 252,
      minimumComponentWeightBps: 1,
    });

    assert.ok(result);
    assert.equal(result.leftWeightBps, 9_999);
    assert.equal(result.rightWeightBps, 1);
  });

  it("stays pure and explicitly forbids backfill, interpolation, and recommendation authority", () => {
    const source = readFileSync(
      "src/lib/investment-lab-preperiod-min-volatility.ts",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.providerBackfill,
      "forbidden",
    );
    assert.equal(
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.interpolation,
      "forbidden",
    );
    assert.equal(
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.authority,
      "retrospective_research_only_not_recommendation",
    );
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
  });
});

function fixture() {
  const trainingDates = Array.from({ length: 70 }, (_, index) =>
    addDays("2025-10-01", index),
  );
  const actualPath = [
    { serviceDate: "2026-01-10", totalMarketValueKrw: 1_000 },
    { serviceDate: "2026-01-11", totalMarketValueKrw: 1_060 },
    { serviceDate: "2026-01-12", totalMarketValueKrw: 1_120 },
  ];
  return {
    observedStartServiceDate: actualPath[0].serviceDate,
    actualPath,
    kodexPath: componentPath(actualPath, [1_000, 1_040, 1_090]),
    vooPath: componentPath(actualPath, [1_000, 1_020, 1_070]),
    kodexReturnEvidence: { status: "ready", actualReturn: 0.1 },
    vooReturnEvidence: { status: "ready", actualReturn: 0.1 },
    kodexPriceRows: trainingDates.map((date, index) =>
      price(date, 100 + index * 0.7, 100 + index * 0.7 + (index % 3) * 0.2),
    ),
    vooPriceRows: trainingDates.map((date, index) =>
      price(date, 50 + index * 0.35 + (index % 5) * 0.1, 51 + index * 0.35),
    ),
    fxRows: trainingDates.map((date, index) => fx(date, 1_300 + index * 0.2)),
  };
}

function componentPath(actualPath, values) {
  return {
    status: "ready",
    rows: actualPath.map((row, index) => ({
      serviceDate: row.serviceDate,
      actualMarketValueKrw: row.totalMarketValueKrw,
      investedMarketValueKrw: values[index],
      comparisonBasis: "position_value_only",
    })),
    appliedFlows: [],
  };
}

function price(priceDate, closePrice, adjustedClosePrice) {
  return {
    priceDate,
    closePrice,
    adjustedClosePrice,
    source: "fixture",
  };
}

function fx(rateDate, usdKrw) {
  return { rateDate, usdKrw, source: "fixture", status: "ok" };
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
