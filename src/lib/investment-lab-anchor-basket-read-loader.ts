import {
  resolveInvestmentLabAnchorSelection,
  type InvestmentLabAnchorInstrument,
  type InvestmentLabAnchorPositionRow,
} from "./investment-lab-anchor-basket-anchor.ts";
import {
  resolveInvestmentLabAnchorBasketEvidence,
  type InvestmentLabAnchorFxRow,
  type InvestmentLabAnchorPriceRow,
} from "./investment-lab-anchor-basket-evidence.ts";
import {
  buildInvestmentLabAnchorBasketScenario,
  type InvestmentLabAnchorBasketScenario,
} from "./investment-lab-anchor-basket-scenario.ts";
import {
  resolveInvestmentLabBoundaryFlows,
  type InvestmentLabCounterfactualReadInput,
  type InvestmentLabCounterfactualReadModel,
} from "./investment-lab-counterfactual-read-model.ts";
import { calculateInvestmentLabModifiedDietz } from "./investment-lab-modified-dietz.ts";
import { validateInvestmentLabReturnEvidence } from "./investment-lab-return-evidence.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export interface InvestmentLabAnchorBasketReadRepository {
  loadAnchorPositionRows(
    serviceDates: readonly string[],
  ): Promise<readonly InvestmentLabAnchorPositionRow[]>;
  loadAnchorPriceRows(input: Readonly<{
    instruments: readonly InvestmentLabAnchorInstrument[];
    startServiceDate: string;
    endServiceDate: string;
  }>): Promise<readonly InvestmentLabAnchorPriceRow[]>;
}

export async function loadInvestmentLabAnchorBasketScenario(input: Readonly<{
  account?: PortfolioAccountScope;
  repository: InvestmentLabAnchorBasketReadRepository;
  model: InvestmentLabCounterfactualReadModel;
  source: InvestmentLabCounterfactualReadInput;
  fxRows: readonly InvestmentLabAnchorFxRow[];
  requestedAnchorDate?: string | null;
}>): Promise<InvestmentLabAnchorBasketScenario> {
  const serviceDates = input.model.rows.map((row) => row.serviceDate);
  const positionRows =
    serviceDates.length >= 2
      ? await input.repository.loadAnchorPositionRows(serviceDates)
      : [];
  const anchor = resolveInvestmentLabAnchorSelection({
    account: input.account,
    serviceDates,
    snapshotRows: input.source.snapshotRows,
    positionRows,
    requestedAnchorDate: input.requestedAnchorDate,
  });
  if (anchor.status !== "ready" || !anchor.selectedAnchorDate) {
    return buildInvestmentLabAnchorBasketScenario({
      anchor,
      actualPath: [],
      evidence: null,
      actualReturn: null,
    });
  }

  const actualPath = input.model.rows
    .filter((row) => row.serviceDate >= anchor.selectedAnchorDate!)
    .map((row) => ({
      serviceDate: row.serviceDate,
      totalMarketValueKrw: row.actualMarketValueKrw,
    }));
  const selectedSnapshotRows = input.source.snapshotRows.filter(
    (row) => row.snapshotDate >= anchor.selectedAnchorDate!,
  );
  const selectedEventRows = input.source.eventRows.filter(
    (row) => row.eventDate > anchor.selectedAnchorDate!,
  );
  const flowResolution = resolveInvestmentLabBoundaryFlows(
    selectedEventRows,
    input.account,
  );
  if (flowResolution.status !== "ready") {
    return buildInvestmentLabAnchorBasketScenario({
      anchor,
      actualPath,
      evidence: null,
      actualReturn: null,
    });
  }

  const priceRows = await input.repository.loadAnchorPriceRows({
    instruments: anchor.instruments,
    startServiceDate: anchor.selectedAnchorDate,
    endServiceDate: actualPath.at(-1)?.serviceDate ?? anchor.selectedAnchorDate,
  });
  const evidence = resolveInvestmentLabAnchorBasketEvidence({
    account: input.account,
    anchor,
    serviceDates: actualPath.map((row) => row.serviceDate),
    priceRows,
    snapshotRows: selectedSnapshotRows,
    fxRows: input.fxRows,
    boundaryFlows: flowResolution.flows,
  });
  return buildInvestmentLabAnchorBasketScenario({
    anchor,
    actualPath,
    evidence,
    actualReturn: resolveActualReturn({
      account: input.account,
      actualPath,
      boundaryFlows: flowResolution.flows,
      snapshotRows: selectedSnapshotRows,
      eventRows: selectedEventRows,
    }),
  });
}

function resolveActualReturn(input: Readonly<{
  account?: PortfolioAccountScope;
  actualPath: readonly Readonly<{
    serviceDate: string;
    totalMarketValueKrw: number;
  }>[];
  boundaryFlows: ReturnType<
    typeof resolveInvestmentLabBoundaryFlows
  >["flows"];
  snapshotRows: InvestmentLabCounterfactualReadInput["snapshotRows"];
  eventRows: InvestmentLabCounterfactualReadInput["eventRows"];
}>) {
  const evidence = validateInvestmentLabReturnEvidence({
    account: input.account,
    serviceDates: input.actualPath.map((row) => row.serviceDate),
    snapshotRows: input.snapshotRows,
    eventRows: input.eventRows,
  });
  if (evidence.status !== "ready") return null;
  const startDate = input.actualPath[0]?.serviceDate;
  const endDate = input.actualPath.at(-1)?.serviceDate;
  if (!startDate || !endDate) return null;
  const result = calculateInvestmentLabModifiedDietz({
    valuations: input.actualPath.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.totalMarketValueKrw,
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
          flow.effectiveServiceDate > startDate &&
          flow.effectiveServiceDate <= endDate,
      ),
  });
  return result.status === "ready" ? result.totalReturn : null;
}
