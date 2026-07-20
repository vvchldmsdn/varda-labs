import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
} from "../src/lib/investment-lab-anchor-basket-scenario.ts";
import {
  INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
} from "../src/lib/investment-lab-anchor-value-weight-scenario.ts";
import { composeInvestmentLabAllAccounts } from "../src/lib/investment-lab-account-composition.ts";
import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";
import { resolveInvestmentLabFixedMixSelection } from "../src/lib/investment-lab-fixed-mix-selection.ts";
import {
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  calculateInvestmentLabModifiedDietz,
} from "../src/lib/investment-lab-modified-dietz.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "../src/lib/portfolio-account-scope.ts";

describe("investment lab named-account composition", () => {
  it("derives all seven all-account paths from complete named-account paths", () => {
    const fixture = buildFixture();
    const result = compose(fixture);

    assert.equal(result.composition.status, "ready");
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(result.composition.scenarios).map(([id, value]) => [
          id,
          value.status,
        ]),
      ),
      {
        actual: "ready",
        kodex200: "ready",
        voo: "ready",
        zero_return: "ready",
        fixed_mix: "ready",
        anchor_basket: "ready",
        anchor_value_weight: "ready",
      },
    );
    assert.equal(result.model.status, "ready");
    assert.equal(result.model.coverage.eligibleFlowRows, 3);
    assert.equal(
      result.model.rows.at(-1).actualMarketValueKrw,
      sumNamed(fixture.namedModels, (model) =>
        model.rows.at(-1).actualMarketValueKrw,
      ),
    );
    assert.equal(
      result.model.fixedMixScenario.rows.at(-1).scenarioMarketValueKrw,
      sumNamed(fixture.namedModels, (model) =>
        model.fixedMixScenario.rows.at(-1).scenarioMarketValueKrw,
      ),
    );
    assert.equal(result.model.fixedMixComparison.status, "ready");
    assert.equal(result.model.fixedMixComparison.scenarios.length, 3);
    for (let index = 0; index < 3; index += 1) {
      assert.equal(
        result.model.fixedMixComparison.scenarios[index].scenario.rows.at(-1)
          .scenarioMarketValueKrw,
        sumNamed(
          fixture.namedModels,
          (model) =>
            model.fixedMixComparison.scenarios[index].scenario.rows.at(-1)
              .scenarioMarketValueKrw,
        ),
      );
    }
    assert.equal(
      result.anchorBasketScenario.summary.allocationBasis,
      "named_account_equal_weight_then_sum",
    );
    assert.equal(result.anchorBasketScenario.summary.equalWeightPct, null);
    assert.equal(result.anchorBasketScenario.coverage.sourceFlowCount, 3);
    assert.equal(
      result.anchorValueWeightScenario.summary.allocationBasis,
      "named_account_anchor_value_weight_then_sum",
    );
    assert.equal(result.anchorValueWeightScenario.weights.length, 0);
  });

  it("keeps unrelated all-account scenarios when one named VOO path is unavailable", () => {
    const fixture = buildFixture();
    fixture.namedModels = {
      ...fixture.namedModels,
      isa: {
        ...fixture.namedModels.isa,
        vooComparison: {
          status: "unavailable",
          summary: null,
          returnEstimate: null,
          rows: [],
          coverage: {
            appliedFlowRows: 0,
            delayedExecutionRows: 0,
            pendingComparisonRows: 0,
            pendingAtEndRows: 0,
          },
          blockers: ["fixture_missing_voo"],
        },
      },
    };

    const result = compose(fixture);

    assert.equal(result.composition.status, "partial");
    assert.equal(result.composition.scenarios.voo.status, "unavailable");
    assert.equal(result.composition.scenarios.kodex200.status, "ready");
    assert.equal(result.composition.scenarios.zero_return.status, "ready");
    assert.equal(result.model.status, "ready");
    assert.equal(result.model.vooComparison.status, "unavailable");
    assert.equal(result.model.cashComparison.status, "ready");
    assert.equal(result.model.fixedMixScenario.status, "ready");
    assert.equal(result.model.fixedMixComparison.status, "ready");
  });

  it("keeps other scenarios when one named anchor-weight path is unavailable", () => {
    const fixture = buildFixture();
    fixture.namedAnchorValueWeights = {
      ...fixture.namedAnchorValueWeights,
      isa: {
        ...fixture.namedAnchorValueWeights.isa,
        status: "unavailable",
        summary: null,
        returnEstimate: null,
        rows: [],
        blockers: [
          {
            reason: "evidence_unavailable",
            instrumentKey: null,
            detail: null,
          },
        ],
      },
    };

    const result = compose(fixture);

    assert.equal(result.composition.status, "partial");
    assert.equal(
      result.composition.scenarios.anchor_value_weight.status,
      "unavailable",
    );
    assert.equal(result.composition.scenarios.anchor_basket.status, "ready");
    assert.equal(result.model.status, "ready");
    assert.equal(result.anchorValueWeightScenario.status, "unavailable");
    assert.deepEqual(result.anchorValueWeightScenario.weights, []);
  });

  it("isolates a pooled KODEX divergence from the observed and cash paths", () => {
    const fixture = buildFixture();
    fixture.pooledModel = {
      ...fixture.pooledModel,
      rows: fixture.pooledModel.rows.map((row, index) =>
        index === fixture.pooledModel.rows.length - 1
          ? { ...row, scenarioMarketValueKrw: row.scenarioMarketValueKrw + 1 }
          : row,
      ),
    };

    const result = compose(fixture);

    assert.equal(result.composition.status, "partial");
    assert.equal(result.composition.scenarios.actual.status, "ready");
    assert.equal(result.composition.scenarios.zero_return.status, "ready");
    assert.equal(result.composition.scenarios.kodex200.status, "unavailable");
    assert.deepEqual(result.composition.scenarios.kodex200.blockers, [
      "aggregate_value_mismatch",
    ]);
    assert.equal(result.model.status, "blocked");
    assert.ok(result.model.blockers.includes("account_composition_mismatch"));
    assert.equal(result.model.observedPath.status, "ready");
    assert.equal(result.model.cashComparison.status, "ready");
    assert.deepEqual(result.model.rows, []);
  });

  it("keeps all observed, cash, and VOO paths when one named KODEX path is unavailable", () => {
    const fixture = buildFixture();
    fixture.namedModels = {
      ...fixture.namedModels,
      isa: {
        ...fixture.namedModels.isa,
        status: "blocked",
        summary: null,
        returnEstimate: null,
        rows: [],
        fixedMixScenario: {
          ...fixture.namedModels.isa.fixedMixScenario,
          status: "unavailable",
          summary: null,
          returnEstimate: null,
          rows: [],
          blockers: ["component_path_unavailable"],
        },
        blockers: ["scenario_close_evidence_invalid"],
      },
    };

    const result = compose(fixture);

    assert.equal(result.composition.status, "partial");
    assert.equal(result.composition.scenarios.actual.status, "ready");
    assert.equal(result.composition.scenarios.zero_return.status, "ready");
    assert.equal(result.composition.scenarios.voo.status, "ready");
    assert.equal(result.composition.scenarios.kodex200.status, "unavailable");
    assert.equal(result.composition.scenarios.fixed_mix.status, "unavailable");
    assert.equal(result.model.fixedMixComparison.status, "ready");
    assert.equal(result.model.observedPath.status, "ready");
    assert.equal(result.model.cashComparison.status, "ready");
    assert.equal(result.model.vooComparison.status, "ready");
  });

  it("recomputes all-account returns from named evidence instead of pooled estimates", () => {
    const fixture = buildFixture();
    const baseline = compose(fixture);
    fixture.pooledModel = tamperPooledReturns(fixture.pooledModel);
    fixture.pooledAnchor = tamperAnchorReturn(fixture.pooledAnchor);
    fixture.pooledAnchorValueWeight = tamperAnchorReturn(
      fixture.pooledAnchorValueWeight,
    );

    const result = compose(fixture);

    assert.equal(
      result.model.returnEstimate.scenarioReturn,
      baseline.model.returnEstimate.scenarioReturn,
    );
    assert.equal(
      result.model.vooComparison.returnEstimate.scenarioReturn,
      baseline.model.vooComparison.returnEstimate.scenarioReturn,
    );
    assert.equal(
      result.model.cashComparison.returnComparison.cashReturn,
      baseline.model.cashComparison.returnComparison.cashReturn,
    );
    assert.equal(
      result.model.fixedMixScenario.returnEstimate.scenarioReturn,
      baseline.model.fixedMixScenario.returnEstimate.scenarioReturn,
    );
    assert.equal(
      result.anchorBasketScenario.returnEstimate.scenarioReturn,
      baseline.anchorBasketScenario.returnEstimate.scenarioReturn,
    );
    assert.equal(
      result.anchorValueWeightScenario.returnEstimate.scenarioReturn,
      baseline.anchorValueWeightScenario.returnEstimate.scenarioReturn,
    );
    assert.notEqual(result.model.returnEstimate.scenarioReturn, 99);
  });
});

function compose(fixture) {
  return composeInvestmentLabAllAccounts({
    pooledModel: fixture.pooledModel,
    namedModels: fixture.namedModels,
    pooledAnchor: fixture.pooledAnchor,
    namedAnchors: fixture.namedAnchors,
    pooledAnchorValueWeight: fixture.pooledAnchorValueWeight,
    namedAnchorValueWeights: fixture.namedAnchorValueWeights,
  });
}

function buildFixture() {
  const source = sourceFixture();
  const fixedMix = resolveInvestmentLabFixedMixSelection("50");
  const pooledModel = buildInvestmentLabCounterfactualReadModel(source, {
    account: "all",
    fixedMixSelection: fixedMix,
  });
  const namedModels = Object.fromEntries(
    NAMED_PORTFOLIO_ACCOUNTS.map((account) => [
      account,
      buildInvestmentLabCounterfactualReadModel(source, {
        account,
        fixedMixSelection: fixedMix,
      }),
    ]),
  );
  assert.equal(pooledModel.status, "ready");
  for (const model of Object.values(namedModels)) {
    assert.equal(model.status, "ready");
    assert.equal(model.vooComparison.status, "ready");
    assert.equal(model.fixedMixScenario.status, "ready");
  }
  const namedAnchors = Object.fromEntries(
    NAMED_PORTFOLIO_ACCOUNTS.map((account, index) => [
      account,
      anchorScenario(account, namedModels[account], 1 + (index + 1) / 100, 1),
    ]),
  );
  const pooledAnchor = anchorScenario("all", pooledModel, 1.5, 3);
  const namedAnchorValueWeights = Object.fromEntries(
    NAMED_PORTFOLIO_ACCOUNTS.map((account, index) => [
      account,
      anchorValueWeightScenario(
        account,
        namedModels[account],
        1 + (index + 1) / 200,
        1,
      ),
    ]),
  );
  const pooledAnchorValueWeight = anchorValueWeightScenario(
    "all",
    pooledModel,
    1.25,
    3,
  );
  return {
    source,
    pooledModel,
    namedModels,
    pooledAnchor,
    namedAnchors,
    pooledAnchorValueWeight,
    namedAnchorValueWeights,
  };
}

function anchorScenario(account, model, multiplier, sourceFlowCount) {
  const rows = model.rows.map((row) => ({
    serviceDate: row.serviceDate,
    actualMarketValueKrw: row.actualMarketValueKrw,
    scenarioMarketValueKrw: row.actualMarketValueKrw * multiplier,
    differenceKrw: row.actualMarketValueKrw * (multiplier - 1),
    hasPendingExecution: false,
  }));
  const latest = rows.at(-1);
  const actualReturn = modifiedDietzFromRows(rows, "actualMarketValueKrw");
  const scenarioReturn = modifiedDietzFromRows(rows, "scenarioMarketValueKrw");
  return {
    status: "ready",
    policy: INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
    anchor: {
      status: "ready",
      account,
      requestedAnchorDate: null,
      selectedAnchorDate: rows[0].serviceDate,
      candidateAnchorDates: [rows[0].serviceDate],
      instruments: [],
      coverage: {},
      specialHoldingEvidence: [],
      blockers: [],
    },
    summary: {
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      instrumentCount: 2,
      equalWeightPct: 50,
      allocationBasis: "single_scope_equal_weight",
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    },
    returnEstimate: {
      method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
      actualReturn: actualReturn.totalReturn,
      scenarioReturn: scenarioReturn.totalReturn,
      differencePercentagePoints:
        (scenarioReturn.totalReturn - actualReturn.totalReturn) * 100,
      actualPeriods: actualReturn.periods,
      scenarioPeriods: scenarioReturn.periods,
      scenarioRiskMetrics: scenarioReturn.riskMetrics,
    },
    rows,
    coverage: {
      componentCount: 2,
      sourceFlowCount,
      scenarioFlowLegCount: sourceFlowCount * 2,
      splitExecutionDateRows: 0,
      delayedExecutionLegs: 0,
      pendingComparisonRows: 0,
      manualValuationComponentCount: 0,
      manualObservationRows: 0,
      manualCarryRows: 0,
    },
    evidenceBlockers: [],
    blockers: [],
  };
}

function anchorValueWeightScenario(
  account,
  model,
  multiplier,
  sourceFlowCount,
) {
  const scenario = anchorScenario(
    account,
    model,
    multiplier,
    sourceFlowCount,
  );
  return {
    ...scenario,
    policy: INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
    weights: [
      { instrumentKey: "korea:KRW:AAA", label: "AAA", weight: 0.6 },
      { instrumentKey: "us:USD:BBB", label: "BBB", weight: 0.4 },
    ],
    summary: {
      ...scenario.summary,
      allocationBasis: "single_scope_anchor_value_weight",
    },
  };
}

function sourceFixture() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", [500, 300, 150]),
      ...snapshotDate("2026-01-05", [540, 320, 160]),
      ...snapshotDate("2026-01-06", [560, 330, 165]),
      ...snapshotDate("2026-01-07", [580, 340, 170]),
    ],
    eventRows: [
      event("brokerage", "2026-01-03", 0, "buy", 100),
      event("isa", "2026-01-04", 1, "sell", 50),
      event("irp", "2026-01-06", 2, "buy", 25),
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
      { rateDate: "2026-01-05", usdKrw: 1300, source: "fixture", status: "ok" },
      { rateDate: "2026-01-06", usdKrw: 1301, source: "fixture", status: "ok" },
    ],
  };
}

function snapshotDate(snapshotDate, values) {
  return NAMED_PORTFOLIO_ACCOUNTS.map((account, index) => ({
    snapshotDate,
    account,
    cashValue: 0,
    totalMarketValue: values[index],
    usdKrw: 1300,
    source: "varda_manual_daily_snapshot",
    ruleVersion: "varda-manual-daily-snapshot-v1",
  }));
}

function event(account, eventDate, sequence, eventType, amountKrw) {
  return {
    account,
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
  return { priceDate, closePrice, adjustedClosePrice, source: "fixture" };
}

function sumNamed(namedModels, read) {
  return NAMED_PORTFOLIO_ACCOUNTS.reduce(
    (total, account) => total + read(namedModels[account]),
    0,
  );
}

function modifiedDietzFromRows(rows, valueKey) {
  const result = calculateInvestmentLabModifiedDietz({
    valuations: rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row[valueKey],
    })),
    flows: [],
  });
  assert.equal(result.status, "ready");
  return result;
}

function tamperPooledReturns(model) {
  return {
    ...model,
    returnEstimate: tamperReturn(model.returnEstimate),
    vooComparison: {
      ...model.vooComparison,
      returnEstimate: tamperReturn(model.vooComparison.returnEstimate),
    },
    cashComparison: {
      ...model.cashComparison,
      returnComparison: {
        ...model.cashComparison.returnComparison,
        cashReturn: 99,
        scenarioRiskMetrics: tamperedRisk(),
      },
    },
    fixedMixScenario: {
      ...model.fixedMixScenario,
      returnEstimate: tamperReturn(model.fixedMixScenario.returnEstimate),
    },
  };
}

function tamperAnchorReturn(scenario) {
  return {
    ...scenario,
    returnEstimate: tamperReturn(scenario.returnEstimate),
  };
}

function tamperReturn(estimate) {
  return {
    ...estimate,
    scenarioReturn: 99,
    differencePercentagePoints: 9_900,
    scenarioRiskMetrics: tamperedRisk(),
  };
}

function tamperedRisk() {
  return {
    status: "ready",
    maximumDrawdown: 0.99,
    annualizedVolatility: 9.9,
    periodCount: 99,
    blockers: [],
  };
}
