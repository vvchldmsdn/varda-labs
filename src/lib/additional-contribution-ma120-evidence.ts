export const ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY = Object.freeze({
  version: "additional_contribution_ma120_evidence_phase2a_v1",
  mode: "evidence_only",
  windowObservationCount: 120,
  historyPriceField: "adjusted_close_price",
  historyBoundary: "price_date_lte_as_of_price_date",
  observationBasis: "distinct_observed_price_dates_without_calendar_carry",
  comparisonPriceBasis: "adjusted_close_compatible",
  allocationEffect: "none",
  baselineBehavior: "pass_through_same_reference",
  rawCloseFallback: "forbidden",
  legacyIndicatorRead: "forbidden",
} as const);

export type AdditionalContributionMa120EvidenceStatus =
  | "above_ma"
  | "at_ma"
  | "below_ma"
  | "insufficient_history"
  | "invalid_history";

export type AdditionalContributionMa120EvidenceBlocker =
  | "invalid_instrument_key"
  | "invalid_as_of_price_date"
  | "invalid_comparison_price"
  | "incompatible_comparison_price_basis"
  | "invalid_price_date"
  | "invalid_adjusted_close"
  | "raw_close_field_forbidden"
  | "duplicate_price_date"
  | "fewer_than_120_observations"
  | "invalid_ma_calculation";

export type AdditionalContributionMa120Observation = Readonly<{
  priceDate: string;
  adjustedClosePrice: number;
  closePrice?: never;
  rawClosePrice?: never;
}>;

export type AdditionalContributionMa120Evidence = Readonly<{
  status: AdditionalContributionMa120EvidenceStatus;
  policy: typeof ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY;
  instrumentKey: string | null;
  asOfPriceDate: string | null;
  comparisonPrice: number | null;
  comparisonPriceBasis: "adjusted_close_compatible" | null;
  availableObservationCount: number;
  usedObservationCount: number;
  ignoredFutureObservationCount: number;
  oldestWindowPriceDate: string | null;
  latestWindowPriceDate: string | null;
  ma120: number | null;
  distanceFromMaPct: number | null;
  blockers: readonly AdditionalContributionMa120EvidenceBlocker[];
}>;

type ValidObservation = Readonly<{
  priceDate: string;
  adjustedClosePrice: number;
}>;

export function evaluateAdditionalContributionMa120Evidence(input: {
  instrumentKey: string;
  asOfPriceDate: string;
  comparisonPrice: number;
  comparisonPriceBasis: string;
  observations: readonly AdditionalContributionMa120Observation[];
}): AdditionalContributionMa120Evidence {
  const blockers = new Set<AdditionalContributionMa120EvidenceBlocker>();
  const instrumentKey = normalizeInstrumentKey(input.instrumentKey);
  const asOfPriceDate = normalizePriceDate(input.asOfPriceDate);
  const comparisonPrice = normalizePositiveNumber(input.comparisonPrice);
  const comparisonPriceBasis =
    input.comparisonPriceBasis ===
    ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.comparisonPriceBasis
      ? input.comparisonPriceBasis
      : null;

  if (!instrumentKey) blockers.add("invalid_instrument_key");
  if (!asOfPriceDate) blockers.add("invalid_as_of_price_date");
  if (comparisonPrice === null) blockers.add("invalid_comparison_price");
  if (!comparisonPriceBasis) {
    blockers.add("incompatible_comparison_price_basis");
  }

  if (
    blockers.size > 0 ||
    !instrumentKey ||
    !asOfPriceDate ||
    comparisonPrice === null ||
    !comparisonPriceBasis
  ) {
    return evidenceResult({
      status: "invalid_history",
      instrumentKey,
      asOfPriceDate,
      comparisonPrice,
      comparisonPriceBasis,
      blockers,
    });
  }

  const observations = Array.isArray(input.observations)
    ? input.observations
    : [];
  const validObservations: ValidObservation[] = [];
  let ignoredFutureObservationCount = 0;

  for (const sourceRow of observations) {
    const row = sourceRow as AdditionalContributionMa120Observation &
      Record<string, unknown>;
    const priceDate = normalizePriceDate(row?.priceDate);
    if (!priceDate) {
      blockers.add("invalid_price_date");
      continue;
    }
    if (priceDate.localeCompare(asOfPriceDate) > 0) {
      ignoredFutureObservationCount += 1;
      continue;
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "closePrice") ||
      Object.prototype.hasOwnProperty.call(row, "rawClosePrice")
    ) {
      blockers.add("raw_close_field_forbidden");
    }
    const adjustedClosePrice = normalizePositiveNumber(
      row?.adjustedClosePrice,
    );
    if (adjustedClosePrice === null) {
      blockers.add("invalid_adjusted_close");
      continue;
    }
    validObservations.push(
      Object.freeze({ priceDate, adjustedClosePrice }),
    );
  }

  const dateCounts = new Map<string, number>();
  for (const row of validObservations) {
    dateCounts.set(row.priceDate, (dateCounts.get(row.priceDate) ?? 0) + 1);
  }
  if ([...dateCounts.values()].some((count) => count > 1)) {
    blockers.add("duplicate_price_date");
  }

  if (blockers.size > 0) {
    return evidenceResult({
      status: "invalid_history",
      instrumentKey,
      asOfPriceDate,
      comparisonPrice,
      comparisonPriceBasis,
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  validObservations.sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
  if (
    validObservations.length <
    ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.windowObservationCount
  ) {
    blockers.add("fewer_than_120_observations");
    return evidenceResult({
      status: "insufficient_history",
      instrumentKey,
      asOfPriceDate,
      comparisonPrice,
      comparisonPriceBasis,
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  const window = validObservations.slice(
    -ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.windowObservationCount,
  );
  const ma120 = incrementalMean(window);
  const distanceFromMaPct = (comparisonPrice / ma120 - 1) * 100;
  if (
    !Number.isFinite(ma120) ||
    ma120 <= 0 ||
    !Number.isFinite(distanceFromMaPct)
  ) {
    blockers.add("invalid_ma_calculation");
    return evidenceResult({
      status: "invalid_history",
      instrumentKey,
      asOfPriceDate,
      comparisonPrice,
      comparisonPriceBasis,
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  return evidenceResult({
    status: classifyComparison(comparisonPrice, ma120),
    instrumentKey,
    asOfPriceDate,
    comparisonPrice,
    comparisonPriceBasis,
    availableObservationCount: validObservations.length,
    usedObservationCount: window.length,
    ignoredFutureObservationCount,
    oldestWindowPriceDate: window[0]?.priceDate ?? null,
    latestWindowPriceDate: window.at(-1)?.priceDate ?? null,
    ma120,
    distanceFromMaPct,
    blockers,
  });
}

export function pairBaselineWithMa120Evidence<TBaseline>({
  baseline,
  evidence,
}: {
  baseline: TBaseline;
  evidence: readonly AdditionalContributionMa120Evidence[];
}) {
  return Object.freeze({
    mode: ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.mode,
    allocationEffect:
      ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.allocationEffect,
    baseline,
    evidence: Object.freeze([...evidence]),
  } as const);
}

function evidenceResult({
  status,
  instrumentKey,
  asOfPriceDate,
  comparisonPrice,
  comparisonPriceBasis,
  availableObservationCount = 0,
  usedObservationCount = 0,
  ignoredFutureObservationCount = 0,
  oldestWindowPriceDate = null,
  latestWindowPriceDate = null,
  ma120 = null,
  distanceFromMaPct = null,
  blockers,
}: {
  status: AdditionalContributionMa120EvidenceStatus;
  instrumentKey: string | null;
  asOfPriceDate: string | null;
  comparisonPrice: number | null;
  comparisonPriceBasis: "adjusted_close_compatible" | null;
  availableObservationCount?: number;
  usedObservationCount?: number;
  ignoredFutureObservationCount?: number;
  oldestWindowPriceDate?: string | null;
  latestWindowPriceDate?: string | null;
  ma120?: number | null;
  distanceFromMaPct?: number | null;
  blockers: ReadonlySet<AdditionalContributionMa120EvidenceBlocker>;
}): AdditionalContributionMa120Evidence {
  return Object.freeze({
    status,
    policy: ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY,
    instrumentKey,
    asOfPriceDate,
    comparisonPrice,
    comparisonPriceBasis,
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

function classifyComparison(
  comparisonPrice: number,
  ma120: number,
): "above_ma" | "at_ma" | "below_ma" {
  const difference = comparisonPrice - ma120;
  const tolerance = Math.max(1, Math.abs(ma120)) * Number.EPSILON * 16;
  if (difference > tolerance) return "above_ma";
  if (difference < -tolerance) return "below_ma";
  return "at_ma";
}

function incrementalMean(rows: readonly ValidObservation[]) {
  let mean = 0;
  for (let index = 0; index < rows.length; index += 1) {
    mean += (rows[index].adjustedClosePrice - mean) / (index + 1);
  }
  return mean;
}

function normalizeInstrumentKey(value: string) {
  const normalized = String(value ?? "").trim();
  return normalized && /^[a-z0-9._-]+:[A-Z0-9._-]+:[A-Z0-9._-]+$/.test(normalized)
    ? normalized
    : null;
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizePriceDate(value: unknown) {
  const priceDate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) return null;
  const [year, month, day] = priceDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? priceDate
    : null;
}
