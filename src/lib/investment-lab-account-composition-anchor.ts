import {
  INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
  type InvestmentLabAnchorBasketScenario,
  type InvestmentLabAnchorScenarioBlocker,
} from "./investment-lab-anchor-basket-scenario.ts";
import {
  INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
  type InvestmentLabAnchorValueWeightScenario,
} from "./investment-lab-anchor-value-weight-scenario.ts";
import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";
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
  type InvestmentLabCompositionBoundaryFlow,
  type InvestmentLabCompositionValue,
  type InvestmentLabNamedAnchors,
  type InvestmentLabNamedAnchorValueWeights,
} from "./investment-lab-account-composition-contract.ts";

type AnchorScenario =
  | InvestmentLabAnchorBasketScenario
  | InvestmentLabAnchorValueWeightScenario;

type ReadyAnchorScenario<T extends AnchorScenario> = T &
  Readonly<{
    status: "ready";
    summary: NonNullable<T["summary"]>;
    returnEstimate: NonNullable<T["returnEstimate"]>;
  }>;

type ComposedAnchorParts = Readonly<{
  summary: ReturnType<typeof summarizeInvestmentLabCompositionRows>;
  actualReturn: number;
  scenarioReturn: number;
  scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
  rows: InvestmentLabAnchorBasketScenario["rows"];
  coverage: InvestmentLabAnchorBasketScenario["coverage"];
  instrumentCount: number;
}>;

export function composeInvestmentLabAnchor(input: Readonly<{
  pooledAnchor: InvestmentLabAnchorBasketScenario;
  namedAnchors: InvestmentLabNamedAnchors;
  boundaryFlows: readonly InvestmentLabCompositionBoundaryFlow[];
}>): InvestmentLabCompositionValue<InvestmentLabAnchorBasketScenario> {
  return composeAnchorScenario({
    pooled: input.pooledAnchor,
    named: input.namedAnchors,
    boundaryFlows: input.boundaryFlows,
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
        returnEstimate: returnEstimate(parts),
        rows: parts.rows,
        coverage: parts.coverage,
        evidenceBlockers: [] as const,
        blockers: [] as const,
      });
    },
  });
}

export function composeInvestmentLabAnchorValueWeight(input: Readonly<{
  pooledAnchor: InvestmentLabAnchorValueWeightScenario;
  namedAnchors: InvestmentLabNamedAnchorValueWeights;
  boundaryFlows: readonly InvestmentLabCompositionBoundaryFlow[];
}>): InvestmentLabCompositionValue<InvestmentLabAnchorValueWeightScenario> {
  return composeAnchorScenario({
    pooled: input.pooledAnchor,
    named: input.namedAnchors,
    boundaryFlows: input.boundaryFlows,
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
        returnEstimate: returnEstimate(parts),
        rows: parts.rows,
        coverage: parts.coverage,
        evidenceBlockers: [] as const,
        blockers: [] as const,
      });
    },
  });
}

function composeAnchorScenario<T extends AnchorScenario>(input: Readonly<{
  pooled: T;
  named: Readonly<Record<NamedPortfolioAccount, T>>;
  boundaryFlows: readonly InvestmentLabCompositionBoundaryFlow[];
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

  const firstDate = composed.rows[0].serviceDate;
  const lastDate = composed.rows.at(-1)!.serviceDate;
  const scenarioReturn = calculateInvestmentLabModifiedDietz({
    valuations: composed.rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.scenarioMarketValueKrw,
    })),
    flows: input.boundaryFlows
      .map((flow) => ({
        effectiveServiceDate: mapRiskEvidenceDateToServiceDate(flow.eventDate),
        sequence: flow.sequence,
        direction: flow.direction,
        amountKrw: flow.amountKrw,
      }))
      .filter(
        (flow) =>
          flow.effectiveServiceDate > firstDate &&
          flow.effectiveServiceDate <= lastDate,
      ),
  });
  const actualReturn = input.pooled.returnEstimate?.actualReturn ?? null;
  if (scenarioReturn.status !== "ready" || actualReturn === null) {
    return unavailableInvestmentLabCompositionValue([
      "return_calculation_unavailable",
    ]);
  }

  return readyInvestmentLabCompositionValue(
    input.create({
      summary: summarizeInvestmentLabCompositionRows(composed.rows),
      actualReturn,
      scenarioReturn: scenarioReturn.totalReturn,
      scenarioRiskMetrics: scenarioReturn.riskMetrics,
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

function returnEstimate(parts: ComposedAnchorParts) {
  return Object.freeze({
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    actualReturn: parts.actualReturn,
    scenarioReturn: parts.scenarioReturn,
    differencePercentagePoints:
      (parts.scenarioReturn - parts.actualReturn) * 100,
    scenarioRiskMetrics: parts.scenarioRiskMetrics,
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
