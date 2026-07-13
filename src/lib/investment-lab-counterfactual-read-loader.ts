import {
  buildInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadModel,
  type InvestmentLabSourceCloseRow,
  type InvestmentLabSourceEventRow,
  type InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabVooFxRow } from "./investment-lab-voo-readiness.ts";

export interface InvestmentLabCounterfactualReadRepository {
  loadEvents(): Promise<readonly InvestmentLabSourceEventRow[]>;
  loadSnapshots(): Promise<readonly InvestmentLabSourceSnapshotRow[]>;
  loadScenarioCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadVooCloses(): Promise<readonly InvestmentLabSourceCloseRow[]>;
  loadFxRows(): Promise<readonly InvestmentLabVooFxRow[]>;
}

export async function loadInvestmentLabCounterfactualReadModel(
  repository: InvestmentLabCounterfactualReadRepository,
): Promise<InvestmentLabCounterfactualReadModel> {
  const [eventRows, snapshotRows, closeRows, vooCloseRows, fxRows] =
    await Promise.all([
      repository.loadEvents(),
      repository.loadSnapshots(),
      repository.loadScenarioCloses(),
      repository.loadVooCloses(),
      repository.loadFxRows(),
    ]);

  return buildInvestmentLabCounterfactualReadModel({
    eventRows,
    snapshotRows,
    closeRows,
    vooCloseRows,
    fxRows,
  });
}
