import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabVooFxRow } from "./investment-lab-voo-readiness.ts";
import {
  markInvestmentLabPeriodUnavailable,
  resolveInvestmentLabPeriodSelection,
  sliceInvestmentLabCounterfactualInput,
  type InvestmentLabPeriodRequest,
  type InvestmentLabPeriodSelection,
} from "./investment-lab-period-selection.ts";

export interface InvestmentLabCounterfactualReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
  request?: InvestmentLabPeriodRequest,
): Promise<Readonly<{
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
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
  const fullModel = buildInvestmentLabCounterfactualReadModel(input);
  const period = resolveInvestmentLabPeriodSelection({
    request,
    availableServiceDates: fullModel.rows.map((row) => row.serviceDate),
  });

  if (period.status !== "selected") {
    return Object.freeze({ model: fullModel, period });
  }

  const model = buildInvestmentLabCounterfactualReadModel(
    sliceInvestmentLabCounterfactualInput(input, period),
  );
  const complete =
    model.status === "ready" &&
    model.summary?.startServiceDate === period.selectedStartServiceDate &&
    model.summary.endServiceDate === period.selectedEndServiceDate &&
    model.returnEstimate?.status === "ready" &&
    model.vooComparison?.status === "ready" &&
    model.vooComparison.returnEstimate.status === "ready";

  return Object.freeze({
    model,
    period: complete
      ? period
      : markInvestmentLabPeriodUnavailable(period),
  });
}
