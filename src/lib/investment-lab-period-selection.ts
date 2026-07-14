import { isRiskDate } from "./portfolio-risk-calendar.ts";
import type { InvestmentLabCounterfactualReadInput } from "./investment-lab-counterfactual-read-model.ts";

const EVIDENCE_MARGIN_DAYS = 7;

export type InvestmentLabPeriodRequest = Readonly<{
  startServiceDate?: string | readonly string[];
  endServiceDate?: string | readonly string[];
}>;

export type InvestmentLabPeriodSelectionReason =
  | "ambiguous_query"
  | "both_dates_required"
  | "invalid_date"
  | "invalid_order"
  | "source_unavailable"
  | "start_not_observed"
  | "end_not_observed"
  | "range_evidence_incomplete";

export type InvestmentLabPeriodSelection = Readonly<{
  status: "full" | "selected" | "invalid" | "unavailable";
  requestedStartServiceDate: string | null;
  requestedEndServiceDate: string | null;
  selectedStartServiceDate: string | null;
  selectedEndServiceDate: string | null;
  availableStartServiceDate: string | null;
  availableEndServiceDate: string | null;
  reason: InvestmentLabPeriodSelectionReason | null;
}>;

export function resolveInvestmentLabPeriodSelection(input: {
  request?: InvestmentLabPeriodRequest;
  availableServiceDates: readonly string[];
}): InvestmentLabPeriodSelection {
  const start = normalizeRequestValue(input.request?.startServiceDate);
  const end = normalizeRequestValue(input.request?.endServiceDate);
  const availableServiceDates = uniqueSortedRiskDates(
    input.availableServiceDates,
  );
  const availableStartServiceDate = availableServiceDates[0] ?? null;
  const availableEndServiceDate = availableServiceDates.at(-1) ?? null;
  const base = {
    requestedStartServiceDate: start.value,
    requestedEndServiceDate: end.value,
    selectedStartServiceDate: null,
    selectedEndServiceDate: null,
    availableStartServiceDate,
    availableEndServiceDate,
  } as const;

  if (!input.request) {
    return Object.freeze({
      ...base,
      status: "full" as const,
      reason: null,
    });
  }
  if (start.ambiguous || end.ambiguous) {
    return invalid(base, "ambiguous_query");
  }
  if (!start.value || !end.value) {
    return invalid(base, "both_dates_required");
  }
  if (!isRiskDate(start.value) || !isRiskDate(end.value)) {
    return invalid(base, "invalid_date");
  }
  if (start.value >= end.value) {
    return invalid(base, "invalid_order");
  }
  if (!availableStartServiceDate || !availableEndServiceDate) {
    return unavailable(base, "source_unavailable");
  }

  const available = new Set(availableServiceDates);
  if (!available.has(start.value)) {
    return invalid(base, "start_not_observed");
  }
  if (!available.has(end.value)) {
    return invalid(base, "end_not_observed");
  }

  return Object.freeze({
    ...base,
    status: "selected" as const,
    selectedStartServiceDate: start.value,
    selectedEndServiceDate: end.value,
    reason: null,
  });
}

export function sliceInvestmentLabCounterfactualInput(
  input: InvestmentLabCounterfactualReadInput,
  selection: InvestmentLabPeriodSelection,
): InvestmentLabCounterfactualReadInput {
  if (
    selection.status !== "selected" ||
    !selection.selectedStartServiceDate ||
    !selection.selectedEndServiceDate
  ) {
    return input;
  }

  const startServiceDate = selection.selectedStartServiceDate;
  const endServiceDate = selection.selectedEndServiceDate;
  const evidenceStartDate = shiftRiskDate(
    startServiceDate,
    -EVIDENCE_MARGIN_DAYS,
  );
  const evidenceEndDate = shiftRiskDate(
    endServiceDate,
    EVIDENCE_MARGIN_DAYS,
  );

  return Object.freeze({
    snapshotRows: Object.freeze(
      input.snapshotRows.filter(
        (row) =>
          row.snapshotDate >= startServiceDate &&
          row.snapshotDate <= endServiceDate,
      ),
    ),
    eventRows: Object.freeze(
      input.eventRows.filter(
        (row) =>
          row.eventDate > startServiceDate &&
          row.eventDate <= endServiceDate,
      ),
    ),
    closeRows: filterEvidenceWindow(
      input.closeRows,
      (row) => row.priceDate,
      evidenceStartDate,
      evidenceEndDate,
    ),
    vooCloseRows: filterEvidenceWindow(
      input.vooCloseRows,
      (row) => row.priceDate,
      evidenceStartDate,
      evidenceEndDate,
    ),
    fxRows: filterEvidenceWindow(
      input.fxRows,
      (row) => row.rateDate,
      evidenceStartDate,
      evidenceEndDate,
    ),
  });
}

export function markInvestmentLabPeriodUnavailable(
  selection: InvestmentLabPeriodSelection,
): InvestmentLabPeriodSelection {
  return Object.freeze({
    ...selection,
    status: "unavailable" as const,
    reason: "range_evidence_incomplete" as const,
  });
}

function normalizeRequestValue(
  value: string | readonly string[] | undefined,
) {
  if (Array.isArray(value)) {
    return { value: null, ambiguous: true } as const;
  }
  if (typeof value !== "string") {
    return { value: null, ambiguous: false } as const;
  }
  return { value: value || null, ambiguous: false } as const;
}

function uniqueSortedRiskDates(values: readonly string[]) {
  return [...new Set(values.filter(isRiskDate))].sort();
}

function filterEvidenceWindow<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
  startDate: string,
  endDate: string,
) {
  return Object.freeze(
    rows.filter((row) => {
      const date = dateOf(row);
      return date >= startDate && date <= endDate;
    }),
  );
}

function shiftRiskDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function invalid(
  base: Omit<InvestmentLabPeriodSelection, "status" | "reason">,
  reason: InvestmentLabPeriodSelectionReason,
): InvestmentLabPeriodSelection {
  return Object.freeze({ ...base, status: "invalid" as const, reason });
}

function unavailable(
  base: Omit<InvestmentLabPeriodSelection, "status" | "reason">,
  reason: InvestmentLabPeriodSelectionReason,
): InvestmentLabPeriodSelection {
  return Object.freeze({ ...base, status: "unavailable" as const, reason });
}
