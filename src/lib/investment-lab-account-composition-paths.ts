import {
  INVESTMENT_LAB_CASH_COMPARISON_POLICY,
  type InvestmentLabCashComparison,
  type InvestmentLabCashComparisonBlocker,
} from "./investment-lab-cash-comparison.ts";
import type {
  InvestmentLabCounterfactualDisplayRow,
  InvestmentLabCounterfactualReadModel,
} from "./investment-lab-counterfactual-read-model.ts";
import {
  INVESTMENT_LAB_FIXED_MIX_POLICY,
  type InvestmentLabFixedMixBlocker,
  type InvestmentLabFixedMixScenario,
} from "./investment-lab-fixed-mix.ts";
import type { InvestmentLabVooComparison } from "./investment-lab-voo-comparison.ts";
import { NAMED_PORTFOLIO_ACCOUNTS } from "./portfolio-account-scope.ts";
import {
  compensatedSum,
  composeInvestmentLabAccountRows,
  investmentLabCompositionRowsMatch,
  notRequestedInvestmentLabCompositionValue,
  readyInvestmentLabCompositionValue,
  summarizeInvestmentLabCompositionRows,
  sumInvestmentLabNamedModels,
  unavailableInvestmentLabCompositionValue,
  type InvestmentLabAccountCompositionBlocker,
  type InvestmentLabCompositionValue,
  type InvestmentLabNamedModels,
} from "./investment-lab-account-composition-contract.ts";

export function composeInvestmentLabMainModel(
  pooled: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
): InvestmentLabCompositionValue<
  readonly InvestmentLabCounterfactualDisplayRow[]
> {
  if (
    pooled.status !== "ready" ||
    NAMED_PORTFOLIO_ACCOUNTS.some((account) => named[account].status !== "ready")
  ) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_model_unavailable",
    ]);
  }
  const composed = composeInvestmentLabAccountRows(
    (account) => named[account].rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (!investmentLabCompositionRowsMatch(composed.rows, pooled.rows)) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.eligibleFlowRows,
    ) !== pooled.coverage.eligibleFlowRows ||
    sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.appliedFlowRows,
    ) !== pooled.coverage.appliedFlowRows
  ) {
    return unavailableInvestmentLabCompositionValue(["flow_count_mismatch"]);
  }

  const rows = composed.rows.map((row, index) => {
    const pooledRow = pooled.rows[index];
    const namedRows = NAMED_PORTFOLIO_ACCOUNTS.map(
      (account) => named[account].rows[index],
    );
    if (
      namedRows.some(
        (namedRow) =>
          namedRow.valuationPriceDate !== pooledRow.valuationPriceDate ||
          namedRow.valuationCarryDays !== pooledRow.valuationCarryDays,
      )
    ) {
      return null;
    }
    return Object.freeze({
      ...pooledRow,
      actualMarketValueKrw: row.actualMarketValueKrw,
      scenarioMarketValueKrw: row.scenarioMarketValueKrw,
      differenceKrw: row.differenceKrw,
      hasPendingExecution: row.hasPendingExecution,
    });
  });
  if (rows.some((row) => row === null)) {
    return unavailableInvestmentLabCompositionValue([
      "service_date_axis_mismatch",
    ]);
  }
  return readyInvestmentLabCompositionValue(
    Object.freeze(rows) as readonly InvestmentLabCounterfactualDisplayRow[],
  );
}

export function composeInvestmentLabVoo(
  pooledModel: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
): InvestmentLabCompositionValue<InvestmentLabVooComparison> {
  const pooled = pooledModel.vooComparison;
  const namedComparisons = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => named[account].vooComparison,
  );
  if (pooled?.status !== "ready") {
    return unavailableInvestmentLabCompositionValue([
      "pooled_scenario_unavailable",
    ]);
  }
  if (namedComparisons.some((comparison) => comparison?.status !== "ready")) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_scenario_unavailable",
    ]);
  }
  const ready = namedComparisons as readonly Extract<
    InvestmentLabVooComparison,
    { status: "ready" }
  >[];
  const composed = composeInvestmentLabAccountRows(
    (account) => named[account].vooComparison!.rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (!investmentLabCompositionRowsMatch(composed.rows, pooled.rows)) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    compensatedSum(
      ready.map((comparison) => comparison.coverage.appliedFlowRows),
    ) !== pooled.coverage.appliedFlowRows
  ) {
    return unavailableInvestmentLabCompositionValue(["flow_count_mismatch"]);
  }
  return readyInvestmentLabCompositionValue(
    Object.freeze({
      ...pooled,
      summary: summarizeInvestmentLabCompositionRows(composed.rows),
      rows: Object.freeze(
        composed.rows.map((row, index) =>
          Object.freeze({ ...pooled.rows[index], ...row }),
        ),
      ),
      coverage: Object.freeze({
        appliedFlowRows: compensatedSum(
          ready.map((row) => row.coverage.appliedFlowRows),
        ),
        delayedExecutionRows: compensatedSum(
          ready.map((row) => row.coverage.delayedExecutionRows),
        ),
        pendingComparisonRows: composed.rows.filter(
          (row) => row.hasPendingExecution,
        ).length,
        pendingAtEndRows: 0 as const,
      }),
    }),
  );
}

export function composeInvestmentLabCash(
  pooledModel: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
): InvestmentLabCompositionValue<InvestmentLabCashComparison> {
  const pooled = pooledModel.cashComparison;
  const namedComparisons = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => named[account].cashComparison,
  );
  if (pooled?.status !== "ready") {
    return unavailableInvestmentLabCompositionValue([
      "pooled_scenario_unavailable",
    ]);
  }
  if (namedComparisons.some((comparison) => comparison?.status !== "ready")) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_scenario_unavailable",
    ]);
  }
  const ready = namedComparisons as readonly Extract<
    InvestmentLabCashComparison,
    { status: "ready" }
  >[];
  const composed = composeInvestmentLabAccountRows(
    (account) => named[account].cashComparison!.rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (!investmentLabCompositionRowsMatch(composed.rows, pooled.rows)) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    compensatedSum(
      ready.map((comparison) => comparison.coverage.appliedFlowRows),
    ) !== pooled.coverage.appliedFlowRows
  ) {
    return unavailableInvestmentLabCompositionValue(["flow_count_mismatch"]);
  }
  return readyInvestmentLabCompositionValue(
    Object.freeze({
      ...pooled,
      summary: summarizeInvestmentLabCompositionRows(composed.rows),
      rows: Object.freeze(
        composed.rows.map((row) =>
          Object.freeze({ ...row, hasPendingExecution: false as const }),
        ),
      ),
      coverage: Object.freeze({
        appliedFlowRows: compensatedSum(
          ready.map((row) => row.coverage.appliedFlowRows),
        ),
        ignoredThroughAnchorRows: compensatedSum(
          ready.map((row) => row.coverage.ignoredThroughAnchorRows),
        ),
        afterWindowRows: compensatedSum(
          ready.map((row) => row.coverage.afterWindowRows),
        ),
      }),
    }),
  );
}

export function composeInvestmentLabFixedMix(
  pooledModel: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
): InvestmentLabCompositionValue<InvestmentLabFixedMixScenario> {
  const pooled = pooledModel.fixedMixScenario;
  if (pooled === null) {
    return notRequestedInvestmentLabCompositionValue();
  }
  const namedScenarios = NAMED_PORTFOLIO_ACCOUNTS.map(
    (account) => named[account].fixedMixScenario,
  );
  if (pooled.status !== "ready") {
    return unavailableInvestmentLabCompositionValue([
      "pooled_scenario_unavailable",
    ]);
  }
  if (namedScenarios.some((scenario) => scenario?.status !== "ready")) {
    return unavailableInvestmentLabCompositionValue([
      "named_account_scenario_unavailable",
    ]);
  }
  const ready = namedScenarios as readonly Extract<
    InvestmentLabFixedMixScenario,
    { status: "ready" }
  >[];
  const composed = composeInvestmentLabAccountRows(
    (account) => named[account].fixedMixScenario!.rows,
  );
  if (composed.status !== "ready") {
    return unavailableInvestmentLabCompositionValue(composed.blockers);
  }
  if (!investmentLabCompositionRowsMatch(composed.rows, pooled.rows)) {
    return unavailableInvestmentLabCompositionValue([
      "aggregate_value_mismatch",
    ]);
  }
  if (
    compensatedSum(
      ready.map((scenario) => scenario.coverage.componentFlowSourceCount),
    ) !== pooled.coverage.componentFlowSourceCount
  ) {
    return unavailableInvestmentLabCompositionValue(["flow_count_mismatch"]);
  }
  return readyInvestmentLabCompositionValue(
    Object.freeze({
      ...pooled,
      summary: summarizeInvestmentLabCompositionRows(composed.rows),
      rows: Object.freeze(
        composed.rows.map((row, index) =>
          Object.freeze({
            ...row,
            kodexValueKrw: compensatedSum(
              ready.map((scenario) => scenario.rows[index].kodexValueKrw),
            ),
            vooValueKrw: compensatedSum(
              ready.map((scenario) => scenario.rows[index].vooValueKrw),
            ),
          }),
        ),
      ),
      coverage: Object.freeze({
        componentFlowSourceCount: compensatedSum(
          ready.map((scenario) => scenario.coverage.componentFlowSourceCount),
        ),
        scenarioFlowLegCount: compensatedSum(
          ready.map((scenario) => scenario.coverage.scenarioFlowLegCount),
        ),
        splitExecutionDateRows: compensatedSum(
          ready.map((scenario) => scenario.coverage.splitExecutionDateRows),
        ),
        pendingComparisonRows: composed.rows.filter(
          (row) => row.hasPendingExecution,
        ).length,
      }),
    }),
  );
}

export function composeInvestmentLabMainCoverage(
  pooled: InvestmentLabCounterfactualReadModel,
  named: InvestmentLabNamedModels,
  rows: readonly InvestmentLabCounterfactualDisplayRow[],
): InvestmentLabCounterfactualReadModel["coverage"] {
  return Object.freeze({
    snapshotSourceRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.snapshotSourceRows,
    ),
    completeComparisonDates: rows.length,
    incompleteSnapshotDates: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.incompleteSnapshotDates,
    ),
    eventSourceRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.eventSourceRows,
    ),
    eligibleFlowRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.eligibleFlowRows,
    ),
    appliedFlowRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.appliedFlowRows,
    ),
    scenarioCloseRows: pooled.coverage.scenarioCloseRows,
    delayedExecutionRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.delayedExecutionRows,
    ),
    pendingComparisonRows: rows.filter((row) => row.hasPendingExecution).length,
    ignoredThroughAnchorRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.ignoredThroughAnchorRows,
    ),
    pendingAtEndRows: sumInvestmentLabNamedModels(
      named,
      (model) => model.coverage.pendingAtEndRows,
    ),
    maxValuationCarryDays: Math.max(
      ...NAMED_PORTFOLIO_ACCOUNTS.map(
        (account) => named[account].coverage.maxValuationCarryDays ?? 0,
      ),
    ),
  });
}

export function blockInvestmentLabPooledModel(
  pooled: InvestmentLabCounterfactualReadModel,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabCounterfactualReadModel {
  const blocker = blockers.includes("named_account_model_unavailable")
    ? "account_composition_incomplete"
    : "account_composition_mismatch";
  return Object.freeze({
    ...pooled,
    status: "blocked" as const,
    summary: null,
    returnEstimate: null,
    vooReadiness: null,
    vooComparison: null,
    cashComparison: null,
    fixedMixScenario: null,
    contributionExperimentScenarios: [] as const,
    rows: [] as const,
    blockers: Object.freeze([
      ...new Set<InvestmentLabCounterfactualReadModel["blockers"][number]>([
        ...pooled.blockers,
        blocker,
      ]),
    ]),
  });
}

export function unavailableInvestmentLabVoo(
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabVooComparison {
  return Object.freeze({
    status: "unavailable",
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      appliedFlowRows: 0 as const,
      delayedExecutionRows: 0 as const,
      pendingComparisonRows: 0 as const,
      pendingAtEndRows: 0 as const,
    }),
    blockers: Object.freeze([...blockers]),
  });
}

export function unavailableInvestmentLabCash(
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabCashComparison {
  const blocker: InvestmentLabCashComparisonBlocker = blockers.includes(
    "named_account_scenario_unavailable",
  )
    ? "account_composition_incomplete"
    : "account_composition_mismatch";
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_CASH_COMPARISON_POLICY,
    summary: null,
    returnComparison: null,
    rows: [] as const,
    coverage: Object.freeze({
      appliedFlowRows: 0 as const,
      ignoredThroughAnchorRows: 0,
      afterWindowRows: 0,
    }),
    blockers: [blocker] as const,
  });
}

export function unavailableInvestmentLabFixedMix(
  pooled: InvestmentLabCounterfactualReadModel,
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabFixedMixScenario {
  const blocker: InvestmentLabFixedMixBlocker = blockers.includes(
    "named_account_scenario_unavailable",
  )
    ? "account_composition_incomplete"
    : "account_composition_mismatch";
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_FIXED_MIX_POLICY,
    weights: pooled.fixedMixScenario?.weights ?? null,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      componentFlowSourceCount: 0 as const,
      scenarioFlowLegCount: 0 as const,
      splitExecutionDateRows: 0 as const,
      pendingComparisonRows: 0 as const,
    }),
    blockers: [blocker] as const,
  });
}
