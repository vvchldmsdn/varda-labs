import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";
import {
  validateInvestmentLabReturnEvidence,
  type InvestmentLabReturnEvidenceBlocker,
  type InvestmentLabReturnEvidenceEvent,
  type InvestmentLabReturnEvidenceSnapshot,
} from "./investment-lab-return-evidence.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_OBSERVED_PATH_POLICY = Object.freeze({
  version: "stored_observed_portfolio_path_v1",
  authority: "trusted_daily_portfolio_snapshots",
  scenarioDependency: "none",
  missingEvidence: "fail_closed",
  persistence: "none",
} as const);

export type InvestmentLabObservedPathRow = Readonly<{
  serviceDate: string;
  marketValueKrw: number;
}>;

export type InvestmentLabObservedReturnEstimate =
  | Readonly<{
      status: "ready";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      actualReturn: number;
      periodCount: number;
      flowCount: number;
      riskMetrics: InvestmentLabPathRiskMetrics;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      actualReturn: null;
      periodCount: 0;
      flowCount: number;
      blockers: readonly string[];
    }>;

export type InvestmentLabObservedPath =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_OBSERVED_PATH_POLICY;
      summary: Readonly<{
        startServiceDate: string;
        endServiceDate: string;
        endValueKrw: number;
        comparisonDateCount: number;
      }>;
      rows: readonly InvestmentLabObservedPathRow[];
      returnEstimate: InvestmentLabObservedReturnEstimate;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      policy: typeof INVESTMENT_LAB_OBSERVED_PATH_POLICY;
      summary: null;
      rows: readonly [];
      returnEstimate: InvestmentLabObservedReturnEstimate;
      blockers: readonly string[];
    }>;

type ActualPathRow = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

type BoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

export function buildInvestmentLabObservedPath(input: Readonly<{
  account: PortfolioAccountScope;
  actualRows: readonly ActualPathRow[];
  boundaryFlows: readonly BoundaryFlow[];
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
  blockers?: readonly string[];
}>): InvestmentLabObservedPath {
  const blockers = unique(input.blockers ?? []);
  if (blockers.length > 0 || !validActualRows(input.actualRows)) {
    return unavailableInvestmentLabObservedPath(
      blockers.length > 0 ? blockers : ["actual_path_invalid"],
      input.boundaryFlows.length,
    );
  }

  const rows = Object.freeze(
    input.actualRows.map((row) =>
      Object.freeze({
        serviceDate: row.serviceDate,
        marketValueKrw: row.totalMarketValueKrw,
      }),
    ),
  );
  const latest = rows.at(-1)!;

  return Object.freeze({
    status: "ready" as const,
    policy: INVESTMENT_LAB_OBSERVED_PATH_POLICY,
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      endValueKrw: latest.marketValueKrw,
      comparisonDateCount: rows.length,
    }),
    rows,
    returnEstimate: buildObservedReturnEstimate({
      account: input.account,
      rows,
      boundaryFlows: input.boundaryFlows,
      snapshotRows: input.snapshotRows,
      eventRows: input.eventRows,
    }),
    blockers: [] as const,
  });
}

function buildObservedReturnEstimate(input: Readonly<{
  account: PortfolioAccountScope;
  rows: readonly InvestmentLabObservedPathRow[];
  boundaryFlows: readonly BoundaryFlow[];
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
}>): InvestmentLabObservedReturnEstimate {
  const evidence = validateInvestmentLabReturnEvidence({
    account: input.account,
    serviceDates: input.rows.map((row) => row.serviceDate),
    snapshotRows: input.snapshotRows,
    eventRows: input.eventRows,
  });
  if (evidence.status !== "ready") {
    return unavailableObservedReturn(
      evidence.blockers,
      input.boundaryFlows.length,
    );
  }

  const startServiceDate = input.rows[0].serviceDate;
  const endServiceDate = input.rows.at(-1)!.serviceDate;
  const flows = input.boundaryFlows
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
  const result = calculateInvestmentLabModifiedDietz({
    valuations: input.rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.marketValueKrw,
    })),
    flows,
  });
  if (result.status !== "ready") {
    return unavailableObservedReturn(
      ["actual_return_calculation_blocked"],
      flows.length,
    );
  }

  return Object.freeze({
    status: "ready" as const,
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    actualReturn: result.totalReturn,
    periodCount: result.periodCount,
    flowCount: result.flowCount,
    riskMetrics: result.riskMetrics,
    blockers: [] as const,
  });
}

function validActualRows(rows: readonly ActualPathRow[]) {
  return (
    rows.length >= 2 &&
    rows.every(
      (row, index) =>
        isRiskDate(row.serviceDate) &&
        Number.isFinite(row.totalMarketValueKrw) &&
        row.totalMarketValueKrw >= 0 &&
        (index === 0 || rows[index - 1].serviceDate < row.serviceDate),
    )
  );
}

export function unavailableInvestmentLabObservedPath(
  blockers: readonly string[],
  flowCount: number,
): InvestmentLabObservedPath {
  return Object.freeze({
    status: "unavailable" as const,
    policy: INVESTMENT_LAB_OBSERVED_PATH_POLICY,
    summary: null,
    rows: [] as const,
    returnEstimate: unavailableObservedReturn(blockers, flowCount),
    blockers: Object.freeze(unique(blockers)),
  });
}

function unavailableObservedReturn(
  blockers: readonly (string | InvestmentLabReturnEvidenceBlocker)[],
  flowCount: number,
): InvestmentLabObservedReturnEstimate {
  return Object.freeze({
    status: "unavailable" as const,
    method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    actualReturn: null,
    periodCount: 0 as const,
    flowCount,
    blockers: Object.freeze(unique(blockers.map(String))),
  });
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort();
}
