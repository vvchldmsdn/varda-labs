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
  buildInvestmentLabAnchorValueWeightScenario,
  type InvestmentLabAnchorValueWeightScenario,
} from "./investment-lab-anchor-value-weight-scenario.ts";
import {
  resolveInvestmentLabBoundaryFlows,
  type InvestmentLabCounterfactualReadInput,
  type InvestmentLabCounterfactualReadModel,
} from "./investment-lab-counterfactual-read-model.ts";
import { calculateInvestmentLabModifiedDietz } from "./investment-lab-modified-dietz.ts";
import { validateInvestmentLabReturnEvidence } from "./investment-lab-return-evidence.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./investment-lab-special-holding-authority.ts";

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

export type InvestmentLabAnchorFountScope =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{ status: "blocked" }>
  | Readonly<{
      status: "applied";
      binding: Readonly<{
        selectorBasis: "exact_snapshot_legacy_asset_id";
        snapshotLegacyAssetId: string;
        account: "brokerage" | "isa" | "irp";
      }>;
    }>;

export type InvestmentLabAnchorScenarioLoadInput = Readonly<{
  account?: PortfolioAccountScope;
  repository: InvestmentLabAnchorBasketReadRepository;
  model: InvestmentLabCounterfactualReadModel;
  source: InvestmentLabCounterfactualReadInput;
  fxRows: readonly InvestmentLabAnchorFxRow[];
  requestedAnchorDate?: string | null;
  fountScopeAdjustment?: InvestmentLabAnchorFountScope;
}>;

export type InvestmentLabAnchorScenarios = Readonly<{
  equalWeight: InvestmentLabAnchorBasketScenario;
  valueWeight: InvestmentLabAnchorValueWeightScenario;
}>;

export async function loadInvestmentLabAnchorBasketScenario(
  input: InvestmentLabAnchorScenarioLoadInput,
): Promise<InvestmentLabAnchorBasketScenario> {
  return (await loadInvestmentLabAnchorScenarios(input)).equalWeight;
}

export async function loadInvestmentLabAnchorScenarios(
  input: InvestmentLabAnchorScenarioLoadInput,
): Promise<InvestmentLabAnchorScenarios> {
  const observedRows = input.model.observedPath.rows;
  const serviceDates = observedRows.map(
    (row) => row.serviceDate,
  );
  const positionRows =
    serviceDates.length >= 2
      ? await input.repository.loadAnchorPositionRows(serviceDates)
      : [];
  const scopedPositionRows = applyAnchorPositionScope({
    account: input.account ?? "all",
    positionRows,
    fountScopeAdjustment:
      input.fountScopeAdjustment ?? Object.freeze({ status: "not_applicable" }),
  });
  const anchor = resolveInvestmentLabAnchorSelection({
    account: input.account,
    serviceDates,
    snapshotRows: input.source.snapshotRows,
    positionRows: scopedPositionRows,
    requestedAnchorDate: input.requestedAnchorDate,
  });
  if (anchor.status !== "ready" || !anchor.selectedAnchorDate) {
    return buildAnchorScenarios({
      anchor,
      actualPath: [],
      evidence: null,
      actualReturn: null,
    });
  }

  const actualPath = observedRows
    .filter((row) => row.serviceDate >= anchor.selectedAnchorDate!)
    .map((row) => ({
      serviceDate: row.serviceDate,
      totalMarketValueKrw: row.marketValueKrw,
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
    return buildAnchorScenarios({
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
    manualValuationRows: scopedPositionRows,
    snapshotRows: selectedSnapshotRows,
    fxRows: input.fxRows,
    boundaryFlows: flowResolution.flows,
  });
  const actualReturn = resolveActualReturn({
    account: input.account,
    actualPath,
    boundaryFlows: flowResolution.flows,
    snapshotRows: selectedSnapshotRows,
    eventRows: selectedEventRows,
  });
  return buildAnchorScenarios({
    anchor,
    actualPath,
    evidence,
    actualReturn: actualReturn?.totalReturn ?? null,
    actualPeriods: actualReturn?.periods ?? [],
  });
}

function buildAnchorScenarios(
  input: Parameters<typeof buildInvestmentLabAnchorBasketScenario>[0],
): InvestmentLabAnchorScenarios {
  return Object.freeze({
    equalWeight: buildInvestmentLabAnchorBasketScenario(input),
    valueWeight: buildInvestmentLabAnchorValueWeightScenario(input),
  });
}

function applyAnchorPositionScope(input: Readonly<{
  account: PortfolioAccountScope;
  positionRows: readonly InvestmentLabAnchorPositionRow[];
  fountScopeAdjustment: InvestmentLabAnchorFountScope;
}>) {
  if (
    input.fountScopeAdjustment.status !== "applied" ||
    (input.account !== "irp" && input.account !== "all")
  ) {
    return input.positionRows;
  }
  const binding = input.fountScopeAdjustment.binding;
  if (!isValidFountBinding(binding)) return input.positionRows;

  return Object.freeze(
    input.positionRows.filter(
      (row) =>
        row.legacyAssetId !== binding.snapshotLegacyAssetId ||
        normalizeText(row.account) !== binding.account,
    ),
  );
}

function isValidFountBinding(
  binding: Extract<
    InvestmentLabAnchorFountScope,
    { status: "applied" }
  >["binding"],
) {
  return (
    binding.selectorBasis === "exact_snapshot_legacy_asset_id" &&
    /^[0-9a-f]{24}$/.test(binding.snapshotLegacyAssetId) &&
    binding.account ===
      DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount.account
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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
  return result.status === "ready" ? result : null;
}
