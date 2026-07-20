import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";
import {
  validateInvestmentLabReturnEvidence,
  type InvestmentLabReturnEvidenceBlocker,
  type InvestmentLabReturnEvidenceEvent,
  type InvestmentLabReturnEvidenceResult,
  type InvestmentLabReturnEvidenceSnapshot,
} from "./investment-lab-return-evidence.ts";
import type { InvestmentLabVooAppliedFlow } from "./investment-lab-voo-path.ts";
import { mapRiskEvidenceDateToServiceDate } from "./portfolio-risk-calendar.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_VOO_RETURN_BASIS_POLICY = Object.freeze({
  version: "voo_raw_close_snapshot_fx_price_only_v1",
  scenarioPriceBasis: "raw_close_usd_times_stored_snapshot_fx",
  fractionalUnits: true,
  residualCashKrw: 0,
  distributionTreatment: "excluded_not_reinvested",
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
}>;

type BoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

export type InvestmentLabVooReturnEstimateBlocker =
  | InvestmentLabReturnEvidenceBlocker
  | "valuation_axis_mismatch"
  | "actual_return_calculation_blocked"
  | "scenario_return_calculation_blocked";

export type InvestmentLabVooReturnEstimate =
  | Readonly<{
      status: "ready";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      basis: typeof INVESTMENT_LAB_VOO_RETURN_BASIS_POLICY;
      actualReturn: number;
      scenarioReturn: number;
      differencePercentagePoints: number;
      periodCount: number;
      actualFlowCount: number;
      scenarioFlowCount: number;
      actualRiskMetrics: InvestmentLabPathRiskMetrics;
      scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
      evidence: InvestmentLabReturnEvidenceResult;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      basis: typeof INVESTMENT_LAB_VOO_RETURN_BASIS_POLICY;
      actualReturn: null;
      scenarioReturn: null;
      differencePercentagePoints: null;
      periodCount: 0;
      actualFlowCount: number;
      scenarioFlowCount: number;
      evidence: InvestmentLabReturnEvidenceResult | null;
      blockers: readonly InvestmentLabVooReturnEstimateBlocker[];
    }>;

export function buildInvestmentLabVooReturnEstimate(input: {
  account?: PortfolioAccountScope;
  actualRows: readonly ActualValueRow[];
  scenarioRows: readonly ScenarioValueRow[];
  boundaryFlows: readonly BoundaryFlow[];
  appliedFlows: readonly InvestmentLabVooAppliedFlow[];
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
}): InvestmentLabVooReturnEstimate {
  const axisMatches =
    input.actualRows.length === input.scenarioRows.length &&
    input.actualRows.length >= 2 &&
    input.actualRows.every(
      (row, index) => row.serviceDate === input.scenarioRows[index].serviceDate,
    );
  const startServiceDate = input.actualRows[0]?.serviceDate ?? null;
  const endServiceDate = input.actualRows.at(-1)?.serviceDate ?? null;
  if (!axisMatches || !startServiceDate || !endServiceDate) {
    return blockedEstimate({
      blockers: ["valuation_axis_mismatch"],
      actualFlowCount: 0,
      scenarioFlowCount: 0,
    });
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
    account: input.account,
    serviceDates: input.actualRows.map((row) => row.serviceDate),
    snapshotRows: input.snapshotRows,
    eventRows: input.eventRows,
  });
  if (evidence.status !== "ready") {
    return blockedEstimate({
      blockers: evidence.blockers,
      actualFlowCount: actualFlows.length,
      scenarioFlowCount: scenarioFlows.length,
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
    const blockers: InvestmentLabVooReturnEstimateBlocker[] = [];
    if (actual.status !== "ready") {
      blockers.push("actual_return_calculation_blocked");
    }
    if (scenario.status !== "ready") {
      blockers.push("scenario_return_calculation_blocked");
    }
    return blockedEstimate({
      blockers,
      actualFlowCount: actualFlows.length,
      scenarioFlowCount: scenarioFlows.length,
      evidence,
    });
  }

  return Object.freeze({
    status: "ready",
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    basis: INVESTMENT_LAB_VOO_RETURN_BASIS_POLICY,
    actualReturn: actual.totalReturn,
    scenarioReturn: scenario.totalReturn,
    differencePercentagePoints:
      (scenario.totalReturn - actual.totalReturn) * 100,
    periodCount: actual.periodCount,
    actualFlowCount: actual.flowCount,
    scenarioFlowCount: scenario.flowCount,
    actualRiskMetrics: actual.riskMetrics,
    scenarioRiskMetrics: scenario.riskMetrics,
    evidence,
    blockers: [] as const,
  });
}

function blockedEstimate(input: {
  blockers: readonly InvestmentLabVooReturnEstimateBlocker[];
  actualFlowCount: number;
  scenarioFlowCount: number;
  evidence?: InvestmentLabReturnEvidenceResult | null;
}): InvestmentLabVooReturnEstimate {
  return Object.freeze({
    status: "blocked",
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    basis: INVESTMENT_LAB_VOO_RETURN_BASIS_POLICY,
    actualReturn: null,
    scenarioReturn: null,
    differencePercentagePoints: null,
    periodCount: 0,
    actualFlowCount: input.actualFlowCount,
    scenarioFlowCount: input.scenarioFlowCount,
    evidence: input.evidence ?? null,
    blockers: Object.freeze([...input.blockers]),
  });
}
