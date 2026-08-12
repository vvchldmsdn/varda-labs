import {
  evaluateMovingAverageWindow,
  normalizeMovingAverageInstrumentKey,
  normalizeMovingAveragePositiveNumber,
  normalizeMovingAveragePriceDate,
} from "./moving-average-window.ts";

export const ADDITIONAL_CONTRIBUTION_MA120_OPERATIONAL_EVIDENCE_POLICY =
  Object.freeze({
    version: "additional_contribution_ma120_operational_evidence_v1",
    mode: "evidence_only",
    windowObservationCount: 120,
    allowedPriceBases: Object.freeze([
      "provider_adjusted_close",
      "private_kis_raw_close",
    ] as const),
    historyBoundary: "price_date_lte_as_of_price_date",
    observationBasis: "distinct_observed_price_dates_without_calendar_carry",
    allocationEffect: "none",
    recommendation: "forbidden",
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
  | "invalid_ma_calculation";

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

  return result({
    status: window.status,
    instrumentKey,
    asOfPriceDate,
    comparisonPrice,
    priceBasis,
    availableObservationCount: window.availableObservationCount,
    usedObservationCount: window.usedObservationCount,
    ignoredFutureObservationCount: window.ignoredFutureObservationCount,
    oldestWindowPriceDate: window.oldestWindowPriceDate,
    latestWindowPriceDate: window.latestWindowPriceDate,
    ma120: window.movingAverage,
    distanceFromMaPct: window.distanceFromAveragePct,
    blockers: mappedBlockers,
  });
}

function result({
  status,
  instrumentKey,
  asOfPriceDate,
  comparisonPrice,
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
