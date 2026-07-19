import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type {
  InvestmentLabAccountComposition,
  InvestmentLabAccountCompositionScenarioId,
  InvestmentLabNamedAnchors,
  InvestmentLabNamedModels,
} from "./investment-lab-account-composition-contract.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY = Object.freeze({
  version: "account_local_same_flow_funding_preflight_v1",
  authority: "existing_ordered_upstream_path_results",
  accountIsolation: "one_account_initial_value_and_flows_only",
  allAggregation: "complete_named_account_results_only",
  crossAccountFunding: "forbidden",
  futureFlowNetting: "forbidden_by_upstream_execution_order",
  failedScopeHandling: "omit_only_failed_account_scenario",
  executionClaims: Object.freeze({
    productEligibility: "not_evaluated",
    transactionCosts: "not_evaluated",
    tax: "not_evaluated",
    fxSpread: "not_evaluated",
    orderFeasibility: "not_evaluated",
  }),
} as const);

export type InvestmentLabFundingReason =
  | "observed_path_unavailable"
  | "upstream_scenario_unavailable"
  | "scenario_not_requested"
  | "account_composition_unavailable";

export type InvestmentLabFundingResolution = Readonly<{
  status: "ready" | "unavailable" | "not_requested";
  reasonCodes: readonly InvestmentLabFundingReason[];
}>;

export type InvestmentLabFundingAccountRow = Readonly<{
  account: NamedPortfolioAccount;
  status: "ready" | "partial" | "unavailable";
  scenarios: Readonly<
    Record<
      InvestmentLabAccountCompositionScenarioId,
      InvestmentLabFundingResolution
    >
  >;
}>;

export type InvestmentLabAccountFundingPreflight = Readonly<{
  status: "ready" | "partial" | "unavailable";
  policy: typeof INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY;
  accountScope: PortfolioAccountScope;
  accountRows: readonly InvestmentLabFundingAccountRow[];
  aggregateScenarios: Readonly<
    Record<
      InvestmentLabAccountCompositionScenarioId,
      InvestmentLabFundingResolution
    >
  >;
  coverage: Readonly<{
    accountCount: number;
    requestedScenarioCells: number;
    readyScenarioCells: number;
    unavailableScenarioCells: number;
    notRequestedScenarioCells: number;
  }>;
}>;

const SCENARIO_IDS = Object.freeze([
  "actual",
  "zero_return",
  "kodex200",
  "voo",
  "fixed_mix",
  "anchor_basket",
] as const satisfies readonly InvestmentLabAccountCompositionScenarioId[]);

export function buildInvestmentLabNamedAccountFundingPreflight(input: Readonly<{
  account: NamedPortfolioAccount;
  model: InvestmentLabCounterfactualReadModel;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
}>): InvestmentLabAccountFundingPreflight {
  const row = accountRow(
    input.account,
    input.model,
    input.anchorBasketScenario,
  );
  return preflight(input.account, [row], row.scenarios);
}

export function buildInvestmentLabAllAccountFundingPreflight(input: Readonly<{
  namedModels: InvestmentLabNamedModels;
  namedAnchors: InvestmentLabNamedAnchors;
  composition: InvestmentLabAccountComposition;
}>): InvestmentLabAccountFundingPreflight {
  const rows = Object.freeze(
    NAMED_PORTFOLIO_ACCOUNTS.map((account) =>
      accountRow(
        account,
        input.namedModels[account],
        input.namedAnchors[account],
      ),
    ),
  );
  const aggregateScenarios = scenarioRecord((scenarioId) => {
    const composed = input.composition.scenarios[scenarioId];
    if (composed.status === "ready") return readyResolution();
    if (composed.status === "not_requested") return notRequestedResolution();
    return unavailableResolution("account_composition_unavailable");
  });
  return preflight("all", rows, aggregateScenarios);
}

function accountRow(
  account: NamedPortfolioAccount,
  model: InvestmentLabCounterfactualReadModel,
  anchor: InvestmentLabAnchorBasketScenario,
): InvestmentLabFundingAccountRow {
  const scenarios = scenarioRecord((scenarioId) => {
    switch (scenarioId) {
      case "actual":
        return model.observedPath.status === "ready"
          ? readyResolution()
          : unavailableResolution("observed_path_unavailable");
      case "kodex200":
        return model.status === "ready"
          ? readyResolution()
          : unavailableResolution("upstream_scenario_unavailable");
      case "voo":
        return model.vooComparison?.status === "ready"
          ? readyResolution()
          : unavailableResolution("upstream_scenario_unavailable");
      case "zero_return":
        return model.cashComparison?.status === "ready"
          ? readyResolution()
          : unavailableResolution("upstream_scenario_unavailable");
      case "fixed_mix":
        if (model.fixedMixScenario === null) return notRequestedResolution();
        return model.fixedMixScenario.status === "ready"
          ? readyResolution()
          : unavailableResolution("upstream_scenario_unavailable");
      case "anchor_basket":
        return anchor.status === "ready"
          ? readyResolution()
          : unavailableResolution("upstream_scenario_unavailable");
    }
  });
  return Object.freeze({
    account,
    status: overallStatus(scenarios),
    scenarios,
  });
}

function preflight(
  accountScope: PortfolioAccountScope,
  accountRows: readonly InvestmentLabFundingAccountRow[],
  aggregateScenarios: InvestmentLabAccountFundingPreflight["aggregateScenarios"],
): InvestmentLabAccountFundingPreflight {
  const cells = accountRows.flatMap((row) =>
    SCENARIO_IDS.map((scenarioId) => row.scenarios[scenarioId]),
  );
  const readyScenarioCells = cells.filter(
    (cell) => cell.status === "ready",
  ).length;
  const unavailableScenarioCells = cells.filter(
    (cell) => cell.status === "unavailable",
  ).length;
  const notRequestedScenarioCells = cells.filter(
    (cell) => cell.status === "not_requested",
  ).length;
  return Object.freeze({
    status: overallStatus(aggregateScenarios),
    policy: INVESTMENT_LAB_ACCOUNT_FUNDING_POLICY,
    accountScope,
    accountRows: Object.freeze([...accountRows]),
    aggregateScenarios,
    coverage: Object.freeze({
      accountCount: accountRows.length,
      requestedScenarioCells: cells.length - notRequestedScenarioCells,
      readyScenarioCells,
      unavailableScenarioCells,
      notRequestedScenarioCells,
    }),
  });
}

function scenarioRecord(
  resolve: (
    scenarioId: InvestmentLabAccountCompositionScenarioId,
  ) => InvestmentLabFundingResolution,
) {
  return Object.freeze(
    Object.fromEntries(
      SCENARIO_IDS.map((scenarioId) => [scenarioId, resolve(scenarioId)]),
    ) as Record<
      InvestmentLabAccountCompositionScenarioId,
      InvestmentLabFundingResolution
    >,
  );
}

function overallStatus(
  scenarios: InvestmentLabAccountFundingPreflight["aggregateScenarios"],
) {
  if (scenarios.actual.status !== "ready") return "unavailable" as const;
  return SCENARIO_IDS.some(
    (scenarioId) => scenarios[scenarioId].status === "unavailable",
  )
    ? ("partial" as const)
    : ("ready" as const);
}

function readyResolution(): InvestmentLabFundingResolution {
  return Object.freeze({ status: "ready" as const, reasonCodes: [] as const });
}

function unavailableResolution(
  reason: Exclude<InvestmentLabFundingReason, "scenario_not_requested">,
): InvestmentLabFundingResolution {
  return Object.freeze({
    status: "unavailable" as const,
    reasonCodes: [reason] as const,
  });
}

function notRequestedResolution(): InvestmentLabFundingResolution {
  return Object.freeze({
    status: "not_requested" as const,
    reasonCodes: ["scenario_not_requested"] as const,
  });
}
