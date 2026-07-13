import {
  isRiskDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_MODIFIED_DIETZ_POLICY = Object.freeze({
  version: "modified_dietz_daily_weighted_eod_v1",
  method: "modified_dietz",
  classification: "estimated_time_weighted_return",
  valuationAxis: "observed_service_dates",
  externalFlowTiming: "end_of_day_date_only",
  flowWeight: "calendar_day_fraction_remaining",
  linking: "geometric",
  cashBalance: "outside_invested_position_boundary",
  incomeTreatment: "not_separately_observed",
  feeTaxTreatment: "not_separately_observed",
  complianceClaim: "none",
} as const);

export type InvestmentLabReturnValuePoint = Readonly<{
  serviceDate: string;
  valueKrw: number;
}>;

export type InvestmentLabReturnFlow = Readonly<{
  effectiveServiceDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

export type InvestmentLabModifiedDietzBlocker = Readonly<{
  reason:
    | "insufficient_valuations"
    | "invalid_valuation_date"
    | "invalid_valuation_value"
    | "duplicate_valuation_date"
    | "invalid_flow_date"
    | "invalid_flow_sequence"
    | "duplicate_flow_sequence"
    | "invalid_flow_direction"
    | "invalid_flow_amount"
    | "flow_outside_valuation_window"
    | "non_positive_denominator"
    | "invalid_period_return";
  sourceIndex: number | null;
  serviceDate: string | null;
}>;

export type InvestmentLabModifiedDietzPeriod = Readonly<{
  startServiceDate: string;
  endServiceDate: string;
  calendarDays: number;
  beginningValueKrw: number;
  endingValueKrw: number;
  netExternalFlowKrw: number;
  weightedExternalFlowKrw: number;
  denominatorKrw: number;
  flowCount: number;
  periodReturn: number;
}>;

export type InvestmentLabModifiedDietzResult =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      totalReturn: number;
      periodCount: number;
      flowCount: number;
      periods: readonly InvestmentLabModifiedDietzPeriod[];
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      totalReturn: null;
      periodCount: 0;
      flowCount: 0;
      periods: readonly [];
      blockers: readonly InvestmentLabModifiedDietzBlocker[];
    }>;

export function calculateInvestmentLabModifiedDietz(input: {
  valuations: readonly InvestmentLabReturnValuePoint[];
  flows: readonly InvestmentLabReturnFlow[];
}): InvestmentLabModifiedDietzResult {
  const blockers: InvestmentLabModifiedDietzBlocker[] = [];
  const valuations = normalizeValuations(input.valuations, blockers);
  const flows = normalizeFlows(input.flows, blockers);

  if (valuations.length < 2) {
    blockers.push(blocker("insufficient_valuations"));
  }

  if (valuations.length >= 2) {
    const firstDate = valuations[0].serviceDate;
    const lastDate = valuations.at(-1)!.serviceDate;
    flows.forEach((flow) => {
      if (
        flow.effectiveServiceDate <= firstDate ||
        flow.effectiveServiceDate > lastDate
      ) {
        blockers.push(
          blocker(
            "flow_outside_valuation_window",
            flow.sourceIndex,
            flow.effectiveServiceDate,
          ),
        );
      }
    });
  }

  if (blockers.length > 0) return blocked(blockers);

  const periods: InvestmentLabModifiedDietzPeriod[] = [];
  let flowIndex = 0;
  let linkedGrowth = 1;

  for (let index = 1; index < valuations.length; index += 1) {
    const beginning = valuations[index - 1];
    const ending = valuations[index];
    const calendarDays = riskCalendarDayDistance(
      beginning.serviceDate,
      ending.serviceDate,
    );
    let netExternalFlowKrw = 0;
    let weightedExternalFlowKrw = 0;
    let flowCount = 0;

    while (
      flowIndex < flows.length &&
      flows[flowIndex].effectiveServiceDate <= ending.serviceDate
    ) {
      const flow = flows[flowIndex];
      const elapsedDays = riskCalendarDayDistance(
        beginning.serviceDate,
        flow.effectiveServiceDate,
      );
      const weight = (calendarDays - elapsedDays) / calendarDays;
      const signedAmount =
        flow.direction === "inflow" ? flow.amountKrw : -flow.amountKrw;

      netExternalFlowKrw += signedAmount;
      weightedExternalFlowKrw += signedAmount * weight;
      flowCount += 1;
      flowIndex += 1;
    }

    const denominatorKrw =
      beginning.valueKrw + weightedExternalFlowKrw;
    if (!Number.isFinite(denominatorKrw) || denominatorKrw <= 0) {
      return blocked([
        blocker("non_positive_denominator", null, ending.serviceDate),
      ]);
    }

    const periodReturn =
      (ending.valueKrw - beginning.valueKrw - netExternalFlowKrw) /
      denominatorKrw;
    const growth = 1 + periodReturn;
    if (!Number.isFinite(periodReturn) || growth < -1e-12) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate),
      ]);
    }

    linkedGrowth *= Math.max(0, growth);
    if (!Number.isFinite(linkedGrowth)) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate),
      ]);
    }

    periods.push(
      Object.freeze({
        startServiceDate: beginning.serviceDate,
        endServiceDate: ending.serviceDate,
        calendarDays,
        beginningValueKrw: beginning.valueKrw,
        endingValueKrw: ending.valueKrw,
        netExternalFlowKrw: cleanZero(netExternalFlowKrw),
        weightedExternalFlowKrw: cleanZero(weightedExternalFlowKrw),
        denominatorKrw,
        flowCount,
        periodReturn: cleanZero(periodReturn),
      }),
    );
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    totalReturn: cleanZero(linkedGrowth - 1),
    periodCount: periods.length,
    flowCount: flows.length,
    periods: Object.freeze(periods),
    blockers: [] as const,
  });
}

function normalizeValuations(
  rows: readonly InvestmentLabReturnValuePoint[],
  blockers: InvestmentLabModifiedDietzBlocker[],
) {
  const seen = new Set<string>();
  const normalized: InvestmentLabReturnValuePoint[] = [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.serviceDate)) {
      blockers.push(
        blocker("invalid_valuation_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    if (!Number.isFinite(row.valueKrw) || row.valueKrw < 0) {
      blockers.push(
        blocker("invalid_valuation_value", sourceIndex, row.serviceDate),
      );
      return;
    }
    if (seen.has(row.serviceDate)) {
      blockers.push(
        blocker("duplicate_valuation_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    seen.add(row.serviceDate);
    normalized.push({ serviceDate: row.serviceDate, valueKrw: row.valueKrw });
  });

  return normalized.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
}

function normalizeFlows(
  rows: readonly InvestmentLabReturnFlow[],
  blockers: InvestmentLabModifiedDietzBlocker[],
) {
  const seenSequences = new Set<number>();
  const normalized: Array<InvestmentLabReturnFlow & { sourceIndex: number }> =
    [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.effectiveServiceDate)) {
      blockers.push(
        blocker("invalid_flow_date", sourceIndex, row.effectiveServiceDate),
      );
      return;
    }
    if (!Number.isInteger(row.sequence) || row.sequence < 0) {
      blockers.push(
        blocker(
          "invalid_flow_sequence",
          sourceIndex,
          row.effectiveServiceDate,
        ),
      );
      return;
    }
    if (seenSequences.has(row.sequence)) {
      blockers.push(
        blocker(
          "duplicate_flow_sequence",
          sourceIndex,
          row.effectiveServiceDate,
        ),
      );
      return;
    }
    if (row.direction !== "inflow" && row.direction !== "outflow") {
      blockers.push(
        blocker(
          "invalid_flow_direction",
          sourceIndex,
          row.effectiveServiceDate,
        ),
      );
      return;
    }
    if (!Number.isFinite(row.amountKrw) || row.amountKrw <= 0) {
      blockers.push(
        blocker(
          "invalid_flow_amount",
          sourceIndex,
          row.effectiveServiceDate,
        ),
      );
      return;
    }

    seenSequences.add(row.sequence);
    normalized.push({ ...row, sourceIndex });
  });

  return normalized.sort(
    (left, right) =>
      left.effectiveServiceDate.localeCompare(right.effectiveServiceDate) ||
      left.sequence - right.sequence ||
      left.sourceIndex - right.sourceIndex,
  );
}

function blocker(
  reason: InvestmentLabModifiedDietzBlocker["reason"],
  sourceIndex: number | null = null,
  serviceDate: string | null = null,
): InvestmentLabModifiedDietzBlocker {
  return Object.freeze({ reason, sourceIndex, serviceDate });
}

function blocked(
  blockers: readonly InvestmentLabModifiedDietzBlocker[],
): InvestmentLabModifiedDietzResult {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    totalReturn: null,
    periodCount: 0,
    flowCount: 0,
    periods: [] as const,
    blockers: Object.freeze([...blockers]),
  });
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
