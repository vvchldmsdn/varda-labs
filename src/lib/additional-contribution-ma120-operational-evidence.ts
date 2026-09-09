import {
  evaluateMovingAverageWindow,
  normalizeMovingAverageInstrumentKey,
  normalizeMovingAveragePositiveNumber,
  normalizeMovingAveragePriceDate,
} from "./moving-average-window.ts";

export const ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY =
  Object.freeze({
    version: "additional_contribution_ma120_operational_evidence_v2",
    mode: "additional_contribution_preview_input",
    windowObservationCount: 120,
    allowedPriceBases: Object.freeze([
      "provider_adjusted_close",
      "private_kis_raw_close",
    ] as const),
    historyBoundary: "price_date_lte_as_of_price_date",
    maxComparisonPriceAgeHours: 168,
    maxHistoryAgeCalendarDays: 7,
    freshnessDateZone: "Asia/Seoul",
    comparisonTimestampAuthority: "price_as_of_without_fetch_time_fallback",
    staleOrFutureEvidence: "unavailable_without_target_reduction",
    observationBasis: "distinct_observed_price_dates_without_calendar_carry",
    allocationEffect: "bounded_overlay",
    recommendation: "allocation_preview_only",
  } as const);

export type AdditionalContributionMa120OperationalPriceBasis =
  (typeof ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY.allowedPriceBases)[number];

export type AdditionalContributionMa120OperationalEvidenceStatus =
  | "above_ma"
  | "at_ma"
  | "below_ma"
  | "insufficient_history"
  | "invalid_history";

export type AdditionalContributionMa120OperationalEvidenceBlocker =
  | "invalid_instrument_key"
  | "invalid_as_of_price_date"
  | "invalid_comparison_price"
  | "unsupported_price_basis"
  | "invalid_price_date"
  | "invalid_observation_price"
  | "duplicate_price_date"
  | "fewer_than_120_observations"
  | "invalid_ma_calculation"
  | "invalid_evaluation_time"
  | "future_as_of_price_date"
  | "comparison_price_time_missing"
  | "invalid_comparison_price_time"
  | "future_comparison_price"
  | "stale_comparison_price"
  | "stale_history";

export type AdditionalContributionMa120OperationalObservation = Readonly<{
  priceDate: string;
  price: number;
}>;

export type AdditionalContributionMa120OperationalEvidence = Readonly<{
  status: AdditionalContributionMa120OperationalEvidenceStatus;
  policy: typeof ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY;
  instrumentKey: string | null;
  asOfPriceDate: string | null;
  comparisonPrice: number | null;
  comparisonPriceAsOf: string | null;
  evaluatedAt: string | null;
  comparisonPriceAgeHours: number | null;
  historyAgeCalendarDays: number | null;
  priceBasis: AdditionalContributionMa120OperationalPriceBasis | null;
  availableObservationCount: number;
  usedObservationCount: number;
  ignoredFutureObservationCount: number;
  oldestWindowPriceDate: string | null;
  latestWindowPriceDate: string | null;
  ma120: number | null;
  distanceFromMaPct: number | null;
  blockers: readonly AdditionalContributionMa120OperationalEvidenceBlocker[];
}>;

export function evaluateAdditionalContributionMa120OperationalEvidence(input: {
  instrumentKey: string;
  asOfPriceDate: string;
  comparisonPrice: number;
  comparisonPriceAsOf: Date | string | null;
  evaluatedAt: Date | string;
  priceBasis: string;
  observations: readonly AdditionalContributionMa120OperationalObservation[];
}): AdditionalContributionMa120OperationalEvidence {
  const blockers =
    new Set<AdditionalContributionMa120OperationalEvidenceBlocker>();
  const instrumentKey = normalizeMovingAverageInstrumentKey(
    input.instrumentKey,
  );
  const asOfPriceDate = normalizeMovingAveragePriceDate(input.asOfPriceDate);
  const comparisonPrice = normalizeMovingAveragePositiveNumber(
    input.comparisonPrice,
  );
  const priceBasis = isOperationalPriceBasis(input.priceBasis)
    ? input.priceBasis
    : null;
  const evaluatedAt = normalizeTimestamp(input.evaluatedAt);
  const comparisonPriceAsOf = normalizeTimestamp(input.comparisonPriceAsOf);
  const comparisonPriceAgeHours = evaluatedAt && comparisonPriceAsOf
    ? (Date.parse(evaluatedAt) - Date.parse(comparisonPriceAsOf)) / 3_600_000
    : null;
  const evaluationPriceDate = evaluatedAt
    ? new Date(Date.parse(evaluatedAt) + 9 * 3_600_000).toISOString().slice(0, 10)
    : null;

  if (!instrumentKey) blockers.add("invalid_instrument_key");
  if (!asOfPriceDate) blockers.add("invalid_as_of_price_date");
  if (comparisonPrice === null) blockers.add("invalid_comparison_price");
  if (!priceBasis) blockers.add("unsupported_price_basis");
  if (
    blockers.size > 0 ||
    !instrumentKey ||
    !asOfPriceDate ||
    comparisonPrice === null ||
    !priceBasis
  ) {
    return result({
      status: "invalid_history",
      instrumentKey,
      asOfPriceDate,
      comparisonPrice,
      evaluatedAt,
      comparisonPriceAsOf,
      comparisonPriceAgeHours,
      priceBasis,
      blockers,
    });
  }

  const window = evaluateMovingAverageWindow({
    asOfPriceDate,
    comparisonPrice,
    observations: Array.isArray(input.observations)
      ? input.observations
      : [],
    windowObservationCount:
      ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY.windowObservationCount,
    initialBlockers: blockers,
    invalidPriceBlocker: "invalid_observation_price" as const,
  });
  const mappedBlockers = new Set(
    [...window.blockers].map(mapWindowBlocker),
  );
  if (!evaluatedAt) mappedBlockers.add("invalid_evaluation_time");
  if (input.comparisonPriceAsOf == null || input.comparisonPriceAsOf === "") {
    mappedBlockers.add("comparison_price_time_missing");
  } else if (!comparisonPriceAsOf) {
    mappedBlockers.add("invalid_comparison_price_time");
  }
  if (evaluationPriceDate && asOfPriceDate > evaluationPriceDate) {
    mappedBlockers.add("future_as_of_price_date");
  }
  if (comparisonPriceAgeHours !== null) {
    if (comparisonPriceAgeHours < 0) mappedBlockers.add("future_comparison_price");
    if (comparisonPriceAgeHours > ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY.maxComparisonPriceAgeHours) {
      mappedBlockers.add("stale_comparison_price");
    }
  }
  const historyAgeCalendarDays = evaluationPriceDate && window.latestWindowPriceDate
    ? (Date.parse(`${evaluationPriceDate}T00:00:00Z`) - Date.parse(`${window.latestWindowPriceDate}T00:00:00Z`)) / 86_400_000
    : null;
  if (historyAgeCalendarDays !== null && historyAgeCalendarDays > ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY.maxHistoryAgeCalendarDays) {
    mappedBlockers.add("stale_history");
  }
  const timingInvalid = mappedBlockers.size > window.blockers.size;

  return result({
    status: timingInvalid ? "invalid_history" : window.status,
    instrumentKey,
    asOfPriceDate,
    comparisonPrice,
    evaluatedAt,
    comparisonPriceAsOf,
    comparisonPriceAgeHours,
    historyAgeCalendarDays,
    priceBasis,
    availableObservationCount: window.availableObservationCount,
    usedObservationCount: window.usedObservationCount,
    ignoredFutureObservationCount: window.ignoredFutureObservationCount,
    oldestWindowPriceDate: window.oldestWindowPriceDate,
    latestWindowPriceDate: window.latestWindowPriceDate,
    ma120: timingInvalid ? null : window.movingAverage,
    distanceFromMaPct: timingInvalid ? null : window.distanceFromAveragePct,
    blockers: mappedBlockers,
  });
}

function result({
  status,
  instrumentKey,
  asOfPriceDate,
  comparisonPrice,
  evaluatedAt,
  comparisonPriceAsOf,
  comparisonPriceAgeHours,
  historyAgeCalendarDays = null,
  priceBasis,
  availableObservationCount = 0,
  usedObservationCount = 0,
  ignoredFutureObservationCount = 0,
  oldestWindowPriceDate = null,
  latestWindowPriceDate = null,
  ma120 = null,
  distanceFromMaPct = null,
  blockers,
}: {
  status: AdditionalContributionMa120OperationalEvidenceStatus;
  instrumentKey: string | null;
  asOfPriceDate: string | null;
  comparisonPrice: number | null;
  evaluatedAt: string | null;
  comparisonPriceAsOf: string | null;
  comparisonPriceAgeHours: number | null;
  historyAgeCalendarDays?: number | null;
  priceBasis: AdditionalContributionMa120OperationalPriceBasis | null;
  availableObservationCount?: number;
  usedObservationCount?: number;
  ignoredFutureObservationCount?: number;
  oldestWindowPriceDate?: string | null;
  latestWindowPriceDate?: string | null;
  ma120?: number | null;
  distanceFromMaPct?: number | null;
  blockers: ReadonlySet<AdditionalContributionMa120OperationalEvidenceBlocker>;
}): AdditionalContributionMa120OperationalEvidence {
  return Object.freeze({
    status,
    policy: ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY,
    instrumentKey,
    asOfPriceDate,
    comparisonPrice,
    evaluatedAt,
    comparisonPriceAsOf,
    comparisonPriceAgeHours,
    historyAgeCalendarDays,
    priceBasis,
    availableObservationCount,
    usedObservationCount,
    ignoredFutureObservationCount,
    oldestWindowPriceDate,
    latestWindowPriceDate,
    ma120,
    distanceFromMaPct,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function normalizeTimestamp(value: Date | string | null | undefined) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  // An observation needs an actual instant; a date-only or local time cannot
  // establish freshness and must not inherit the server's local timezone.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!normalizeMovingAveragePriceDate(value.slice(0, 10))) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function mapWindowBlocker(
  blocker:
    | AdditionalContributionMa120OperationalEvidenceBlocker
    | "fewer_than_required_observations"
    | "invalid_average_calculation",
): AdditionalContributionMa120OperationalEvidenceBlocker {
  if (blocker === "fewer_than_required_observations") {
    return "fewer_than_120_observations";
  }
  if (blocker === "invalid_average_calculation") {
    return "invalid_ma_calculation";
  }
  return blocker;
}

function isOperationalPriceBasis(
  value: string,
): value is AdditionalContributionMa120OperationalPriceBasis {
  return (
    value === "provider_adjusted_close" ||
    value === "private_kis_raw_close"
  );
}
