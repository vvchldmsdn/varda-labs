import {
  calculateInvestmentLabModifiedDietz,
  type InvestmentLabReturnFlow,
} from "./investment-lab-modified-dietz.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_CASH_COMPARISON_POLICY = Object.freeze({
  version: "zero_return_same_flow_cash_v1",
  account: "all",
  initialValue: "first_observed_invested_position_value",
  flowSource: "same_buy_sell_krw_boundary_flows",
  flowTiming: "event_date_mapped_to_next_service_date",
  interestRateAnnualPct: 0,
  transactionCostsKrw: 0,
  taxKrw: 0,
  persistence: "none",
} as const);

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

type ActualReturnEvidence = Readonly<{
  status: "ready" | "blocked" | "unavailable";
  actualReturn: number | null;
}>;

export type InvestmentLabCashComparisonBlocker =
  | "insufficient_actual_path"
  | "invalid_actual_path"
  | "invalid_boundary_flow"
  | "cash_balance_negative"
  | "cash_return_calculation_blocked"
  | "cash_return_not_zero"
  | "actual_return_unavailable"
  | "account_composition_incomplete"
  | "account_composition_mismatch";

export type InvestmentLabCashComparisonRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  differenceKrw: number;
  hasPendingExecution: false;
}>;

type CashReturnComparison =
  | Readonly<{
      status: "ready";
      actualReturn: number;
      cashReturn: number;
      differencePercentagePoints: number;
      periodCount: number;
      flowCount: number;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      actualReturn: null;
      cashReturn: number | null;
      differencePercentagePoints: null;
      periodCount: number;
      flowCount: number;
      blockers: readonly InvestmentLabCashComparisonBlocker[];
    }>;

export type InvestmentLabCashComparison =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_CASH_COMPARISON_POLICY;
      summary: Readonly<{
        startServiceDate: string;
        endServiceDate: string;
        actualEndValueKrw: number;
        scenarioEndValueKrw: number;
        endDifferenceKrw: number;
        comparisonDateCount: number;
      }>;
      returnComparison: CashReturnComparison;
      rows: readonly InvestmentLabCashComparisonRow[];
      coverage: Readonly<{
        appliedFlowRows: number;
        ignoredThroughAnchorRows: number;
        afterWindowRows: number;
      }>;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      policy: typeof INVESTMENT_LAB_CASH_COMPARISON_POLICY;
      summary: null;
      returnComparison: null;
      rows: readonly [];
      coverage: Readonly<{
        appliedFlowRows: 0;
        ignoredThroughAnchorRows: number;
        afterWindowRows: number;
      }>;
      blockers: readonly InvestmentLabCashComparisonBlocker[];
    }>;

export function buildInvestmentLabCashComparison(input: {
  actualPath: readonly ActualPathRow[];
  boundaryFlows: readonly BoundaryFlow[];
  actualReturnEstimate: ActualReturnEvidence | null;
}): InvestmentLabCashComparison {
  const actualPath = normalizeActualPath(input.actualPath);
  if (actualPath === null) {
    return unavailable([
      input.actualPath.length < 2
        ? "insufficient_actual_path"
        : "invalid_actual_path",
    ]);
  }

  const normalizedFlows = normalizeFlows(input.boundaryFlows);
  if (normalizedFlows === null) {
    return unavailable(["invalid_boundary_flow"]);
  }

  const firstDate = actualPath[0].serviceDate;
  const lastDate = actualPath.at(-1)!.serviceDate;
  const ignoredThroughAnchorRows = normalizedFlows.filter(
    (flow) => flow.effectiveServiceDate <= firstDate,
  ).length;
  const afterWindowRows = normalizedFlows.filter(
    (flow) => flow.effectiveServiceDate > lastDate,
  ).length;
  const appliedFlows = normalizedFlows.filter(
    (flow) =>
      flow.effectiveServiceDate > firstDate &&
      flow.effectiveServiceDate <= lastDate,
  );

  let balanceKrw = actualPath[0].totalMarketValueKrw;
  let flowIndex = 0;
  const rows: InvestmentLabCashComparisonRow[] = [];

  for (const actual of actualPath) {
    while (
      flowIndex < appliedFlows.length &&
      appliedFlows[flowIndex].effectiveServiceDate <= actual.serviceDate
    ) {
      const flow = appliedFlows[flowIndex];
      balanceKrw +=
        flow.direction === "inflow" ? flow.amountKrw : -flow.amountKrw;
      flowIndex += 1;
    }

    if (!Number.isFinite(balanceKrw) || balanceKrw < -1e-8) {
      return unavailable(
        ["cash_balance_negative"],
        ignoredThroughAnchorRows,
        afterWindowRows,
      );
    }
    if (Math.abs(balanceKrw) <= 1e-8) balanceKrw = 0;

    rows.push(
      Object.freeze({
        serviceDate: actual.serviceDate,
        actualMarketValueKrw: actual.totalMarketValueKrw,
        scenarioMarketValueKrw: balanceKrw,
        differenceKrw: balanceKrw - actual.totalMarketValueKrw,
        hasPendingExecution: false as const,
      }),
    );
  }

  const returnComparison = buildReturnComparison({
    rows,
    appliedFlows,
    actualReturnEstimate: input.actualReturnEstimate,
  });
  const latest = rows.at(-1)!;

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_CASH_COMPARISON_POLICY,
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnComparison,
    rows: Object.freeze(rows),
    coverage: Object.freeze({
      appliedFlowRows: appliedFlows.length,
      ignoredThroughAnchorRows,
      afterWindowRows,
    }),
    blockers: [] as const,
  });
}

function buildReturnComparison(input: {
  rows: readonly InvestmentLabCashComparisonRow[];
  appliedFlows: readonly InvestmentLabReturnFlow[];
  actualReturnEstimate: ActualReturnEvidence | null;
}): CashReturnComparison {
  const cashReturn = calculateInvestmentLabModifiedDietz({
    valuations: input.rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.scenarioMarketValueKrw,
    })),
    flows: input.appliedFlows,
  });
  if (cashReturn.status !== "ready") {
    return unavailableReturn(
      ["cash_return_calculation_blocked"],
      null,
      0,
      input.appliedFlows.length,
    );
  }
  if (Math.abs(cashReturn.totalReturn) > 1e-10) {
    return unavailableReturn(
      ["cash_return_not_zero"],
      cashReturn.totalReturn,
      cashReturn.periodCount,
      cashReturn.flowCount,
    );
  }
  if (
    !input.actualReturnEstimate ||
    input.actualReturnEstimate.status !== "ready" ||
    input.actualReturnEstimate.actualReturn === null
  ) {
    return unavailableReturn(
      ["actual_return_unavailable"],
      cashReturn.totalReturn,
      cashReturn.periodCount,
      cashReturn.flowCount,
    );
  }

  return Object.freeze({
    status: "ready",
    actualReturn: input.actualReturnEstimate.actualReturn,
    cashReturn: cashReturn.totalReturn,
    differencePercentagePoints:
      (cashReturn.totalReturn - input.actualReturnEstimate.actualReturn) * 100,
    periodCount: cashReturn.periodCount,
    flowCount: cashReturn.flowCount,
    blockers: [] as const,
  });
}

function normalizeActualPath(rows: readonly ActualPathRow[]) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const seen = new Set<string>();
  const normalized: ActualPathRow[] = [];
  for (const row of rows) {
    if (
      !isRiskDate(row.serviceDate) ||
      !Number.isFinite(row.totalMarketValueKrw) ||
      row.totalMarketValueKrw <= 0 ||
      seen.has(row.serviceDate)
    ) {
      return null;
    }
    seen.add(row.serviceDate);
    normalized.push(Object.freeze({ ...row }));
  }
  return normalized.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
}

function normalizeFlows(rows: readonly BoundaryFlow[]) {
  if (!Array.isArray(rows)) return null;
  const seen = new Set<string>();
  const normalized: Array<InvestmentLabReturnFlow & { sourceIndex: number }> = [];
  for (const [sourceIndex, row] of rows.entries()) {
    const identity = `${row.eventDate}:${row.sequence}`;
    if (
      !isRiskDate(row.eventDate) ||
      !Number.isInteger(row.sequence) ||
      row.sequence < 0 ||
      seen.has(identity) ||
      (row.direction !== "inflow" && row.direction !== "outflow") ||
      !Number.isFinite(row.amountKrw) ||
      row.amountKrw <= 0
    ) {
      return null;
    }
    seen.add(identity);
    normalized.push(
      Object.freeze({
        effectiveServiceDate: mapRiskEvidenceDateToServiceDate(row.eventDate),
        sequence: row.sequence,
        direction: row.direction,
        amountKrw: row.amountKrw,
        sourceIndex,
      }),
    );
  }
  return normalized.sort(
    (left, right) =>
      left.effectiveServiceDate.localeCompare(right.effectiveServiceDate) ||
      left.sequence - right.sequence ||
      left.sourceIndex - right.sourceIndex,
  );
}

function unavailable(
  blockers: readonly InvestmentLabCashComparisonBlocker[],
  ignoredThroughAnchorRows = 0,
  afterWindowRows = 0,
): InvestmentLabCashComparison {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_CASH_COMPARISON_POLICY,
    summary: null,
    returnComparison: null,
    rows: [] as const,
    coverage: Object.freeze({
      appliedFlowRows: 0 as const,
      ignoredThroughAnchorRows,
      afterWindowRows,
    }),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function unavailableReturn(
  blockers: readonly InvestmentLabCashComparisonBlocker[],
  cashReturn: number | null,
  periodCount: number,
  flowCount: number,
): CashReturnComparison {
  return Object.freeze({
    status: "unavailable",
    actualReturn: null,
    cashReturn,
    differencePercentagePoints: null,
    periodCount,
    flowCount,
    blockers: Object.freeze([...blockers].sort()),
  });
}
