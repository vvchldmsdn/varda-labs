import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";
import type {
  SimulationPeriodCandidate,
  SimulationPeriodCandidateInput,
  SimulationPeriodIssue,
  SimulationPeriodIssueReason,
  SimulationPeriodNormalizedFxRows,
  SimulationPeriodNormalizedPriceRows,
  SimulationPeriodObservation,
} from "./simulation-period-request-types.ts";
import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";

export function normalizeSimulationPeriodCandidates(
  rows: readonly SimulationPeriodCandidateInput[],
) {
  const candidates: SimulationPeriodCandidate[] = [];
  const issues: SimulationPeriodIssue[] = [];
  const counts = new Map<string, number>();

  if (rows.length === 0) {
    addIssue(issues, "blocked", "empty_candidate_universe");
  }

  for (const row of rows) {
    const market = normalizeToken(row.market, "lower");
    const currency = normalizeToken(row.currency, "upper");
    const ticker = normalizeToken(row.ticker, "upper");
    if (!market || !ticker || !currency) {
      addIssue(issues, "blocked", "invalid_candidate_identity");
      continue;
    }
    if (currency !== "KRW" && currency !== "USD") {
      addIssue(issues, "blocked", "unsupported_candidate_currency");
      continue;
    }
    const instrumentKey = simulationPeriodInstrumentKey(
      market,
      currency,
      ticker,
    );
    counts.set(instrumentKey, (counts.get(instrumentKey) ?? 0) + 1);
    candidates.push({
      instrumentKey,
      displayName: normalizeText(row.displayName),
      market,
      currency,
      ticker,
    });
  }

  for (const [instrumentKey, count] of counts) {
    if (count > 1) {
      addIssue(issues, "blocked", "duplicate_candidate", instrumentKey);
    }
  }

  return Object.freeze({
    candidates: Object.freeze(
      candidates
        .sort((left, right) =>
          left.instrumentKey.localeCompare(right.instrumentKey),
        )
        .map((row) => Object.freeze(row)),
    ),
    issues: sortSimulationPeriodIssues(issues),
  });
}

export function normalizeSimulationPeriodPriceRows({
  rows,
  candidates,
  endServiceDate,
}: {
  rows: readonly SimulationReturnMatrixPriceInput[];
  candidates: readonly SimulationPeriodCandidate[];
  endServiceDate: string;
}): SimulationPeriodNormalizedPriceRows {
  const candidateKeys = new Set(candidates.map((row) => row.instrumentKey));
  const issues: SimulationPeriodIssue[] = [];
  const groups = new Map<
    string,
    Array<{
      instrumentKey: string;
      sourceDate: string;
      serviceDate: string;
      valid: boolean;
    }>
  >();
  let ignoredExternalRowCount = 0;
  let ignoredFutureRowCount = 0;

  for (const sourceRow of rows) {
    const row = sourceRow as SimulationReturnMatrixPriceInput &
      Record<string, unknown>;
    const market = normalizeToken(row.market, "lower");
    const currency = normalizeToken(row.currency, "upper");
    const ticker = normalizeToken(row.ticker, "upper");
    const instrumentKey =
      market && (currency === "KRW" || currency === "USD") && ticker
        ? simulationPeriodInstrumentKey(market, currency, ticker)
        : null;
    if (!instrumentKey || !candidateKeys.has(instrumentKey)) {
      ignoredExternalRowCount += 1;
      continue;
    }
    if (!isRiskDate(row.priceDate)) {
      addIssue(
        issues,
        "blocked",
        "invalid_price_date",
        instrumentKey,
      );
      continue;
    }
    const serviceDate = mapRiskEvidenceDateToServiceDate(row.priceDate);
    if (serviceDate > endServiceDate) {
      ignoredFutureRowCount += 1;
      continue;
    }

    let valid = true;
    if (
      Object.prototype.hasOwnProperty.call(row, "closePrice") ||
      Object.prototype.hasOwnProperty.call(row, "rawClosePrice")
    ) {
      addIssue(
        issues,
        "blocked",
        "raw_close_field_forbidden",
        instrumentKey,
        [row.priceDate],
      );
      valid = false;
    }
    if (positiveNumber(row.adjustedClosePrice) === null) {
      addIssue(
        issues,
        "blocked",
        "invalid_adjusted_close",
        instrumentKey,
        [row.priceDate],
      );
      valid = false;
    }
    const groupKey = `${instrumentKey}|${row.priceDate}`;
    const group = groups.get(groupKey) ?? [];
    group.push({ instrumentKey, sourceDate: row.priceDate, serviceDate, valid });
    groups.set(groupKey, group);
  }

  const observationsByInstrument = new Map<
    string,
    SimulationPeriodObservation[]
  >();
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length > 1) {
      addIssue(
        issues,
        "blocked",
        "duplicate_price_date",
        first.instrumentKey,
        [first.sourceDate],
      );
      continue;
    }
    if (!first.valid) continue;
    const observations =
      observationsByInstrument.get(first.instrumentKey) ?? [];
    observations.push({
      sourceDate: first.sourceDate,
      serviceDate: first.serviceDate,
    });
    observationsByInstrument.set(first.instrumentKey, observations);
  }
  for (const observations of observationsByInstrument.values()) {
    observations.sort((left, right) =>
      left.serviceDate.localeCompare(right.serviceDate),
    );
  }
  const allObservations = [...observationsByInstrument.values()].flat();

  return Object.freeze({
    observationsByInstrument,
    axisDates: uniqueSortedDates(
      allObservations.map((row) => row.serviceDate),
    ),
    acceptedObservationCount: allObservations.length,
    ignoredExternalRowCount,
    ignoredFutureRowCount,
    issues: sortSimulationPeriodIssues(issues),
  });
}

export function normalizeSimulationPeriodFxRows({
  rows,
  required,
  endServiceDate,
}: {
  rows: readonly SimulationReturnMatrixFxInput[];
  required: boolean;
  endServiceDate: string;
}): SimulationPeriodNormalizedFxRows {
  if (!required) {
    return Object.freeze({
      observations: Object.freeze([]),
      axisDates: Object.freeze([]),
      acceptedObservationCount: 0,
      ignoredFutureRowCount: 0,
      ignoredNotRequiredRowCount: rows.length,
      issues: Object.freeze([]),
    });
  }

  const issues: SimulationPeriodIssue[] = [];
  const groups = new Map<
    string,
    Array<{
      sourceDate: string;
      serviceDate: string;
      valid: boolean;
    }>
  >();
  let ignoredFutureRowCount = 0;

  for (const row of rows) {
    if (!isRiskDate(row.rateDate)) {
      addIssue(issues, "blocked", "invalid_fx_date");
      continue;
    }
    const serviceDate = mapRiskEvidenceDateToServiceDate(row.rateDate);
    if (serviceDate > endServiceDate) {
      ignoredFutureRowCount += 1;
      continue;
    }

    let valid = true;
    if (String(row.status ?? "").trim().toLowerCase() !== "ok") {
      addIssue(issues, "blocked", "invalid_fx_status", null, [row.rateDate]);
      valid = false;
    }
    if (positiveNumber(row.usdKrw) === null) {
      addIssue(issues, "blocked", "invalid_fx_rate", null, [row.rateDate]);
      valid = false;
    }
    const group = groups.get(row.rateDate) ?? [];
    group.push({ sourceDate: row.rateDate, serviceDate, valid });
    groups.set(row.rateDate, group);
  }

  const observations: SimulationPeriodObservation[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length > 1) {
      addIssue(
        issues,
        "blocked",
        "duplicate_fx_date",
        null,
        [first.sourceDate],
      );
      continue;
    }
    if (!first.valid) continue;
    observations.push({
      sourceDate: first.sourceDate,
      serviceDate: first.serviceDate,
    });
  }
  observations.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );

  return Object.freeze({
    observations: Object.freeze(observations.map((row) => Object.freeze(row))),
    axisDates: uniqueSortedDates(observations.map((row) => row.serviceDate)),
    acceptedObservationCount: observations.length,
    ignoredFutureRowCount,
    ignoredNotRequiredRowCount: 0,
    issues: sortSimulationPeriodIssues(issues),
  });
}

export function addSimulationPeriodIssue(
  issues: SimulationPeriodIssue[],
  severity: SimulationPeriodIssue["severity"],
  reason: SimulationPeriodIssueReason,
  instrumentKey: string | null = null,
  dates: readonly string[] = [],
) {
  addIssue(issues, severity, reason, instrumentKey, dates);
}

export function sortSimulationPeriodIssues(
  issues: readonly SimulationPeriodIssue[],
) {
  const unique = new Map(
    issues.map((row) => [JSON.stringify(row), row] as const),
  );
  return Object.freeze(
    [...unique.values()]
      .sort(
        (left, right) =>
          left.severity.localeCompare(right.severity) ||
          left.reason.localeCompare(right.reason) ||
          String(left.instrumentKey).localeCompare(String(right.instrumentKey)) ||
          left.dates.join(",").localeCompare(right.dates.join(",")),
      )
      .map((row) => Object.freeze(row)),
  );
}

export function uniqueSortedDates(values: readonly string[]) {
  return Object.freeze([...new Set(values)].sort());
}

function addIssue(
  issues: SimulationPeriodIssue[],
  severity: SimulationPeriodIssue["severity"],
  reason: SimulationPeriodIssueReason,
  instrumentKey: string | null = null,
  dates: readonly string[] = [],
) {
  issues.push({
    severity,
    reason,
    instrumentKey,
    dates: Object.freeze([...new Set(dates)].sort()),
  });
}

function simulationPeriodInstrumentKey(
  market: string,
  currency: "KRW" | "USD",
  ticker: string,
) {
  return `${market}|${currency}|${ticker}`;
}

function normalizeToken(
  value: unknown,
  casing: "lower" | "upper",
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return casing === "lower"
    ? normalized.toLowerCase()
    : normalized.toUpperCase();
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function positiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
