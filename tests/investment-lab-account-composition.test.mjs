import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
} from "../src/lib/investment-lab-anchor-basket-scenario.ts";
import { composeInvestmentLabAllAccounts } from "../src/lib/investment-lab-account-composition.ts";
import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";
import { resolveInvestmentLabFixedMixSelection } from "../src/lib/investment-lab-fixed-mix-selection.ts";
import { INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from "../src/lib/investment-lab-modified-dietz.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "../src/lib/portfolio-account-scope.ts";

describe("investment lab named-account composition", () => {
  it("derives all six all-account paths from complete named-account paths", () => {
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
    assert.equal(
      result.anchorBasketScenario.summary.allocationBasis,
      "named_account_equal_weight_then_sum",
    );
    assert.equal(result.anchorBasketScenario.summary.equalWeightPct, null);
    assert.equal(result.anchorBasketScenario.coverage.sourceFlowCount, 3);
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
  });

  it("blocks the all-account base path when pooled values diverge from named sums", () => {
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

    assert.equal(result.composition.status, "unavailable");
    assert.equal(result.composition.scenarios.actual.status, "unavailable");
    assert.deepEqual(result.composition.scenarios.actual.blockers, [
      "aggregate_value_mismatch",
    ]);
    assert.equal(result.model.status, "blocked");
    assert.ok(result.model.blockers.includes("account_composition_mismatch"));
    assert.deepEqual(result.model.rows, []);
  });
});

function compose(fixture) {
  return composeInvestmentLabAllAccounts({
    pooledModel: fixture.pooledModel,
    namedModels: fixture.namedModels,
    pooledAnchor: fixture.pooledAnchor,
    namedAnchors: fixture.namedAnchors,
    boundaryFlows: fixture.source.eventRows.map((row) => ({
      eventDate: row.eventDate,
      sequence: row.sequence,
      direction: row.eventType === "sell" ? "outflow" : "inflow",
      amountKrw: row.amountKrw,
    })),
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
  return { source, pooledModel, namedModels, pooledAnchor, namedAnchors };
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
      actualReturn: 0.1,
      scenarioReturn: 0.2,
      differencePercentagePoints: 10,
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
