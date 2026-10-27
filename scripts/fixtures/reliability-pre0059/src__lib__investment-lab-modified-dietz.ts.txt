import {
  isRiskDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import {
  calculateInvestmentLabPathRisk,
  unavailableInvestmentLabPathRisk,
  type InvestmentLabPathRiskMetrics,
} from "./investment-lab-path-risk.ts";

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
      riskMetrics: InvestmentLabPathRiskMetrics;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
      totalReturn: null;
      periodCount: 0;
      flowCount: 0;
      periods: readonly [];
      riskMetrics: InvestmentLabPathRiskMetrics;
      blockers: readonly InvestmentLabModifiedDietzBlocker[];
    }>;

export const OBSERVED_TIMESTAMP_MODIFIED_DIETZ_POLICY = Object.freeze({
  ...INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  version: "observed_timestamp_modified_dietz_v1",
  classification: "cash_flow_weighted_return_estimate",
  valuationAxis: "observed_timestamps",
  externalFlowTiming: "observed_timestamps",
  flowWeight: "elapsed_milliseconds_fraction_remaining",
  cashBalance: "included_in_portfolio_valuation",
  incomeTreatment: "included_in_valuation_not_external_flow",
  feeTaxTreatment: "included_in_valuation_not_external_flow",
} as const);

type UnitReturnValuePoint = Readonly<{ boundary?: "before"; serviceDate: string; value: number; at?: string }>;
type UnitReturnFlow = Readonly<{ effectiveServiceDate: string; sequence: number; direction: "inflow" | "outflow"; amount: number; at?: string }>;
type UnitModifiedDietzPeriod = Readonly<{
  startServiceDate: string; endServiceDate: string; calendarDays: number;
  beginningValue: number; endingValue: number; netExternalFlow: number;
  weightedExternalFlow: number; denominator: number; flowCount: number; periodReturn: number;
  startAt?: string; endAt?: string;
}>;
type UnitDietzPolicy = typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY | typeof OBSERVED_TIMESTAMP_MODIFIED_DIETZ_POLICY;
type UnitModifiedDietzResult = Readonly<{
  status: "ready"; policy: UnitDietzPolicy; totalReturn: number; periodCount: number; flowCount: number;
  periods: readonly UnitModifiedDietzPeriod[]; riskMetrics: InvestmentLabPathRiskMetrics; blockers: readonly [];
}> | Readonly<{
  status: "blocked"; policy: UnitDietzPolicy; totalReturn: null; periodCount: 0; flowCount: 0;
  periods: readonly []; riskMetrics: InvestmentLabPathRiskMetrics; blockers: readonly InvestmentLabModifiedDietzBlocker[];
}>;

/** Legacy API and date-only policy retain their original KRW contract. */
export function calculateInvestmentLabModifiedDietz(input: {
  valuations: readonly InvestmentLabReturnValuePoint[]; flows: readonly InvestmentLabReturnFlow[];
}): InvestmentLabModifiedDietzResult {
  const result = calculateUnitModifiedDietz({
    valuations: input.valuations.map(row => ({ serviceDate: row.serviceDate, value: row.valueKrw })),
    flows: input.flows.map(row => ({ effectiveServiceDate: row.effectiveServiceDate, sequence: row.sequence, direction: row.direction, amount: row.amountKrw })),
  });
  if (result.status === "blocked") return Object.freeze({ ...result, policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY });
  return Object.freeze({ ...result, policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    periods: Object.freeze(result.periods.map(period => Object.freeze({
      startServiceDate: period.startServiceDate, endServiceDate: period.endServiceDate, calendarDays: period.calendarDays,
      beginningValueKrw: period.beginningValue, endingValueKrw: period.endingValue,
      netExternalFlowKrw: period.netExternalFlow, weightedExternalFlowKrw: period.weightedExternalFlow,
      denominatorKrw: period.denominator, flowCount: period.flowCount, periodReturn: period.periodReturn,
    }))),
  });
}

/** One currency-neutral period calculation, with explicit optional timestamp timing. */
export function calculateUnitModifiedDietz(input: {
  valuations: readonly UnitReturnValuePoint[];
  flows: readonly UnitReturnFlow[];
  timing?: "observed_timestamps";
}): UnitModifiedDietzResult {
  const timed = input.timing === "observed_timestamps";
  const policy = timed ? OBSERVED_TIMESTAMP_MODIFIED_DIETZ_POLICY : INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
  const blockers: InvestmentLabModifiedDietzBlocker[] = [];
  const valuations = normalizeValuations(input.valuations, blockers, timed);
  const flows = normalizeFlows(input.flows, blockers, timed);
  const valuationTime = (row: UnitReturnValuePoint) => timed ? Date.parse(row.at!) : Date.parse(`${row.serviceDate}T00:00:00Z`);
  const flowTime = (row: UnitReturnFlow) => timed ? Date.parse(row.at!) : Date.parse(`${row.effectiveServiceDate}T00:00:00Z`);

  if (valuations.length < 2) {
    blockers.push(blocker("insufficient_valuations"));
  }

  if (valuations.length >= 2) {
    const firstDate = valuationTime(valuations[0]);
    const lastDate = valuationTime(valuations.at(-1)!);
    flows.forEach((flow) => {
      if (
        (flowTime(flow) < firstDate || (valuations[0].boundary !== "before" && flowTime(flow) === firstDate)) ||
        (flowTime(flow) > lastDate || (valuations.at(-1)!.boundary === "before" && flowTime(flow) === lastDate))
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

  if (blockers.length > 0) return blocked(blockers, policy);

  const periods: UnitModifiedDietzPeriod[] = [];
  let flowIndex = 0;
  let linkedGrowth = 1;

  for (let index = 1; index < valuations.length; index += 1) {
    const beginning = valuations[index - 1];
    const ending = valuations[index];
    const calendarDays = timed ? (valuationTime(ending) - valuationTime(beginning)) / 86_400_000 : riskCalendarDayDistance(
      beginning.serviceDate,
      ending.serviceDate,
    );
    let netExternalFlow = 0;
    let weightedExternalFlow = 0;
    let flowCount = 0;

    while (
      flowIndex < flows.length &&
      (flowTime(flows[flowIndex]) < valuationTime(ending) || (ending.boundary !== "before" && flowTime(flows[flowIndex]) === valuationTime(ending)))
    ) {
      const flow = flows[flowIndex];
      const elapsedDays = timed ? (flowTime(flow) - valuationTime(beginning)) / 86_400_000 : riskCalendarDayDistance(
        beginning.serviceDate,
        flow.effectiveServiceDate,
      );
      const weight = (calendarDays - elapsedDays) / calendarDays;
      const signedAmount =
        flow.direction === "inflow" ? flow.amount : -flow.amount;

      netExternalFlow += signedAmount;
      weightedExternalFlow += signedAmount * weight;
      flowCount += 1;
      flowIndex += 1;
    }

    const denominator =
      beginning.value + weightedExternalFlow;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return blocked([
        blocker("non_positive_denominator", null, ending.serviceDate),
      ], policy);
    }

    const periodReturn =
      (ending.value - beginning.value - netExternalFlow) /
      denominator;
    const growth = 1 + periodReturn;
    if (!Number.isFinite(periodReturn) || growth < -1e-12) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate),
      ], policy);
    }

    linkedGrowth *= Math.max(0, growth);
    if (!Number.isFinite(linkedGrowth)) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate),
      ], policy);
    }

    periods.push(
      Object.freeze({
        startServiceDate: beginning.serviceDate,
        endServiceDate: ending.serviceDate,
        ...(timed ? { startAt: beginning.at!, endAt: ending.at! } : {}),
        calendarDays,
        beginningValue: beginning.value,
        endingValue: ending.value,
        netExternalFlow: cleanZero(netExternalFlow),
        weightedExternalFlow: cleanZero(weightedExternalFlow),
        denominator,
        flowCount,
        periodReturn: cleanZero(periodReturn),
      }),
    );
  }

  return Object.freeze({
    status: "ready",
    policy,
    totalReturn: cleanZero(linkedGrowth - 1),
    periodCount: periods.length,
    flowCount: flows.length,
    periods: Object.freeze(periods),
    riskMetrics: calculateInvestmentLabPathRisk(periods),
    blockers: [] as const,
  });
}

function normalizeValuations(
  rows: readonly UnitReturnValuePoint[],
  blockers: InvestmentLabModifiedDietzBlocker[],
  timed: boolean,
) {
  const seen = new Set<string>();
  const normalized: UnitReturnValuePoint[] = [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.serviceDate) || (timed && !Number.isFinite(Date.parse(row.at ?? "")))) {
      blockers.push(
        blocker("invalid_valuation_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    if (!Number.isFinite(row.value) || row.value < 0) {
      blockers.push(
        blocker("invalid_valuation_value", sourceIndex, row.serviceDate),
      );
      return;
    }
    const identity = timed ? String(Date.parse(row.at!)) : row.serviceDate;
    if (seen.has(identity)) {
      blockers.push(
        blocker("duplicate_valuation_date", sourceIndex, row.serviceDate),
      );
      return;
    }
    seen.add(identity);
    normalized.push({ serviceDate: row.serviceDate, value: row.value, ...(timed ? { at: row.at!, boundary: row.boundary } : {}) });
  });

  return normalized.sort((left, right) =>
    timed ? Date.parse(left.at!) - Date.parse(right.at!) : left.serviceDate.localeCompare(right.serviceDate),
  );
}

function normalizeFlows(
  rows: readonly UnitReturnFlow[],
  blockers: InvestmentLabModifiedDietzBlocker[],
  timed: boolean,
) {
  const seenSequences = new Set<number>();
  const normalized: Array<UnitReturnFlow & { sourceIndex: number }> =
    [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.effectiveServiceDate) || (timed && !Number.isFinite(Date.parse(row.at ?? "")))) {
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
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
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
      (timed ? Date.parse(left.at!) - Date.parse(right.at!) : left.effectiveServiceDate.localeCompare(right.effectiveServiceDate)) ||
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
  policy: UnitDietzPolicy,
): UnitModifiedDietzResult {
  return Object.freeze({
    status: "blocked",
    policy,
    totalReturn: null,
    periodCount: 0,
    flowCount: 0,
    periods: [] as const,
    riskMetrics: unavailableInvestmentLabPathRisk(),
    blockers: Object.freeze([...blockers]),
  });
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
