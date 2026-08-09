import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvestmentLabAnchorScheduledRebalanceScenario,
  INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY,
} from "../src/lib/investment-lab-anchor-scheduled-rebalance.ts";

describe("investment lab scheduled anchor rebalance paths", () => {
  it("rebalances current and equal listed-sleeve weights at the first row of a new month", () => {
    const input = fixture();
    const current = buildInvestmentLabAnchorScheduledRebalanceScenario({
      ...input,
      mode: "current_weight_monthly",
    });
    const equal = buildInvestmentLabAnchorScheduledRebalanceScenario({
      ...input,
      mode: "equal_weight_monthly",
    });

    assert.equal(current.status, "ready");
    assert.equal(equal.status, "ready");
    assert.deepEqual(
      current.weights.map((row) => [row.instrumentKey, row.targetListedSleeveWeight]),
      [
        ["korea:KRW:AAA", 0.75],
        ["us:USD:BBB", 0.25],
      ],
    );
    assert.deepEqual(
      equal.weights.map((row) => [row.instrumentKey, row.targetListedSleeveWeight]),
      [
        ["korea:KRW:AAA", 0.5],
        ["us:USD:BBB", 0.5],
      ],
    );
    assert.deepEqual(current.rows.map((row) => row.rebalanced), [false, true, false]);
    assert.deepEqual(equal.rows.map((row) => row.rebalanced), [false, true, false]);
    assert.equal(current.summary.rebalanceCount, 1);
    assert.equal(equal.summary.rebalanceCount, 1);
    assert.equal(Math.round(current.rows.at(-1).scenarioMarketValueKrw), 1_750);
    assert.equal(Math.round(equal.rows.at(-1).scenarioMarketValueKrw), 1_500);
  });

  it("defers a month-boundary rebalance until pending flows execute at their evidence prices", () => {
    const input = fixture();
    input.evidence = {
      ...input.evidence,
      components: input.evidence.components.map((component) => ({
        ...component,
        executions: [execution({ unitPriceKrw: 5 })],
      })),
      coverage: {
        ...input.evidence.coverage,
        relevantFlowCount: 1,
        executionEvidenceRows: 2,
      },
    };

    const scenario = buildInvestmentLabAnchorScheduledRebalanceScenario({
      ...input,
      mode: "current_weight_monthly",
    });

    assert.equal(scenario.status, "ready");
    assert.deepEqual(
      scenario.rows.map((row) => [row.hasPendingExecution, row.rebalanced]),
      [
        [false, false],
        [true, false],
        [false, true],
      ],
    );
    assert.equal(scenario.summary.deferredRebalanceCount, 1);
    assert.equal(scenario.summary.rebalanceCount, 1);
    assert.equal(scenario.coverage.sourceFlowCount, 1);
    assert.equal(scenario.coverage.scenarioFlowLegCount, 2);
    assert.equal(Math.round(scenario.rows.at(-1).scenarioMarketValueKrw), 2_450);
  });

  it("keeps manually valued holdings at fixed units outside flow allocation and rebalancing", () => {
    const input = fixture();
    const manualInstrument = instrument({
      key: "korea:KRW:gold_9999_1kg",
      ticker: null,
      storedMarketValueKrw: 100,
      valuationModel: "stored_manual",
    });
    input.anchor = {
      ...input.anchor,
      instruments: [...input.anchor.instruments, manualInstrument],
    };
    input.actualPath = input.actualPath.map((row) => ({
      ...row,
      totalMarketValueKrw: 1_100,
    }));
    input.evidence = {
      ...input.evidence,
      components: [
        ...input.evidence.components,
        component(manualInstrument, input.dates, [100, 110, 120], "stored_manual_valuation"),
      ],
      coverage: {
        ...input.evidence.coverage,
        instrumentCount: 3,
        valuationEvidenceRows: 9,
        manualSourceRows: 3,
        manualObservationRows: 1,
        manualCarryRows: 2,
      },
    };

    const scenario = buildInvestmentLabAnchorScheduledRebalanceScenario({
      ...input,
      mode: "equal_weight_monthly",
    });

    assert.equal(scenario.status, "ready");
    assert.equal(scenario.summary.fixedManualInstrumentCount, 1);
    assert.equal(scenario.coverage.fixedManualComponentCount, 1);
    assert.equal(scenario.coverage.manualObservationRows, 1);
    assert.equal(scenario.coverage.manualCarryRows, 2);
    assert.deepEqual(scenario.weights.at(-1), {
      instrumentKey: "korea:KRW:gold_9999_1kg",
      label: "gold_9999_1kg",
      rebalanceEligible: false,
      targetListedSleeveWeight: null,
    });
    assert.equal(Math.round(scenario.rows.at(-1).scenarioMarketValueKrw), 1_620);
  });

  it("fails closed when there is no listed sleeve to rebalance", () => {
    const input = fixture();
    const manualInstrument = instrument({
      key: "korea:KRW:gold_9999_1kg",
      ticker: null,
      storedMarketValueKrw: 1_000,
      valuationModel: "stored_manual",
    });
    input.anchor = { ...input.anchor, instruments: [manualInstrument] };
    input.evidence = {
      ...input.evidence,
      components: [
        component(manualInstrument, input.dates, [100, 100, 100], "stored_manual_valuation"),
      ],
    };

    const scenario = buildInvestmentLabAnchorScheduledRebalanceScenario({
      ...input,
      mode: "current_weight_monthly",
    });

    assert.equal(scenario.status, "unavailable");
    assert.equal(scenario.blockers[0].reason, "no_listed_rebalance_sleeve");
  });

  it("keeps the policy pure, costless, and explicit about manual holdings", () => {
    const policy = INVESTMENT_LAB_ANCHOR_SCHEDULED_REBALANCE_POLICY;

    assert.equal(policy.transactionCostsKrw, 0);
    assert.equal(policy.rebalancing, "costless_fractional_units");
    assert.match(policy.manualValuation, /excluded_from_rebalance/);
    assert.equal(policy.partialPath, "forbidden");
    assert.equal(Object.isFrozen(policy), true);
  });
});

function fixture() {
  const dates = ["2026-01-30", "2026-02-02", "2026-02-03"];
  const instruments = [
    instrument({ key: "korea:KRW:AAA", ticker: "AAA", storedMarketValueKrw: 750 }),
    instrument({ key: "us:USD:BBB", ticker: "BBB", storedMarketValueKrw: 250 }),
  ];
  return {
    dates,
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
    actualPath: dates.map((serviceDate) => ({
      serviceDate,
      totalMarketValueKrw: 1_000,
    })),
    evidence: {
      status: "ready",
      policy: {},
      components: [
        component(instruments[0], dates, [10, 20, 20]),
        component(instruments[1], dates, [10, 10, 10]),
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
    actualReturn: 0,
  };
}

function instrument({
  key,
  ticker,
  storedMarketValueKrw,
  valuationModel = "listed_close",
}) {
  return {
    key,
    valuationModel,
    ticker,
    productKey: ticker ? null : "gold_9999_1kg",
    label: ticker ?? "gold_9999_1kg",
    market: key.startsWith("korea") ? "korea" : "us",
    currency: key.includes(":KRW:") ? "KRW" : "USD",
    sourceRows: 1,
    accountCount: 1,
    storedMarketValueKrw,
  };
}

function component(instrumentRow, dates, prices, valuationBasis = "listed_close") {
  return {
    instrument: instrumentRow,
    valuationBasis,
    valuations: dates.map((serviceDate, index) => ({
      serviceDate,
      priceDate: serviceDate,
      unitPriceKrw: prices[index],
    })),
    executions: [],
  };
}

function execution({ unitPriceKrw }) {
  return {
    sourceIndex: 0,
    eventDate: "2026-01-31",
    sequence: 1,
    direction: "inflow",
    amountKrw: 200,
    amountProvenance: "explicit_amount_krw",
    executionPriceDate: "2026-02-03",
    executionServiceDate: "2026-02-03",
    unitPriceKrw,
    pendingCalendarDays: 3,
  };
}
