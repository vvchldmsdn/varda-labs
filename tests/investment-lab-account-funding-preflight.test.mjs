import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabAllAccountFundingPreflight,
  buildInvestmentLabNamedAccountFundingPreflight,
  INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY,
} from "../src/lib/investment-lab-account-funding-preflight.ts";
import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";
import { resolveInvestmentLabFixedMixSelection } from "../src/lib/investment-lab-fixed-mix-selection.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "../src/lib/portfolio-account-scope.ts";

describe("investment lab account-local funding preflight", () => {
  it("reports a named account from existing ordered path results", () => {
    const result = buildInvestmentLabNamedAccountFundingPreflight({
      account: "brokerage",
      model: readyModel({ fixedMix: null }),
      anchorBasketScenario: readyAnchor(),
      anchorValueWeightScenario: readyAnchor(),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.accountScope, "brokerage");
    assert.equal(result.accountRows.length, 1);
    assert.equal(result.accountRows[0].scenarios.fixed_mix.status, "not_requested");
    assert.deepEqual(result.coverage, {
      accountCount: 1,
      requestedScenarioCells: 7,
      readyScenarioCells: 7,
      unavailableScenarioCells: 0,
      notRequestedScenarioCells: 1,
    });
  });

  it("does not let ready accounts fund a failed account scenario in all", () => {
    const brokerage = readyModel({ kodex: false, fixedMix: false });
    const namedModels = {
      brokerage,
      isa: readyModel(),
      irp: readyModel(),
    };
    const namedAnchors = {
      brokerage: readyAnchor(),
      isa: readyAnchor(),
      irp: readyAnchor(),
    };
    const namedAnchorValueWeights = {
      brokerage: readyAnchor(),
      isa: readyAnchor(),
      irp: readyAnchor(),
    };
    const result = buildInvestmentLabAllAccountFundingPreflight({
      namedModels,
      namedAnchors,
      namedAnchorValueWeights,
      composition: composition({ kodex200: false, fixed_mix: false }),
    });

    assert.equal(result.status, "partial");
    assert.equal(result.policy.crossAccountFunding, "forbidden");
    assert.equal(result.accountRows[0].account, "brokerage");
    assert.equal(result.accountRows[0].scenarios.kodex200.status, "unavailable");
    assert.equal(result.accountRows[0].scenarios.fixed_mix.status, "unavailable");
    assert.equal(result.accountRows[1].status, "ready");
    assert.equal(result.accountRows[2].status, "ready");
    assert.equal(result.aggregateScenarios.actual.status, "ready");
    assert.equal(result.aggregateScenarios.zero_return.status, "ready");
    assert.equal(result.aggregateScenarios.voo.status, "ready");
    assert.equal(result.aggregateScenarios.anchor_basket.status, "ready");
    assert.equal(result.aggregateScenarios.anchor_value_weight.status, "ready");
    assert.equal(result.aggregateScenarios.kodex200.status, "unavailable");
    assert.equal(result.aggregateScenarios.fixed_mix.status, "unavailable");
  });

  it("keeps an insolvent ISA sell blocked even when pooled capital could cover it", () => {
    const source = accountIsolationSource();
    const fixedMixSelection = resolveInvestmentLabFixedMixSelection("50");
    const pooled = buildInvestmentLabCounterfactualReadModel(source, {
      account: "all",
      fixedMixSelection,
    });
    const namedModels = Object.fromEntries(
      NAMED_PORTFOLIO_ACCOUNTS.map((account) => [
        account,
        buildInvestmentLabCounterfactualReadModel(source, {
          account,
          fixedMixSelection,
        }),
      ]),
    );

    assert.equal(pooled.status, "ready");
    assert.equal(namedModels.brokerage.status, "ready");
    assert.equal(namedModels.isa.status, "blocked");
    assert.equal(namedModels.isa.cashComparison.status, "unavailable");
    assert.equal(namedModels.irp.status, "ready");

    const result = buildInvestmentLabAllAccountFundingPreflight({
      namedModels,
      namedAnchors: {
        brokerage: readyAnchor(),
        isa: readyAnchor(),
        irp: readyAnchor(),
      },
      namedAnchorValueWeights: {
        brokerage: readyAnchor(),
        isa: readyAnchor(),
        irp: readyAnchor(),
      },
      composition: composition({
        kodex200: false,
        zero_return: false,
        voo: false,
        fixed_mix: false,
      }),
    });
    const isa = result.accountRows.find((row) => row.account === "isa");

    assert.equal(isa.status, "partial");
    assert.equal(isa.scenarios.kodex200.status, "unavailable");
    assert.equal(isa.scenarios.zero_return.status, "unavailable");
    assert.equal(isa.scenarios.actual.status, "ready");
  });

  it("marks only the affected account unavailable when its observed path is absent", () => {
    const result = buildInvestmentLabNamedAccountFundingPreflight({
      account: "isa",
      model: readyModel({ observed: false }),
      anchorBasketScenario: readyAnchor(),
      anchorValueWeightScenario: readyAnchor(),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.accountRows[0].scenarios.actual.status, "unavailable");
    assert.equal(result.accountRows[0].scenarios.voo.status, "ready");
    assert.deepEqual(
      result.accountRows[0].scenarios.actual.reasonCodes,
      ["observed_path_unavailable"],
    );
  });

  it("is a read-only projection and makes no new execution or product claims", () => {
    const source = readFileSync(
      "src/lib/investment-lab-account-funding-preflight.ts",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY.authority,
      "existing_ordered_upstream_path_results",
    );
    assert.equal(
      INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY.executionClaims.productEligibility,
      "not_evaluated",
    );
    assert.equal(
      INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY.futureFlowNetting,
      "forbidden_by_upstream_execution_order",
    );
    assert.doesNotMatch(source, /fetch\(|process\.env|\.query\(|\.insert\(/);
    assert.doesNotMatch(source, /eventRows|amountKrw|initialCapital|quantity/);
  });
});

function readyModel({
  observed = true,
  kodex = true,
  voo = true,
  cash = true,
  fixedMix = true,
} = {}) {
  return {
    status: kodex ? "ready" : "blocked",
    observedPath: { status: observed ? "ready" : "unavailable" },
    vooComparison: { status: voo ? "ready" : "unavailable" },
    cashComparison: { status: cash ? "ready" : "unavailable" },
    fixedMixScenario:
      fixedMix === null
        ? null
        : { status: fixedMix ? "ready" : "unavailable" },
    preperiodMinVolatility: {
      status: kodex ? "ready" : "path_unavailable",
    },
  };
}

function readyAnchor() {
  return { status: "ready" };
}

function composition(overrides = {}) {
  const ready = () => ({ status: "ready", blockers: [] });
  const unavailable = () => ({
    status: "unavailable",
    blockers: ["named_account_scenario_unavailable"],
  });
  return {
    status: Object.values(overrides).some((value) => value === false)
      ? "partial"
      : "ready",
    scenarios: Object.fromEntries(
      [
        "actual",
        "zero_return",
        "kodex200",
        "voo",
        "fixed_mix",
        "preperiod_min_volatility",
        "anchor_basket",
        "anchor_value_weight",
      ].map(
        (id) => [id, overrides[id] === false ? unavailable() : ready()],
      ),
    ),
  };
}

function accountIsolationSource() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", [500, 300, 150]),
      ...snapshotDate("2026-01-05", [540, 320, 160]),
      ...snapshotDate("2026-01-06", [560, 330, 165]),
      ...snapshotDate("2026-01-07", [580, 340, 170]),
    ],
    eventRows: [event("isa", "2026-01-04", 0, "sell", 350)],
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
