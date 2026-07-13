import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";

export interface InvestmentLabCounterfactualReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
): Promise<InvestmentLabCounterfactualReadModel> {
  const [eventRows, snapshotRows, closeRows] = await Promise.all([
    repository.loadEvents(),
    repository.loadSnapshots(),
    repository.loadScenarioCloses(),
  ]);

  return buildInvestmentLabCounterfactualReadModel({
    eventRows,
    snapshotRows,
    closeRows,
  });
}
