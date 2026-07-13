import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import {
  validateInvestmentLabReturnEvidence,
  type InvestmentLabReturnEvidenceBlocker,
  type InvestmentLabReturnEvidenceEvent,
  type InvestmentLabReturnEvidenceResult,
  type InvestmentLabReturnEvidenceSnapshot,
} from "./investment-lab-return-evidence.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_RETURN_BASIS_POLICY = Object.freeze({
  version: "price_only_comparable_close_basis_v1",
  scenarioPriceRequirement: "close_equals_adjusted_close",
  actualCashRequirement: "cash_excluded_from_invested_position_path",
  distributionTreatment: "not_separately_observed",
  feeTaxTreatment: "not_separately_observed",
  resultLabel: "cashflow_adjusted_estimated_return",
} as const);

type ActualValueRow = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

type ScenarioValueRow = Readonly<{
  serviceDate: string;
  investedMarketValueKrw: number;
  valuationPriceDate: string;
}>;

type BoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

type AppliedFlow = Readonly<{
  sourceIndex: number;
  executionServiceDate: string;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

type PriceBasisRow = Readonly<{
  priceDate: string;
  closePrice: string | number | null;
  adjustedClosePrice: string | number | null;
}>;

export type InvestmentLabReturnEstimateBlocker =
  | InvestmentLabReturnEvidenceBlocker
  | "valuation_axis_mismatch"
  | "price_basis_unavailable"
  | "price_basis_mismatch"
  | "actual_return_calculation_blocked"
  | "scenario_return_calculation_blocked";

export type InvestmentLabReturnEstimate =
  | Readonly<{
      status: "ready";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      basis: typeof INVESTMENT_LAB_RETURN_BASIS_POLICY;
      actualReturn: number;
      scenarioReturn: number;
      differencePercentagePoints: number;
      periodCount: number;
      actualFlowCount: number;
      scenarioFlowCount: number;
      basisRowCount: number;
      basisMismatchRows: 0;
      basisUnavailableRows: 0;
      evidence: InvestmentLabReturnEvidenceResult;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      basis: typeof INVESTMENT_LAB_RETURN_BASIS_POLICY;
      actualReturn: null;
      scenarioReturn: null;
      differencePercentagePoints: null;
      periodCount: 0;
      actualFlowCount: number;
      scenarioFlowCount: number;
      basisRowCount: number;
      basisMismatchRows: number;
      basisUnavailableRows: number;
      evidence: InvestmentLabReturnEvidenceResult | null;
      blockers: readonly InvestmentLabReturnEstimateBlocker[];
    }>;

export function buildInvestmentLabReturnEstimate(input: {
  actualRows: readonly ActualValueRow[];
  scenarioRows: readonly ScenarioValueRow[];
  boundaryFlows: readonly BoundaryFlow[];
  appliedFlows: readonly AppliedFlow[];
  priceRows: readonly PriceBasisRow[];
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
}): InvestmentLabReturnEstimate {
  const axisMatches =
    input.actualRows.length === input.scenarioRows.length &&
    input.actualRows.every(
      (row, index) => row.serviceDate === input.scenarioRows[index].serviceDate,
    );
  const startServiceDate = input.actualRows[0]?.serviceDate ?? null;
  const endServiceDate = input.actualRows.at(-1)?.serviceDate ?? null;
  const startPriceDate = input.scenarioRows[0]?.valuationPriceDate ?? null;
  const endPriceDate = input.scenarioRows.at(-1)?.valuationPriceDate ?? null;

  if (
    !axisMatches ||
    !startServiceDate ||
    !endServiceDate ||
    !startPriceDate ||
    !endPriceDate
  ) {
    return blockedEstimate({
      blockers: ["valuation_axis_mismatch"],
      actualFlowCount: 0,
      scenarioFlowCount: 0,
      basisRowCount: 0,
      basisMismatchRows: 0,
      basisUnavailableRows: 0,
    });
  }

  const basisRows = input.priceRows.filter(
    (row) =>
      row.priceDate >= startPriceDate && row.priceDate <= endPriceDate,
  );
  let basisMismatchRows = 0;
  let basisUnavailableRows = 0;

  for (const row of basisRows) {
    const closePrice = positiveNumber(row.closePrice);
    const adjustedClosePrice = positiveNumber(row.adjustedClosePrice);
    if (closePrice === null || adjustedClosePrice === null) {
      basisUnavailableRows += 1;
      continue;
    }
    if (!samePrice(closePrice, adjustedClosePrice)) {
      basisMismatchRows += 1;
    }
  }

  const actualFlows = input.boundaryFlows
    .map((flow) => ({
      effectiveServiceDate: mapRiskEvidenceDateToServiceDate(flow.eventDate),
      sequence: flow.sequence,
      direction: flow.direction,
      amountKrw: flow.amountKrw,
    }))
    .filter(
      (flow) =>
        flow.effectiveServiceDate > startServiceDate &&
        flow.effectiveServiceDate <= endServiceDate,
    );
  const scenarioFlows = input.appliedFlows.map((flow) => ({
    effectiveServiceDate: flow.executionServiceDate,
    sequence: flow.sourceIndex,
    direction: flow.direction,
    amountKrw: flow.amountKrw,
  }));
  const evidence = validateInvestmentLabReturnEvidence({
    serviceDates: input.actualRows.map((row) => row.serviceDate),
    snapshotRows: input.snapshotRows,
    eventRows: input.eventRows,
  });
  if (evidence.status !== "ready") {
    return blockedEstimate({
      blockers: evidence.blockers,
      actualFlowCount: actualFlows.length,
      scenarioFlowCount: scenarioFlows.length,
      basisRowCount: basisRows.length,
      basisMismatchRows,
      basisUnavailableRows,
      evidence,
    });
  }

  const basisBlockers: InvestmentLabReturnEstimateBlocker[] = [];
  if (basisRows.length === 0 || basisUnavailableRows > 0) {
    basisBlockers.push("price_basis_unavailable");
  }
  if (basisMismatchRows > 0) {
    basisBlockers.push("price_basis_mismatch");
  }
  if (basisBlockers.length > 0) {
    return blockedEstimate({
      blockers: basisBlockers,
      actualFlowCount: actualFlows.length,
      scenarioFlowCount: scenarioFlows.length,
      basisRowCount: basisRows.length,
      basisMismatchRows,
      basisUnavailableRows,
      evidence,
    });
  }

  const actual = calculateInvestmentLabModifiedDietz({
    valuations: input.actualRows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.totalMarketValueKrw,
    })),
    flows: actualFlows,
  });
  const scenario = calculateInvestmentLabModifiedDietz({
    valuations: input.scenarioRows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.investedMarketValueKrw,
    })),
    flows: scenarioFlows,
  });
  if (actual.status !== "ready" || scenario.status !== "ready") {
    const calculationBlockers: InvestmentLabReturnEstimateBlocker[] = [];
    if (actual.status !== "ready") {
      calculationBlockers.push("actual_return_calculation_blocked");
    }
    if (scenario.status !== "ready") {
      calculationBlockers.push("scenario_return_calculation_blocked");
    }
    return blockedEstimate({
      blockers: calculationBlockers,
      actualFlowCount: actualFlows.length,
      scenarioFlowCount: scenarioFlows.length,
      basisRowCount: basisRows.length,
      basisMismatchRows,
      basisUnavailableRows,
      evidence,
    });
  }

  return Object.freeze({
    status: "ready",
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    basis: INVESTMENT_LAB_RETURN_BASIS_POLICY,
    actualReturn: actual.totalReturn,
    scenarioReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.totalReturn) * 100,
    periodCount: actual.periodCount,
    actualFlowCount: actual.flowCount,
    scenarioFlowCount: scenario.flowCount,
    basisRowCount: basisRows.length,
    basisMismatchRows: 0,
    basisUnavailableRows: 0,
    evidence,
    blockers: [] as const,
  });
}

function blockedEstimate(input: {
  blockers: readonly InvestmentLabReturnEstimateBlocker[];
  actualFlowCount: number;
  scenarioFlowCount: number;
  basisRowCount: number;
  basisMismatchRows: number;
  basisUnavailableRows: number;
  evidence?: InvestmentLabReturnEvidenceResult | null;
}): InvestmentLabReturnEstimate {
  return Object.freeze({
    status: "blocked",
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    basis: INVESTMENT_LAB_RETURN_BASIS_POLICY,
    actualReturn: null,
    scenarioReturn: null,
    differencePercentagePoints: null,
    periodCount: 0,
    actualFlowCount: input.actualFlowCount,
    scenarioFlowCount: input.scenarioFlowCount,
    basisRowCount: input.basisRowCount,
    basisMismatchRows: input.basisMismatchRows,
    basisUnavailableRows: input.basisUnavailableRows,
    evidence: input.evidence ?? null,
    blockers: Object.freeze([...input.blockers]),
  });
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function samePrice(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(left)) * 1e-10;
}
