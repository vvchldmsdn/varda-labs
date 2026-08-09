import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabPreperiodOptimizer,
  INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY,
} from "../src/lib/investment-lab-preperiod-optimizer.ts";
import { estimateInvestmentLabOptimizerCandidates } from "../src/lib/investment-lab-preperiod-optimizer-math.ts";

describe("investment lab owner-universe pre-period optimizer", () => {
  it("builds four deterministic, capped and fully invested research candidates", () => {
    const first = buildInvestmentLabPreperiodOptimizer(fixture());
    const second = buildInvestmentLabPreperiodOptimizer(fixture());

    assert.equal(first.status, "ready");
    assert.equal(first.training.returnObservationCount, 60);
    assert.equal(first.training.instrumentCount, 3);
    assert.deepEqual(
      first.candidates.map((candidate) => candidate.objective),
      [
        "highest_return",
        "minimum_volatility",
        "minimum_drawdown",
        "maximum_sharpe",
      ],
    );
    for (const candidate of first.candidates) {
      assert.equal(
        candidate.weights.reduce((sum, row) => sum + row.weightBps, 0),
        10_000,
      );
      assert.ok(candidate.weights.every((row) => row.weightBps <= 5_000));
      assert.equal(candidate.weights.length, 3);
      assert.equal(candidate.scenario.status, "ready");
    }
    assert.deepEqual(second.candidates, first.candidates);
  });

  it("preserves explicit zero-basis-point rows for the exact terminal-return candidate", () => {
    const result = buildInvestmentLabPreperiodOptimizer(fixture());
    const candidate = result.candidates.find(
      (row) => row.objective === "highest_return",
    );

    assert.ok(candidate);
    assert.equal(candidate.weights.filter((row) => row.weightBps === 0).length, 1);
    assert.equal(Math.max(...candidate.weights.map((row) => row.weightBps)), 5_000);
  });

  it("does not let holdout valuations change weights learned before the anchor", () => {
    const source = fixture();
    const baseline = buildInvestmentLabPreperiodOptimizer(source);
    const changed = buildInvestmentLabPreperiodOptimizer({
      ...source,
      actualPath: source.actualPath.map((row, index) => ({
        ...row,
        totalMarketValueKrw: row.totalMarketValueKrw * (index + 1) * 3,
      })),
      evidence: {
        ...source.evidence,
        components: source.evidence.components.map((component, componentIndex) => ({
          ...component,
          valuations: component.valuations.map((row, index) => ({
            ...row,
            unitPriceKrw: row.unitPriceKrw * (componentIndex + 2) * (index + 1),
          })),
        })),
      },
    });

    assert.equal(baseline.status, "ready");
    assert.equal(changed.status, "ready");
    assert.deepEqual(
      changed.candidates.map((row) => row.weights),
      baseline.candidates.map((row) => row.weights),
    );
    assert.deepEqual(
      changed.candidates.map((row) => row.trainingMetrics),
      baseline.candidates.map((row) => row.trainingMetrics),
    );
  });

  it("blocks only the optimizer family when one required instrument has no pre-period history", () => {
    const source = fixture();
    const result = buildInvestmentLabPreperiodOptimizer({
      ...source,
      priceRows: source.priceRows.filter((row) => row.ticker !== "CCC"),
    });

    assert.equal(result.status, "training_unavailable");
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.blockers, ["insufficient_common_preperiod_rows"]);
  });

  it("keeps a stored-manual holding at its anchor weight without backcasting it", () => {
    const source = fixture();
    const manualInstrument = {
      ...source.anchor.instruments[0],
      key: "manual:krx_gold_1g",
      ticker: null,
      productKey: "krx_gold_1g",
      valuationModel: "stored_manual",
    };
    const result = buildInvestmentLabPreperiodOptimizer({
      ...source,
      anchor: {
        ...source.anchor,
        instruments: [manualInstrument, ...source.anchor.instruments.slice(1)],
      },
      evidence: {
        ...source.evidence,
        components: source.evidence.components.map((component, index) =>
          index === 0
            ? {
                ...component,
                instrument: manualInstrument,
                valuationBasis: "stored_manual_valuation",
              }
            : component,
        ),
      },
    });

    assert.equal(result.status, "ready");
    assert.equal(result.training.fixedManualInstrumentCount, 1);
    for (const candidate of result.candidates) {
      const manual = candidate.weights.find(
        (row) => row.instrumentKey === manualInstrument.key,
      );
      assert.equal(manual.allocationRole, "fixed_manual");
      assert.equal(manual.weightBps, 5_000);
    }
  });

  it("keeps objective math deterministic and improves from available seeds", () => {
    const growthSeries = [
      Array.from({ length: 61 }, (_, index) => 1 + index * 0.012),
      Array.from({ length: 61 }, (_, index) => 1 + index * 0.004),
      Array.from(
        { length: 61 },
        (_, index) => 1 + index * 0.006 + (index % 2 === 0 ? 0.02 : -0.02),
      ),
    ];
    const result = estimateInvestmentLabOptimizerCandidates({
      growthSeries,
      currentWeights: [0.4, 0.3, 0.3],
      maximumWeight: 0.5,
    });

    assert.ok(result);
    assert.equal(result.length, 4);
    assert.deepEqual(
      result.find((row) => row.objective === "highest_return").weights,
      [0.5, 0, 0.5],
    );
  });

  it("is pure, fail-closed, and explicitly non-recommendational", () => {
    const source = readFileSync(
      "src/lib/investment-lab-preperiod-optimizer.ts",
      "utf8",
    );

    assert.equal(INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY.providerBackfill, "forbidden");
    assert.equal(
      INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY.missingDateHandling,
      "omit_invalid_or_ambiguous_date_without_interpolation",
    );
    assert.equal(
      INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY.authority,
      "retrospective_research_candidate_not_recommendation",
    );
    assert.equal(
      INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY.manualValuationHandling,
      "fixed_at_anchor_weight_and_excluded_from_training_objective",
    );
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
  });
});

function fixture() {
  const trainingDates = Array.from({ length: 70 }, (_, index) =>
    addDays("2025-10-01", index),
  );
  const actualDates = ["2026-01-10", "2026-01-11", "2026-01-12"];
  const instruments = [
    instrument("korea:KRW:AAA", "AAA", "korea", "KRW", 500),
    instrument("us:USD:BBB", "BBB", "us", "USD", 300),
    instrument("korea:KRW:CCC", "CCC", "korea", "KRW", 200),
  ];
  const actualPath = actualDates.map((serviceDate, index) => ({
    serviceDate,
    totalMarketValueKrw: 1_000 + index * 40,
  }));
  return {
    anchor: {
      status: "ready",
      policy: {},
      selectedAnchorDate: actualDates[0],
      candidateAnchorDates: [actualDates[0]],
      instruments,
      coverage: {},
      specialHoldingEvidence: [],
      blockers: [],
    },
    actualPath,
    evidence: {
      status: "ready",
      policy: {},
      components: [
        component(instruments[0], actualDates, [10, 11, 12]),
        component(instruments[1], actualDates, [20, 19, 22]),
        component(instruments[2], actualDates, [8, 8.5, 9]),
      ],
      coverage: {
        serviceDateCount: actualDates.length,
        instrumentCount: instruments.length,
        sourcePriceRows: actualDates.length * instruments.length,
        relevantFlowCount: 0,
        valuationEvidenceRows: actualDates.length * instruments.length,
        executionEvidenceRows: 0,
        manualSourceRows: 0,
        manualObservationRows: 0,
        manualCarryRows: 0,
      },
      blockers: [],
    },
    actualReturn: 0.08,
    priceRows: trainingDates.flatMap((priceDate, index) => [
      price("AAA", "korea", "KRW", priceDate, 100 * 1.012 ** index),
      price("BBB", "us", "USD", priceDate, 50 * 1.004 ** index),
      price(
        "CCC",
        "korea",
        "KRW",
        priceDate,
        80 * 1.006 ** index * (index % 2 === 0 ? 1.01 : 0.99),
      ),
    ]),
    fxRows: trainingDates.map((rateDate, index) => ({
      rateDate,
      usdKrw: 1_300 + index * 0.2,
      source: "fixture",
      status: "ok",
    })),
  };
}

function instrument(key, ticker, market, currency, storedMarketValueKrw) {
  return {
    key,
    valuationModel: "listed_close",
    ticker,
    productKey: null,
    label: ticker,
    market,
    currency,
    sourceRows: 1,
    accountCount: 1,
    storedMarketValueKrw,
  };
}

function component(instrumentRow, dates, values) {
  return {
    instrument: instrumentRow,
    valuationBasis: "listed_close",
    valuations: dates.map((serviceDate, index) => ({
      serviceDate,
      priceDate: serviceDate,
      unitPriceKrw: values[index],
    })),
    executions: [],
  };
}

function price(ticker, market, currency, priceDate, closePrice) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    closePrice,
    source: "fixture",
  };
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
