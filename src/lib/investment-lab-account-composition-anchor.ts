import {
  INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
  type InvestmentLabAnchorBasketScenario,
  type InvestmentLabAnchorScenarioBlocker,
} from "./investment-lab-anchor-basket-scenario.ts";
import {
  INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
  type InvestmentLabAnchorValueWeightScenario,
} from "./investment-lab-anchor-value-weight-scenario.ts";
import { INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from "./investment-lab-modified-dietz.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
} from "./portfolio-account-scope.ts";
import {
  compensatedSum,
  composeInvestmentLabAccountRows,
  investmentLabCompositionActualRowsMatchModel,
  readyInvestmentLabCompositionValue,
  summarizeInvestmentLabCompositionRows,
  unavailableInvestmentLabCompositionValue,
  type InvestmentLabAccountCompositionBlocker,
  type InvestmentLabCompositionValue,
  type InvestmentLabNamedAnchors,
  type InvestmentLabNamedAnchorValueWeights,
} from "./investment-lab-account-composition-contract.ts";
import {
  composeInvestmentLabNamedAccountReturns,
  investmentLabReturnPeriodAxesMatch,
} from "./investment-lab-account-composition-return.ts";

type AnchorScenario =
  | InvestmentLabAnchorBasketScenario
  | InvestmentLabAnchorValueWeightScenario;

type ReadyAnchorScenario<T extends AnchorScenario> = T &
  Readonly<{
    status: "ready";
    summary: NonNullable<T["summary"]>;
  }>;

type ComposedAnchorParts = Readonly<{
  summary: ReturnType<typeof summarizeInvestmentLabCompositionRows>;
  returnEstimate: NonNullable<
    InvestmentLabAnchorBasketScenario["returnEstimate"]
  > | null;
  rows: InvestmentLabAnchorBasketScenario["rows"];
  coverage: InvestmentLabAnchorBasketScenario["coverage"];
  instrumentCount: number;
}>;

export function composeInvestmentLabAnchor(input: Readonly<{
  pooledAnchor: InvestmentLabAnchorBasketScenario;
  namedAnchors: InvestmentLabNamedAnchors;
}>): InvestmentLabCompositionValue<InvestmentLabAnchorBasketScenario> {
  return composeAnchorScenario({
    pooled: input.pooledAnchor,
    named: input.namedAnchors,
    create(parts) {
      return Object.freeze({
        ...input.pooledAnchor,
        status: "ready" as const,
        policy: INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
        summary: Object.freeze({
          ...parts.summary,
          instrumentCount: parts.instrumentCount,
          equalWeightPct: null,
          allocationBasis: "named_account_equal_weight_then_sum" as const,
        }),
        returnEstimate: parts.returnEstimate,
        rows: parts.rows,
        coverage: parts.coverage,
        evidenceBlockers: [] as const,
        blockers: parts.returnEstimate
          ? ([] as const)
          : ([
              {
                reason: "scenario_return_unavailable" as const,
                instrumentKey: null,
                detail: "account_composition_return_unavailable",
              },
            ] as const),
      });
    },
  });
}

export function composeInvestmentLabAnchorValueWeight(input: Readonly<{
  pooledAnchor: InvestmentLabAnchorValueWeightScenario;
  namedAnchors: InvestmentLabNamedAnchorValueWeights;
}>): InvestmentLabCompositionValue<InvestmentLabAnchorValueWeightScenario> {
  return composeAnchorScenario({
    pooled: input.pooledAnchor,
    named: input.namedAnchors,
    create(parts) {
      return Object.freeze({
        ...input.pooledAnchor,
        status: "ready" as const,
        policy: INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
        weights: [] as const,
        summary: Object.freeze({
          ...parts.summary,
          instrumentCount: parts.instrumentCount,
          allocationBasis:
            "named_account_anchor_value_weight_then_sum" as const,
        }),
        returnEstimate: parts.returnEstimate,
        rows: parts.rows,
        coverage: parts.coverage,
        evidenceBlockers: [] as const,
        blockers: parts.returnEstimate
          ? ([] as const)
          : ([
              {
                reason: "scenario_return_unavailable" as const,
                instrumentKey: null,
                detail: "account_composition_return_unavailable",
              },
            ] as const),
      });
    },
  });
}

function composeAnchorScenario<T extends AnchorScenario>(input: Readonly<{
  pooled: T;
  named: Readonly<Record<NamedPortfolioAccount, T>>;
  create(parts: ComposedAnchorParts): T;
}>): InvestmentLabCompositionValue<T> {
  if (input.pooled.status !== "ready") {
    return unavailableInvestmentLabCompositionValue([
      "pooled_scenario_unavailable",
    ]);
  }
  if (
    NAMED_PORTFOLIO_ACCOUNTS.some(
      (account) => input.named[account].status !== "ready",
    )
  ) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_scenario_unavailable",
    ]);
  }
  const ready = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => input.named[account],
  ) as readonly ReadyAnchorScenario<T>[];
  const composed = composeInvestmentLabAccountRows(
    (account) => input.named[account].rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (
    !investmentLabCompositionActualRowsMatchModel(
      composed.rows,
      input.pooled.rows,
    )
  ) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    compensatedSum(
      ready.map((scenario) => scenario.coverage.sourceFlowCount),
    ) !== input.pooled.coverage.sourceFlowCount
  ) {
    return unavailableInvestmentLabCompositionValue(["flow_count_mismatch"]);
  }

  const namedReturnEstimates = ready.map((scenario) => scenario.returnEstimate);
  const actualReturn = composeInvestmentLabNamedAccountReturns(
    namedReturnEstimates.map((estimate) => estimate?.actualPeriods ?? []),
  );
  const scenarioReturn = composeInvestmentLabNamedAccountReturns(
    namedReturnEstimates.map((estimate) => estimate?.scenarioPeriods ?? []),
  );
  const returnEvidenceReady =
    actualReturn.status === "ready" &&
    scenarioReturn.status === "ready" &&
    investmentLabReturnPeriodAxesMatch(
      actualReturn.periods,
      scenarioReturn.periods,
    );
  const returnEstimate = returnEvidenceReady
    ? Object.freeze({
        method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
        actualReturn: actualReturn.totalReturn,
        scenarioReturn: scenarioReturn.totalReturn,
        differencePercentagePoints:
          (scenarioReturn.totalReturn - actualReturn.totalReturn) * 100,
        actualPeriods: actualReturn.periods,
        scenarioPeriods: scenarioReturn.periods,
        scenarioRiskMetrics: scenarioReturn.riskMetrics,
      })
    : null;

  return readyInvestmentLabCompositionValue(
    input.create({
      summary: summarizeInvestmentLabCompositionRows(composed.rows),
      returnEstimate,
      rows: composed.rows,
      coverage: composeCoverage(ready, composed.rows),
      instrumentCount: compensatedSum(
        ready.map((scenario) => scenario.summary.instrumentCount),
      ),
    }),
  );
}

function composeCoverage<T extends AnchorScenario>(
  ready: readonly ReadyAnchorScenario<T>[],
  rows: InvestmentLabAnchorBasketScenario["rows"],
) {
  return Object.freeze({
    componentCount: compensatedSum(
      ready.map((scenario) => scenario.coverage.componentCount),
    ),
    sourceFlowCount: compensatedSum(
      ready.map((scenario) => scenario.coverage.sourceFlowCount),
    ),
    scenarioFlowLegCount: compensatedSum(
      ready.map((scenario) => scenario.coverage.scenarioFlowLegCount),
    ),
    splitExecutionDateRows: compensatedSum(
      ready.map((scenario) => scenario.coverage.splitExecutionDateRows),
    ),
    delayedExecutionLegs: compensatedSum(
      ready.map((scenario) => scenario.coverage.delayedExecutionLegs),
    ),
    pendingComparisonRows: rows.filter((row) => row.hasPendingExecution).length,
    manualValuationComponentCount: compensatedSum(
      ready.map(
        (scenario) => scenario.coverage.manualValuationComponentCount,
      ),
    ),
    manualObservationRows: compensatedSum(
      ready.map((scenario) => scenario.coverage.manualObservationRows),
    ),
    manualCarryRows: compensatedSum(
      ready.map((scenario) => scenario.coverage.manualCarryRows),
    ),
  });
}

export function unavailableInvestmentLabAnchor(
  pooled: InvestmentLabAnchorBasketScenario,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabAnchorBasketScenario {
  return unavailableAnchor(pooled, blockers);
}

export function unavailableInvestmentLabAnchorValueWeight(
  pooled: InvestmentLabAnchorValueWeightScenario,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabAnchorValueWeightScenario {
  return Object.freeze({
    ...unavailableAnchor(pooled, blockers),
    weights: [] as const,
  });
}

function unavailableAnchor<T extends AnchorScenario>(
  pooled: T,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): T {
  const reason: InvestmentLabAnchorScenarioBlocker["reason"] = blockers.includes(
    "named_account_scenario_unavailable",
  )
    ? "account_composition_incomplete"
    : "account_composition_mismatch";
  return Object.freeze({
    ...pooled,
    status: "unavailable" as const,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      componentCount: 0,
      sourceFlowCount: 0,
      scenarioFlowLegCount: 0,
      splitExecutionDateRows: 0,
      delayedExecutionLegs: 0,
      pendingComparisonRows: 0,
      manualValuationComponentCount: 0,
      manualObservationRows: 0,
      manualCarryRows: 0,
    }),
    blockers: Object.freeze([
      { reason, instrumentKey: null, detail: blockers.join(",") },
    ]),
  }) as T;
}
