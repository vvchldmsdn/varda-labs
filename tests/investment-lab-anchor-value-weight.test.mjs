import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-scenario.ts";
import {
  buildInvestmentLabAnchorValueWeightScenario,
  INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
} from "../src/lib/investment-lab-anchor-value-weight-scenario.ts";

describe("investment lab anchor value-weight path", () => {
  it("uses stored anchor values once and keeps those weights without rebalancing", () => {
    const input = fixture();
    const equalWeight = buildInvestmentLabAnchorBasketScenario(input);
    const valueWeight = buildInvestmentLabAnchorValueWeightScenario(input);

    assert.equal(equalWeight.status, "ready");
    assert.equal(valueWeight.status, "ready");
    assert.equal(
      valueWeight.policy.version,
      "anchor_observed_value_weight_same_flow_path_v1",
    );
    assert.equal(valueWeight.policy.futureInformation, "forbidden");
    assert.equal(valueWeight.policy.rebalancing, "none");
    assert.deepEqual(
      valueWeight.weights.map((row) => [row.instrumentKey, row.weight]),
      [
        ["korea:KRW:AAA", 0.75],
        ["us:USD:BBB", 0.25],
      ],
    );
    assert.deepEqual(
      equalWeight.rows.map((row) => row.scenarioMarketValueKrw),
      [1_000, 1_000, 1_000],
    );
    assert.deepEqual(
      valueWeight.rows.map((row) => row.scenarioMarketValueKrw),
      [1_000, 1_050, 1_100],
    );
    assert.equal(
      valueWeight.summary.allocationBasis,
      "single_scope_anchor_value_weight",
    );
  });

  it("blocks only the value-weight result when the stored anchor total is zero", () => {
    const input = fixture();
    input.anchor = {
      ...input.anchor,
      instruments: input.anchor.instruments.map((instrument) => ({
        ...instrument,
        storedMarketValueKrw: 0,
      })),
    };

    const equalWeight = buildInvestmentLabAnchorBasketScenario(input);
    const valueWeight = buildInvestmentLabAnchorValueWeightScenario(input);

    assert.equal(equalWeight.status, "ready");
    assert.equal(valueWeight.status, "unavailable");
    assert.deepEqual(
      valueWeight.blockers.map((row) => row.reason),
      ["invalid_allocation_weights"],
    );
  });

  it("allocates every later external flow by the same anchor weights", () => {
    const input = fixture();
    const pricesByInstrument = [
      [10, 10, 20],
      [20, 20, 10],
    ];
    input.evidence = {
      ...input.evidence,
      components: input.evidence.components.map((row, index) => ({
        ...row,
        valuations: row.valuations.map((valuation, valuationIndex) => ({
          ...valuation,
          unitPriceKrw: pricesByInstrument[index][valuationIndex],
        })),
        executions: [execution(pricesByInstrument[index][1])],
      })),
      coverage: {
        ...input.evidence.coverage,
        relevantFlowCount: 1,
        executionEvidenceRows: 2,
      },
    };

    const scenario = buildInvestmentLabAnchorValueWeightScenario(input);

    assert.equal(scenario.status, "ready");
    assert.deepEqual(
      scenario.rows.map((row) => Math.round(row.scenarioMarketValueKrw)),
      [1_000, 1_100, 1_788],
    );
    assert.equal(scenario.coverage.sourceFlowCount, 1);
    assert.equal(scenario.coverage.scenarioFlowLegCount, 2);
  });

  it("keeps the calculation pure and non-executable", () => {
    const policy = INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY;

    assert.equal(policy.transactionCostsKrw, 0);
    assert.equal(policy.shortSelling, "forbidden_fail_closed");
    assert.equal(policy.partialPath, "forbidden");
    assert.equal(Object.isFrozen(policy), true);
  });
});

function fixture() {
  const dates = ["2026-01-02", "2026-01-05", "2026-01-06"];
  const actualPath = dates.map((serviceDate) => ({
    serviceDate,
    totalMarketValueKrw: 1_000,
  }));
  const instruments = [
    instrument("korea:KRW:AAA", "AAA", 750),
    instrument("us:USD:BBB", "BBB", 250),
  ];
  return {
    anchor: {
      status: "ready",
      policy: {},
      selectedAnchorDate: dates[0],
      candidateAnchorDates: [dates[0]],
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
        component(instruments[0], dates, [10, 11, 12]),
        component(instruments[1], dates, [20, 18, 16]),
      ],
      coverage: {
        serviceDateCount: dates.length,
        instrumentCount: instruments.length,
        sourcePriceRows: 6,
        relevantFlowCount: 0,
        valuationEvidenceRows: 6,
        executionEvidenceRows: 0,
        manualSourceRows: 0,
        manualObservationRows: 0,
        manualCarryRows: 0,
      },
      blockers: [],
    },
    actualReturn: 0.05,
  };
}

function instrument(key, ticker, storedMarketValueKrw) {
  return {
    key,
    valuationModel: "listed_close",
    ticker,
    productKey: null,
    label: ticker,
    market: key.startsWith("korea") ? "korea" : "us",
    currency: key.includes(":KRW:") ? "KRW" : "USD",
    sourceRows: 1,
    accountCount: 1,
    storedMarketValueKrw,
  };
}

function component(instrument, dates, prices) {
  return {
    instrument,
    valuationBasis: "listed_close",
    valuations: dates.map((serviceDate, index) => ({
      serviceDate,
      priceDate: serviceDate,
      unitPriceKrw: prices[index],
    })),
    executions: [],
  };
}

function execution(unitPriceKrw) {
  return {
    sourceIndex: 0,
    eventDate: "2026-01-05",
    sequence: 1,
    direction: "inflow",
    amountKrw: 100,
    amountProvenance: "explicit_amount_krw",
    executionPriceDate: "2026-01-05",
    executionServiceDate: "2026-01-05",
    unitPriceKrw,
    pendingCalendarDays: 0,
  };
}
