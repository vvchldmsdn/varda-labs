import {
  INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
  type InvestmentLabAnchorBasketScenario,
  type InvestmentLabAnchorScenarioBlocker,
} from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "./portfolio-account-scope.ts";
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
} from "./investment-lab-account-composition-contract.ts";

type ReadyAnchorScenario = InvestmentLabAnchorBasketScenario &
  Readonly<{
    status: "ready";
    summary: NonNullable<InvestmentLabAnchorBasketScenario["summary"]>;
    returnEstimate: NonNullable<
      InvestmentLabAnchorBasketScenario["returnEstimate"]
    >;
  }>;

export function composeInvestmentLabAnchor(input: Readonly<{
  pooledModel: InvestmentLabCounterfactualReadModel;
  pooledAnchor: InvestmentLabAnchorBasketScenario;
  namedAnchors: InvestmentLabNamedAnchors;
  boundaryFlows: readonly InvestmentLabCompositionBoundaryFlow[];
}>): InvestmentLabCompositionValue<InvestmentLabAnchorBasketScenario> {
  if (input.pooledAnchor.status !== "ready") {
    return unavailableInvestmentLabCompositionValue([
      "pooled_scenario_unavailable",
    ]);
  }
  if (
    NAMED_PORTFOLIO_ACCOUNTS.some(
      (account) => input.namedAnchors[account].status !== "ready",
    )
  ) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_scenario_unavailable",
    ]);
  }
  const ready = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => input.namedAnchors[account],
  ) as unknown as readonly ReadyAnchorScenario[];
  const composed = composeInvestmentLabAccountRows(
    (account) => input.namedAnchors[account].rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (
    !investmentLabCompositionActualRowsMatchModel(
      composed.rows,
      input.pooledModel.rows,
    )
  ) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    compensatedSum(
      ready.map((scenario) => scenario.coverage.sourceFlowCount),
    ) !== input.pooledAnchor.coverage.sourceFlowCount
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
  const actualReturn = input.pooledAnchor.returnEstimate?.actualReturn ?? null;
  if (scenarioReturn.status !== "ready" || actualReturn === null) {
    return unavailableInvestmentLabCompositionValue([
      "return_calculation_unavailable",
    ]);
  }
  return readyInvestmentLabCompositionValue(
    Object.freeze({
      status: "ready" as const,
      policy: INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
      anchor: input.pooledAnchor.anchor,
      summary: Object.freeze({
        ...summarizeInvestmentLabCompositionRows(composed.rows),
        instrumentCount: compensatedSum(
          ready.map((scenario) => scenario.summary.instrumentCount),
        ),
        equalWeightPct: null,
        allocationBasis: "named_account_equal_weight_then_sum" as const,
      }),
      returnEstimate: Object.freeze({
        method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
        actualReturn,
        scenarioReturn: scenarioReturn.totalReturn,
        differencePercentagePoints:
          (scenarioReturn.totalReturn - actualReturn) * 100,
      }),
      rows: composed.rows,
      coverage: Object.freeze({
        componentCount: compensatedSum(
          ready.map((row) => row.coverage.componentCount),
        ),
        sourceFlowCount: compensatedSum(
          ready.map((row) => row.coverage.sourceFlowCount),
        ),
        scenarioFlowLegCount: compensatedSum(
          ready.map((row) => row.coverage.scenarioFlowLegCount),
        ),
        splitExecutionDateRows: compensatedSum(
          ready.map((row) => row.coverage.splitExecutionDateRows),
        ),
        delayedExecutionLegs: compensatedSum(
          ready.map((row) => row.coverage.delayedExecutionLegs),
        ),
        pendingComparisonRows: composed.rows.filter(
          (row) => row.hasPendingExecution,
        ).length,
        manualValuationComponentCount: compensatedSum(
          ready.map((row) => row.coverage.manualValuationComponentCount),
        ),
        manualObservationRows: compensatedSum(
          ready.map((row) => row.coverage.manualObservationRows),
        ),
        manualCarryRows: compensatedSum(
          ready.map((row) => row.coverage.manualCarryRows),
        ),
      }),
      evidenceBlockers: [] as const,
      blockers: [] as const,
    }),
  );
}

export function unavailableInvestmentLabAnchor(
  pooled: InvestmentLabAnchorBasketScenario,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabAnchorBasketScenario {
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
  });
}
