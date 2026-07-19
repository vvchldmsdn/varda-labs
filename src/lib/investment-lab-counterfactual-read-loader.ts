import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabVooFxRow } from "./investment-lab-voo-readiness.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import {
  buildInvestmentLabRollingComparison,
  type InvestmentLabRollingComparison,
} from "./investment-lab-rolling-comparison.ts";
import {
  markInvestmentLabPeriodUnavailable,
  resolveInvestmentLabPeriodSelection,
  sliceInvestmentLabCounterfactualInput,
  type InvestmentLabPeriodRequest,
  type InvestmentLabPeriodSelection,
} from "./investment-lab-period-selection.ts";
import {
  loadInvestmentLabAnchorBasketScenario,
  type InvestmentLabAnchorBasketReadRepository,
} from "./investment-lab-anchor-basket-read-loader.ts";
import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import {
  listInvestmentLabCompleteSnapshotDates,
  listInvestmentLabLatestCurrentWriterDates,
} from "./investment-lab-source-segment-authority.ts";
import {
  applyInvestmentLabFountRuntimeScope,
  type InvestmentLabFountRuntimeEvidence,
  type InvestmentLabFountRuntimeScope,
} from "./investment-lab-fount-runtime-scope.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export interface InvestmentLabCounterfactualReadRepository
  extends InvestmentLabAnchorBasketReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
  loadFountRuntimeEvidence(
    serviceDates: readonly string[],
  ): Promise<InvestmentLabFountRuntimeEvidence>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
  request?: InvestmentLabPeriodRequest,
  fixedMixSelection?: InvestmentLabFixedMixSelection,
  requestedAnchorDate?: string | null,
  account: PortfolioAccountScope = "all",
): Promise<Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  rollingComparison: InvestmentLabRollingComparison;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
}>> {
  const [eventRows, snapshotRows, closeRows, vooCloseRows, fxRows] =
    await Promise.all([
      repository.loadEvents(),
      repository.loadSnapshots(),
      repository.loadScenarioCloses(),
      repository.loadVooCloses(),
      repository.loadFxRows(),
    ]);

  const input = Object.freeze({
    eventRows,
    snapshotRows,
    closeRows,
    vooCloseRows,
    fxRows,
  });
  const availableServiceDates = listInvestmentLabCompleteSnapshotDates(
    snapshotRows,
    account,
  );
  const period = resolveInvestmentLabPeriodSelection({
    request,
    availableServiceDates,
    defaultServiceDates: request
      ? undefined
      : listInvestmentLabLatestCurrentWriterDates(snapshotRows, account),
  });

  const selectedSource =
    period.status === "selected" || period.status === "current_writer"
      ? sliceInvestmentLabCounterfactualInput(input, period)
      : input;
  const fountServiceDates = listInvestmentLabCompleteSnapshotDates(
    selectedSource.snapshotRows,
    "all",
  );
  const fountEvidence =
    account === "irp" || account === "all"
      ? await repository.loadFountRuntimeEvidence(fountServiceDates)
      : ({ status: "not_applicable" } as const);
  const fountScope = applyInvestmentLabFountRuntimeScope({
    account,
    serviceDates: fountServiceDates,
    source: selectedSource,
    allEventRows: input.eventRows,
    evidence: fountEvidence,
  });
  const model = buildInvestmentLabCounterfactualReadModel(fountScope.source, {
    account,
    fixedMixSelection,
    fountScopeAdjustmentStatus: fountScope.scope.status,
  });
  let resolvedPeriod = period;
  if (period.status === "selected") {
    const complete =
      model.status === "ready" &&
      model.summary?.startServiceDate === period.selectedStartServiceDate &&
      model.summary.endServiceDate === period.selectedEndServiceDate;
    resolvedPeriod = complete
      ? period
      : markInvestmentLabPeriodUnavailable(period);
  }
  const rollingComparison = buildInvestmentLabRollingComparison({
    account,
    source: fountScope.source,
    availableServiceDates:
      model.status === "ready"
        ? model.rows.map((row) => row.serviceDate)
        : Object.freeze([]),
  });

  const anchorBasketScenario = await loadInvestmentLabAnchorBasketScenario({
    account,
    repository,
    model,
    source: fountScope.source,
    fxRows: fountScope.source.fxRows,
    requestedAnchorDate,
    fountScopeAdjustmentStatus: fountScope.scope.status,
  });

  return Object.freeze({
    model,
    rollingComparison,
    period: resolvedPeriod,
    anchorBasketScenario,
    fountScopeAdjustment: fountScope.scope,
  });
}
