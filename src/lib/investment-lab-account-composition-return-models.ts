import type { InvestmentLabCashComparison } from "./investment-lab-cash-comparison.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabFixedMixScenario } from "./investment-lab-fixed-mix.ts";
import type { InvestmentLabObservedReturnEstimate } from "./investment-lab-observed-path.ts";
import {
  blockInvestmentLabReturnEstimateForAccountComposition,
  type InvestmentLabReturnEstimate,
} from "./investment-lab-return-estimate.ts";
import type { InvestmentLabVooComparison } from "./investment-lab-voo-comparison.ts";
import { blockInvestmentLabVooReturnEstimateForAccountComposition } from "./investment-lab-voo-return-estimate.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "./portfolio-account-scope.ts";
import type { InvestmentLabNamedModels } from "./investment-lab-account-composition-contract.ts";
import {
  composeInvestmentLabNamedAccountReturns,
  investmentLabReturnPeriodAxesMatch,
} from "./investment-lab-account-composition-return.ts";

type ReadyVooComparison = Extract<
  InvestmentLabVooComparison,
  { status: "ready" }
>;
type ReadyCashComparison = Extract<
  InvestmentLabCashComparison,
  { status: "ready" }
>;
type ReadyFixedMixScenario = Extract<
  InvestmentLabFixedMixScenario,
  { status: "ready" }
>;

export function composeInvestmentLabMainReturnEstimate(
  pooled: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
  actual: InvestmentLabObservedReturnEstimate,
): InvestmentLabReturnEstimate | null {
  const source = pooled.returnEstimate;
  if (
    source?.status !== "ready" ||
    actual.status !== "ready" ||
    NAMED_PORTFOLIO_ACCOUNTS.some(
      (account) => named[account].returnEstimate?.status !== "ready",
    )
  ) {
    return blockInvestmentLabReturnEstimateForAccountComposition(source);
  }
  const scenario = composeInvestmentLabNamedAccountReturns(
    NAMED_PORTFOLIO_ACCOUNTS.map(
      (account) =>
        (named[account].returnEstimate as Extract<
          InvestmentLabReturnEstimate,
          { status: "ready" }
        >).scenarioPeriods,
    ),
  );
  if (
    actual.status !== "ready" ||
    !composedReturnSharesAxis(scenario, actual.periods)
  ) {
    return blockInvestmentLabReturnEstimateForAccountComposition(source);
  }
  return Object.freeze({
    ...source,
    actualReturn: actual.actualReturn,
    scenarioReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.actualReturn) * 100,
    periodCount: actual.periodCount,
    actualFlowCount: actual.flowCount,
    scenarioFlowCount: scenario.flowCount,
    scenarioPeriods: scenario.periods,
    actualRiskMetrics: actual.riskMetrics,
    scenarioRiskMetrics: scenario.riskMetrics,
  });
}

export function composeInvestmentLabVooReturnEstimate(
  pooled: ReadyVooComparison,
  named: readonly ReadyVooComparison[],
  actual: InvestmentLabObservedReturnEstimate,
): ReadyVooComparison["returnEstimate"] {
  const scenario = composeInvestmentLabNamedAccountReturns(
    named.map((comparison) =>
      comparison.returnEstimate.status === "ready"
        ? comparison.returnEstimate.scenarioPeriods
        : [],
    ),
  );
  if (
    pooled.returnEstimate.status !== "ready" ||
    named.some((comparison) => comparison.returnEstimate.status !== "ready") ||
    actual.status !== "ready" ||
    !composedReturnSharesAxis(scenario, actual.periods)
  ) {
    return blockInvestmentLabVooReturnEstimateForAccountComposition(
      pooled.returnEstimate,
    );
  }
  return Object.freeze({
    ...pooled.returnEstimate,
    actualReturn: actual.actualReturn,
    scenarioReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.actualReturn) * 100,
    periodCount: actual.periodCount,
    actualFlowCount: actual.flowCount,
    scenarioFlowCount: scenario.flowCount,
    scenarioPeriods: scenario.periods,
    actualRiskMetrics: actual.riskMetrics,
    scenarioRiskMetrics: scenario.riskMetrics,
  });
}

export function composeInvestmentLabCashReturnComparison(
  named: readonly ReadyCashComparison[],
  actual: InvestmentLabObservedReturnEstimate,
): ReadyCashComparison["returnComparison"] {
  const scenario = composeInvestmentLabNamedAccountReturns(
    named.map((comparison) =>
      comparison.returnComparison.status === "ready"
        ? comparison.returnComparison.scenarioPeriods
        : [],
    ),
  );
  if (
    named.some((comparison) => comparison.returnComparison.status !== "ready") ||
    actual.status !== "ready" ||
    !composedReturnSharesAxis(scenario, actual.periods)
  ) {
    return Object.freeze({
      status: "unavailable" as const,
      actualReturn: null,
      cashReturn: scenario.status === "ready" ? scenario.totalReturn : null,
      differencePercentagePoints: null,
      periodCount: scenario.status === "ready" ? scenario.periodCount : 0,
      flowCount: scenario.status === "ready" ? scenario.flowCount : 0,
      blockers: ["account_composition_mismatch"] as const,
    });
  }
  return Object.freeze({
    status: "ready" as const,
    actualReturn: actual.actualReturn,
    cashReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.actualReturn) * 100,
    periodCount: scenario.periodCount,
    flowCount: scenario.flowCount,
    scenarioPeriods: scenario.periods,
    scenarioRiskMetrics: scenario.riskMetrics,
    blockers: [] as const,
  });
}

export function composeInvestmentLabFixedMixReturnEstimate(
  pooled: ReadyFixedMixScenario,
  named: readonly ReadyFixedMixScenario[],
  actual: InvestmentLabObservedReturnEstimate,
): ReadyFixedMixScenario["returnEstimate"] | null {
  const scenario = composeInvestmentLabNamedAccountReturns(
    named.map((candidate) => candidate.returnEstimate.scenarioPeriods),
  );
  if (
    actual.status !== "ready" ||
    !composedReturnSharesAxis(scenario, actual.periods)
  ) {
    return null;
  }
  return Object.freeze({
    ...pooled.returnEstimate,
    actualReturn: actual.actualReturn,
    scenarioReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.actualReturn) * 100,
    scenarioPeriods: scenario.periods,
    scenarioRiskMetrics: scenario.riskMetrics,
  });
}

function composedReturnSharesAxis(
  scenario: ReturnType<typeof composeInvestmentLabNamedAccountReturns>,
  actualPeriods: Extract<
    InvestmentLabObservedReturnEstimate,
    { status: "ready" }
  >["periods"],
): scenario is Extract<
  ReturnType<typeof composeInvestmentLabNamedAccountReturns>,
  { status: "ready" }
> {
  return (
    scenario.status === "ready" &&
    investmentLabReturnPeriodAxesMatch(actualPeriods, scenario.periods)
  );
}
