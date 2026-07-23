import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "../portfolio-risk-calendar.ts";

export const PROVIDER_FX_WINDOW_EVIDENCE_POLICY = Object.freeze({
  version: "provider_fx_window_evidence_v1",
  sourcePair: "USD_KRW",
  requiredRowStatus: "ok",
  serviceDateMapping: "stored_fx_date_plus_one_kst_service_date",
  duplicateScope: "requested_source_date_window_only",
  equivalentDuplicatePolicy: "unresolved_no_silent_canonicalization",
} as const);

export type ProviderFxWindowRow = Readonly<{
  rateDate: string;
  usdKrw: number | string | null;
  status: string;
  source?: string | null;
}>;

export type ProviderFxWindowEvidenceStatus =
  | "not_applicable"
  | "complete"
  | "incomplete"
  | "equivalent_duplicate_unresolved"
  | "conflicting_duplicate"
  | "blocked_invalid_input";

export type ProviderFxWindowEvidence = Readonly<{
  policy: typeof PROVIDER_FX_WINDOW_EVIDENCE_POLICY;
  status: ProviderFxWindowEvidenceStatus;
  sourceDateRange: Readonly<{ from: string; to: string }> | null;
  requiredServiceDateCount: number;
  coveredServiceDateCount: number;
  missingServiceDates: readonly string[];
  staleServiceDates: readonly string[];
  duplicateDates: readonly Readonly<{
    rateDate: string;
    classification:
      | "equivalent_duplicate_unresolved"
      | "conflicting_duplicate";
    rowCount: number;
    distinctValueCount: number;
    sources: readonly string[];
  }>[];
  invalidRowDates: readonly string[];
  scopedRowCount: number;
  usableRowCount: number;
  ignoredOutOfWindowRowCount: number;
  maxCarryDays: number;
  issues: readonly string[];
}>;

export function evaluateProviderFxWindowEvidence(input: {
  currency: string;
  sourceDateRange: Readonly<{ from: string; to: string }>;
  requiredServiceDates: readonly string[];
  maxCarryDays: number;
  rows: readonly ProviderFxWindowRow[];
}): ProviderFxWindowEvidence {
  const currency = String(input?.currency ?? "").trim().toUpperCase();
  const sourceDateRange = normalizeRange(input?.sourceDateRange);
  const requiredServiceDates = normalizeServiceDates(
    input?.requiredServiceDates,
  );
  const maxCarryDays = input?.maxCarryDays;

  if (
    (currency !== "KRW" && currency !== "USD") ||
    !sourceDateRange ||
    requiredServiceDates === null ||
    !Number.isSafeInteger(maxCarryDays) ||
    maxCarryDays < 0 ||
    maxCarryDays > 31 ||
    !Array.isArray(input?.rows)
  ) {
    return blockedResult(maxCarryDays);
  }

  if (currency === "KRW") {
    return freezeResult({
      status: "not_applicable",
      sourceDateRange,
      requiredServiceDateCount: requiredServiceDates.length,
      coveredServiceDateCount: requiredServiceDates.length,
      missingServiceDates: [],
      staleServiceDates: [],
      duplicateDates: [],
      invalidRowDates: [],
      scopedRowCount: 0,
      usableRowCount: 0,
      ignoredOutOfWindowRowCount: input.rows.length,
      maxCarryDays,
      issues: [],
    });
  }

  const invalidRowDates = new Set<string>();
  const scopedRows: NormalizedFxRow[] = [];
  let ignoredOutOfWindowRowCount = 0;

  for (const row of input.rows) {
    const rateDate = String(row?.rateDate ?? "").trim();
    if (!isRiskDate(rateDate)) {
      invalidRowDates.add(rateDate || "invalid_date");
      continue;
    }
    if (
      rateDate < sourceDateRange.from ||
      rateDate > sourceDateRange.to
    ) {
      ignoredOutOfWindowRowCount += 1;
      continue;
    }

    const usdKrw = Number(row.usdKrw);
    const status = String(row.status ?? "").trim().toLowerCase();
    const source = String(row.source ?? "").trim();
    const valid =
      Number.isFinite(usdKrw) &&
      usdKrw > 0 &&
      status === PROVIDER_FX_WINDOW_EVIDENCE_POLICY.requiredRowStatus;
    if (!valid) invalidRowDates.add(rateDate);
    scopedRows.push({ rateDate, usdKrw, status, source, valid });
  }

  const rowsByDate = new Map<string, NormalizedFxRow[]>();
  for (const row of scopedRows) {
    const group = rowsByDate.get(row.rateDate) ?? [];
    group.push(row);
    rowsByDate.set(row.rateDate, group);
  }

  const duplicateDates = [...rowsByDate.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([rateDate, rows]) => {
      const values = new Set(
        rows.filter((row) => row.valid).map((row) => row.usdKrw),
      );
      const classification =
        rows.every((row) => row.valid) && values.size === 1
          ? ("equivalent_duplicate_unresolved" as const)
          : ("conflicting_duplicate" as const);
      return Object.freeze({
        rateDate,
        classification,
        rowCount: rows.length,
        distinctValueCount: values.size,
        sources: Object.freeze(
          [...new Set(rows.map((row) => row.source).filter(Boolean))].sort(),
        ),
      });
    })
    .sort((left, right) => left.rateDate.localeCompare(right.rateDate));

  const duplicateDateSet = new Set(
    duplicateDates.map((row) => row.rateDate),
  );
  const observations = scopedRows
    .filter((row) => row.valid && !duplicateDateSet.has(row.rateDate))
    .map((row) => ({
      sourceDate: row.rateDate,
      serviceDate: mapRiskEvidenceDateToServiceDate(row.rateDate),
    }))
    .sort((left, right) =>
      left.serviceDate.localeCompare(right.serviceDate),
    );
  const missingServiceDates: string[] = [];
  const staleServiceDates: string[] = [];
  let coveredServiceDateCount = 0;

  for (const serviceDate of requiredServiceDates) {
    const selected = latestObservationOnOrBefore(
      observations,
      serviceDate,
    );
    if (!selected) {
      missingServiceDates.push(serviceDate);
      continue;
    }
    const carryDays = riskCalendarDayDistance(
      selected.serviceDate,
      serviceDate,
    );
    if (carryDays > maxCarryDays) {
      staleServiceDates.push(serviceDate);
      continue;
    }
    coveredServiceDateCount += 1;
  }

  const issues: string[] = [];
  if (invalidRowDates.size > 0) issues.push("invalid_fx_rows");
  if (
    duplicateDates.some(
      (row) => row.classification === "conflicting_duplicate",
    )
  ) {
    issues.push("conflicting_duplicate");
  } else if (duplicateDates.length > 0) {
    issues.push("equivalent_duplicate_unresolved");
  }
  if (missingServiceDates.length > 0) issues.push("missing_fx");
  if (staleServiceDates.length > 0) issues.push("stale_fx");

  const status =
    invalidRowDates.size > 0
      ? "blocked_invalid_input"
      : issues.includes("conflicting_duplicate")
        ? "conflicting_duplicate"
        : issues.includes("equivalent_duplicate_unresolved")
          ? "equivalent_duplicate_unresolved"
          : missingServiceDates.length > 0 ||
              staleServiceDates.length > 0 ||
              requiredServiceDates.length === 0
            ? "incomplete"
            : "complete";

  if (requiredServiceDates.length === 0) issues.push("empty_required_window");

  return freezeResult({
    status,
    sourceDateRange,
    requiredServiceDateCount: requiredServiceDates.length,
    coveredServiceDateCount,
    missingServiceDates,
    staleServiceDates,
    duplicateDates,
    invalidRowDates: [...invalidRowDates].sort(),
    scopedRowCount: scopedRows.length,
    usableRowCount: observations.length,
    ignoredOutOfWindowRowCount,
    maxCarryDays,
    issues,
  });
}

type NormalizedFxRow = {
  rateDate: string;
  usdKrw: number;
  status: string;
  source: string;
  valid: boolean;
};

function normalizeRange(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const range = value as { from?: unknown; to?: unknown };
  const from = String(range.from ?? "").trim();
  const to = String(range.to ?? "").trim();
  return isRiskDate(from) && isRiskDate(to) && from <= to
    ? Object.freeze({ from, to })
    : null;
}

function normalizeServiceDates(value: unknown) {
  if (!Array.isArray(value)) return null;
  const dates = value.map((date) => String(date ?? "").trim());
  if (
    !dates.every(isRiskDate) ||
    dates.some((date, index) => index > 0 && dates[index - 1] >= date)
  ) {
    return null;
  }
  return Object.freeze(dates);
}

function latestObservationOnOrBefore(
  observations: readonly Readonly<{
    sourceDate: string;
    serviceDate: string;
  }>[],
  serviceDate: string,
) {
  let low = 0;
  let high = observations.length - 1;
  let selected: (typeof observations)[number] | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = observations[middle];
    if (candidate.serviceDate <= serviceDate) {
      selected = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected;
}

function blockedResult(maxCarryDays: unknown) {
  return freezeResult({
    status: "blocked_invalid_input",
    sourceDateRange: null,
    requiredServiceDateCount: 0,
    coveredServiceDateCount: 0,
    missingServiceDates: [],
    staleServiceDates: [],
    duplicateDates: [],
    invalidRowDates: [],
    scopedRowCount: 0,
    usableRowCount: 0,
    ignoredOutOfWindowRowCount: 0,
    maxCarryDays:
      Number.isSafeInteger(maxCarryDays) && Number(maxCarryDays) >= 0
        ? Number(maxCarryDays)
        : 0,
    issues: ["invalid_input"],
  });
}

function freezeResult(
  input: Omit<ProviderFxWindowEvidence, "policy">,
): ProviderFxWindowEvidence {
  return Object.freeze({
    policy: PROVIDER_FX_WINDOW_EVIDENCE_POLICY,
    ...input,
    missingServiceDates: Object.freeze([...input.missingServiceDates]),
    staleServiceDates: Object.freeze([...input.staleServiceDates]),
    duplicateDates: Object.freeze([...input.duplicateDates]),
    invalidRowDates: Object.freeze([...input.invalidRowDates]),
    issues: Object.freeze([...input.issues]),
  });
}
