import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import type { InvestmentLabFlowDirection } from "./investment-lab-event-flow.ts";

export const INVESTMENT_LAB_EXECUTION_POLICY = Object.freeze({
  version: "eod_admitted_close_on_or_after_v2",
  priceField: "single_admitted_scenario_close",
  maxPendingCalendarDays: 7,
  pendingBuyAccounting: "zero_return_krw_cash_from_event_date",
  pendingSellAccounting: "krw_withdrawal_obligation_from_event_date",
  eventNetting: "forbidden",
  priorCloseExecution: "forbidden",
  preInceptionFill: "forbidden",
  insolvency: "fail_closed_long_only",
} as const);

export type InvestmentLabAmountProvenance =
  | "explicit_amount_krw"
  | "derived_quantity_price_krw"
  | "derived_quantity_price_fx";

export type InvestmentLabBoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: InvestmentLabFlowDirection;
  amountKrw: number;
  amountProvenance: InvestmentLabAmountProvenance;
}>;

export type InvestmentLabAdjustedClose = Readonly<{
  priceDate: string;
  adjustedClose: number;
}>;

export type InvestmentLabScheduledFlow = InvestmentLabBoundaryFlow &
  Readonly<{
    sourceIndex: number;
    executionPriceDate: string;
    executionServiceDate: string;
    adjustedClose: number;
    pendingCalendarDays: number;
  }>;

export type InvestmentLabMoneyFlow = Omit<InvestmentLabBoundaryFlow, "amountKrw" | "amountProvenance"> & Readonly<{ amount: number; amountProvenance: InvestmentLabAmountProvenance | "dated_reporting_money"; eventAt?: string }>;
export type InvestmentLabScheduledMoneyFlow = InvestmentLabMoneyFlow & Readonly<{ sourceIndex: number; executionPriceDate: string; executionServiceDate: string; adjustedClose: number; pendingCalendarDays: number }>;
export type InvestmentLabPendingMoneyFlow = InvestmentLabMoneyFlow & Readonly<{ sourceIndex: number }>;

export type InvestmentLabScheduleBlocker = Readonly<{
  reason:
    | "invalid_window_end"
    | "invalid_pending_limit"
    | "invalid_close_date"
    | "invalid_adjusted_close"
    | "duplicate_close_date"
    | "invalid_event_date"
    | "invalid_event_sequence"
    | "invalid_event_direction"
    | "invalid_event_amount"
    | "invalid_amount_provenance"
    | "event_after_window_end"
    | "unexecutable_trade_before_window_end"
    | "pending_limit_exceeded";
  sourceIndex: number | null;
}>;

export function scheduleInvestmentLabBoundaryFlows(input: {
  events: readonly InvestmentLabBoundaryFlow[];
  closes: readonly InvestmentLabAdjustedClose[];
  windowEndPriceDate: string;
  maxPendingCalendarDays?: number;
}) {
  const invalidProvenance = input.events.flatMap((row, sourceIndex) => !["explicit_amount_krw", "derived_quantity_price_krw", "derived_quantity_price_fx"].includes(row.amountProvenance) ? [{ reason: "invalid_amount_provenance" as const, sourceIndex }] : []);
  const result = invalidProvenance.length ? blockedSchedule(invalidProvenance) : scheduleInvestmentLabMoneyFlows({ ...input, events: input.events.map(({ amountKrw, ...row }) => ({ ...row, amount: amountKrw })) });
  return { status: result.status, policy: result.policy, blockers: result.blockers, pendingFlowCount: result.pendingFlowCount, sameDayFlowCount: result.sameDayFlowCount,
    scheduledFlows: result.scheduledFlows.map(({ amount, ...row }) => ({ ...row, amountKrw: amount, amountProvenance: row.amountProvenance as InvestmentLabAmountProvenance })) };
}

/** Same execution policy in the caller's explicit reporting unit. */
export function scheduleInvestmentLabMoneyFlows(input: {
  events: readonly InvestmentLabMoneyFlow[];
  closes: readonly InvestmentLabAdjustedClose[];
  windowEndPriceDate: string;
  maxPendingCalendarDays?: number;
  allowPendingAtWindowEnd?: boolean;
}) {
  const blockers: InvestmentLabScheduleBlocker[] = [];
  if (!isRiskDate(input.windowEndPriceDate)) {
    blockers.push({ reason: "invalid_window_end", sourceIndex: null });
  }

  const closes = normalizeCloses(input.closes, blockers);
  const events = normalizeEvents(input.events, blockers);
  const maxPendingCalendarDays =
    input.maxPendingCalendarDays ??
    INVESTMENT_LAB_EXECUTION_POLICY.maxPendingCalendarDays;
  if (
    !Number.isInteger(maxPendingCalendarDays) ||
    maxPendingCalendarDays < 0 ||
    maxPendingCalendarDays > 31
  ) {
    blockers.push({ reason: "invalid_pending_limit", sourceIndex: null });
  }

  if (blockers.length > 0) return blockedSchedule(blockers);

  const scheduled: InvestmentLabScheduledMoneyFlow[] = [];
  const pending: InvestmentLabPendingMoneyFlow[] = [];
  let closeIndex = 0;

  for (const event of events) {
    if (event.eventDate > input.windowEndPriceDate) {
      if (input.allowPendingAtWindowEnd && event.eventDate === mapRiskEvidenceDateToServiceDate(input.windowEndPriceDate)) { pending.push(event); continue; }
      blockers.push({
        reason: "event_after_window_end",
        sourceIndex: event.sourceIndex,
      });
      continue;
    }

    while (
      closeIndex < closes.length &&
      closes[closeIndex].priceDate < event.eventDate
    ) {
      closeIndex += 1;
    }

    const close = closes[closeIndex];
    if (!close || close.priceDate > input.windowEndPriceDate) {
      if (input.allowPendingAtWindowEnd && riskCalendarDayDistance(event.eventDate, input.windowEndPriceDate) <= maxPendingCalendarDays) { pending.push(event); continue; }
      blockers.push({
        reason: "unexecutable_trade_before_window_end",
        sourceIndex: event.sourceIndex,
      });
      continue;
    }

    const pendingCalendarDays = riskCalendarDayDistance(
      event.eventDate,
      close.priceDate,
    );
    if (pendingCalendarDays > maxPendingCalendarDays) {
      blockers.push({
        reason: "pending_limit_exceeded",
        sourceIndex: event.sourceIndex,
      });
      continue;
    }

    scheduled.push({
      ...event,
      executionPriceDate: close.priceDate,
      executionServiceDate: mapRiskEvidenceDateToServiceDate(close.priceDate),
      adjustedClose: close.adjustedClose,
      pendingCalendarDays,
    });
  }

  if (blockers.length > 0) return blockedSchedule(blockers);

  return {
    status: "ready",
    policy: INVESTMENT_LAB_EXECUTION_POLICY.version,
    scheduledFlows: scheduled,
    pendingFlows: pending,
    blockers: [],
    pendingFlowCount: scheduled.filter((row) => row.pendingCalendarDays > 0)
      .length,
    sameDayFlowCount: scheduled.filter((row) => row.pendingCalendarDays === 0)
      .length,
  } as const;
}

export function applyInvestmentLabScheduledFlow(
  units: number,
  flow: Pick<
    InvestmentLabScheduledFlow,
    "direction" | "amountKrw" | "adjustedClose"
  >,
) {
  return applyInvestmentLabUnitFlow(units, { direction: flow.direction, amount: flow.amountKrw, adjustedClose: flow.adjustedClose });
}

export function applyInvestmentLabUnitFlow(units: number, flow: Pick<InvestmentLabScheduledMoneyFlow, "direction" | "amount" | "adjustedClose">) {
  if (
    !Number.isFinite(units) ||
    units < 0 ||
    !Number.isFinite(flow.amount) ||
    flow.amount <= 0 ||
    !Number.isFinite(flow.adjustedClose) ||
    flow.adjustedClose <= 0 ||
    (flow.direction !== "inflow" && flow.direction !== "outflow")
  ) {
    return {
      status: "blocked",
      reason: "invalid_execution_state",
      units: null,
    } as const;
  }

  const unitDelta = flow.amount / flow.adjustedClose;
  if (
    flow.direction === "outflow" &&
    units * flow.adjustedClose + 1e-6 < flow.amount
  ) {
    return {
      status: "blocked",
      reason: "scenario_insolvent",
      units: null,
    } as const;
  }

  return {
    status: "applied",
    reason: null,
    units:
      flow.direction === "inflow"
        ? units + unitDelta
        : Math.max(0, units - unitDelta),
  } as const;
}

function normalizeCloses(
  rows: readonly InvestmentLabAdjustedClose[],
  blockers: InvestmentLabScheduleBlocker[],
) {
  const seen = new Set<string>();
  const normalized: InvestmentLabAdjustedClose[] = [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.priceDate)) {
      blockers.push({ reason: "invalid_close_date", sourceIndex });
      return;
    }
    if (!Number.isFinite(row.adjustedClose) || row.adjustedClose <= 0) {
      blockers.push({ reason: "invalid_adjusted_close", sourceIndex });
      return;
    }
    if (seen.has(row.priceDate)) {
      blockers.push({ reason: "duplicate_close_date", sourceIndex });
      return;
    }
    seen.add(row.priceDate);
    normalized.push({
      priceDate: row.priceDate,
      adjustedClose: row.adjustedClose,
    });
  });

  return normalized.sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
}

function normalizeEvents(
  rows: readonly InvestmentLabMoneyFlow[],
  blockers: InvestmentLabScheduleBlocker[],
) {
  const normalized: Array<InvestmentLabMoneyFlow & { sourceIndex: number }> =
    [];

  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.eventDate) || (row.eventAt !== undefined && !Number.isFinite(Date.parse(row.eventAt)))) {
      blockers.push({ reason: "invalid_event_date", sourceIndex });
      return;
    }
    if (!Number.isInteger(row.sequence) || row.sequence < 0) {
      blockers.push({ reason: "invalid_event_sequence", sourceIndex });
      return;
    }
    if (row.direction !== "inflow" && row.direction !== "outflow") {
      blockers.push({ reason: "invalid_event_direction", sourceIndex });
      return;
    }
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      blockers.push({ reason: "invalid_event_amount", sourceIndex });
      return;
    }
    if (!isAmountProvenance(row.amountProvenance)) {
      blockers.push({ reason: "invalid_amount_provenance", sourceIndex });
      return;
    }
    normalized.push({ ...row, sourceIndex });
  });

  return normalized.sort(
    (left, right) =>
      left.eventDate.localeCompare(right.eventDate) ||
      left.sequence - right.sequence ||
      left.sourceIndex - right.sourceIndex,
  );
}

function isAmountProvenance(
  value: string,
): value is InvestmentLabAmountProvenance | "dated_reporting_money" {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx" ||
    value === "dated_reporting_money"
  );
}

function blockedSchedule(blockers: InvestmentLabScheduleBlocker[]) {
  return {
    status: "blocked",
    policy: INVESTMENT_LAB_EXECUTION_POLICY.version,
    scheduledFlows: [],
    pendingFlows: [],
    blockers,
    pendingFlowCount: 0,
    sameDayFlowCount: 0,
  } as const;
}
