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
import { listInvestmentLabCompleteSnapshotDates } from "./investment-lab-source-segment-authority.ts";

export interface InvestmentLabCounterfactualReadRepository
  extends InvestmentLabAnchorBasketReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
  request?: InvestmentLabPeriodRequest,
  fixedMixSelection?: InvestmentLabFixedMixSelection,
  requestedAnchorDate?: string | null,
): Promise<Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  rollingComparison: InvestmentLabRollingComparison;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
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
  const period = resolveInvestmentLabPeriodSelection({
    request,
    availableServiceDates: listInvestmentLabCompleteSnapshotDates(snapshotRows),
  });

  const selectedSource =
    period.status === "selected"
      ? sliceInvestmentLabCounterfactualInput(input, period)
      : input;
  const model = buildInvestmentLabCounterfactualReadModel(selectedSource, {
    fixedMixSelection,
  });
  let resolvedPeriod = period;
  if (period.status === "selected") {
    const complete =
      model.status === "ready" &&
      model.summary?.startServiceDate === period.selectedStartServiceDate &&
      model.summary.endServiceDate === period.selectedEndServiceDate &&
      model.returnEstimate?.status === "ready" &&
      model.vooComparison?.status === "ready" &&
      model.vooComparison.returnEstimate.status === "ready";
    resolvedPeriod = complete
      ? period
      : markInvestmentLabPeriodUnavailable(period);
  }
  const rollingComparison = buildInvestmentLabRollingComparison({
    source: selectedSource,
    availableServiceDates:
      model.status === "ready"
        ? model.rows.map((row) => row.serviceDate)
        : Object.freeze([]),
  });

  const anchorBasketScenario = await loadInvestmentLabAnchorBasketScenario({
    repository,
    model,
    source: selectedSource,
    fxRows: selectedSource.fxRows,
    requestedAnchorDate,
  });

  return Object.freeze({
    model,
    rollingComparison,
    period: resolvedPeriod,
    anchorBasketScenario,
  });
}
