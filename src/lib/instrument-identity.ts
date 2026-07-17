export type InstrumentSemanticIdentity = Readonly<{
  instrumentKind: string;
  venue: string;
  productKey: string;
  holdingUnit: string;
  quoteCurrency: string;
  quoteUnit: string;
}>;

export const KRX_GOLD_CLOSE_ONLY_CONTRACT = Object.freeze({
  version: "krx_gold_close_only_v1",
  verifiedMarketFacts: Object.freeze({
    instrumentKind: "commodity_spot",
    venue: "KRX_GOLD",
    purity: "99.99%",
    holdingUnit: "g",
    quoteCurrency: "KRW",
    quoteUnit: "KRW_PER_G",
    transactionUnitG: 1,
    productCandidates: Object.freeze([
      Object.freeze({ productKey: "gold_9999_1kg", withdrawalUnitG: 1_000 }),
      Object.freeze({ productKey: "gold_9999_100g", withdrawalUnitG: 100 }),
    ]),
  }),
  identityBinding: Object.freeze({
    status: "resolved",
    productKey: "gold_9999_1kg",
    holdingUnit: "g",
    authority: "broker_holding_statement_and_krx_product_definition",
    evidenceReviewedOn: "2026-07-16",
    sensitiveEvidenceStored: false,
  }),
  pricing: Object.freeze({
    mode: "official_close_only",
    source: "fsc_public_data_gold_daily",
    quoteKind: "official_close",
    liveQuoteEligible: false,
  }),
  sourceFeasibility: Object.freeze({
    status: "read_only_dry_run_ready",
    availableFrom: "actual_response_coverage_pending",
    access: "free_auto_approval_service_key_required",
    providerInstrumentBinding:
      "04020000_KRD040200002_gold_99_99_1kg",
    providerCloseFieldBinding: "basDt_clpr",
    multiUserDisplayRights: "unrestricted_public_data_portal_license",
    attributionRequired: false,
    actualResponseCoverage: "not_verified",
  }),
  datePolicy: Object.freeze({
    observationDate: "krx_trading_date",
    snapshotReferenceDate: "same_krx_trading_date",
    serviceCycleMapping: "krx_gold_close_cycle_v1",
    nonTradingDate:
      "carry_latest_prior_observation_without_synthetic_copy",
  }),
  anchorModel: Object.freeze({
    currentFractionalModel:
      "requires_explicit_research_assumption",
    executionFaithfulModel:
      "integer_grams_with_residual_cash_not_implemented",
    shortSelling: "forbidden_fail_closed",
  }),
} as const);

export type KrxGoldCloseEvidence = Readonly<{
  status: "ok";
  source: typeof KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.source;
  quoteKind: typeof KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.quoteKind;
  price: number;
  priceDate: string;
  fetchedAt: string;
}>;

export type KrxGoldCloseUnavailableReason =
  | "market_closed"
  | "not_published"
  | "provider_failure"
  | "invalid_response";

export type KrxGoldCloseCandidate =
  | KrxGoldCloseEvidence
  | Readonly<{
      status: "unavailable";
      reason: KrxGoldCloseUnavailableReason;
    }>;

export type KrxGoldCloseSelection = Readonly<{
  status: "selected" | "unavailable";
  selection: "current" | "candidate" | "none";
  reason:
    | "initial_close"
    | "newer_close"
    | "same_date_correction"
    | "same_date_unchanged"
    | "older_close_ignored"
    | "earlier_correction_ignored"
    | "candidate_unavailable"
    | "invalid_candidate"
    | "no_valid_close";
  selected: KrxGoldCloseEvidence | null;
}>;

export type KrxGoldCloseMovement = Readonly<{
  status: "comparable" | "awaiting_new_close" | "unavailable";
  includeInTodayAggregate: boolean;
  reason:
    | "newer_close_available"
    | "same_price_date"
    | "latest_older_than_baseline"
    | "missing_or_invalid_close"
    | "invalid_quantity";
  baselinePriceDate: string | null;
  latestPriceDate: string | null;
  unitPriceChangeKrwPerG: number | null;
  movementKrw: number | null;
  returnPct: number | null;
}>;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UNAVAILABLE_REASONS = new Set<KrxGoldCloseUnavailableReason>([
  "market_closed",
  "not_published",
  "provider_failure",
  "invalid_response",
]);

export function buildInstrumentSemanticKey(
  identity: InstrumentSemanticIdentity,
): string | null {
  const instrumentKind = normalizeToken(identity.instrumentKind, "lower");
  const venue = normalizeToken(identity.venue, "upper");
  const productKey = normalizeToken(identity.productKey, "lower");
  const holdingUnit = normalizeToken(identity.holdingUnit, "lower");
  const quoteCurrency = normalizeToken(identity.quoteCurrency, "upper");
  const quoteUnit = normalizeToken(identity.quoteUnit, "upper");

  if (
    !instrumentKind ||
    !venue ||
    !productKey ||
    !holdingUnit ||
    !quoteCurrency ||
    !quoteUnit
  ) {
    return null;
  }

  return JSON.stringify({
    instrumentKind,
    venue,
    productKey,
    holdingUnit,
    quoteCurrency,
    quoteUnit,
  });
}

export function resolveKrxGoldCloseEvidence({
  current,
  candidate,
}: {
  current: KrxGoldCloseEvidence | null;
  candidate: KrxGoldCloseCandidate;
}): KrxGoldCloseSelection {
  const normalizedCurrent = normalizeCloseEvidence(current);

  if (candidate.status === "unavailable") {
    const reason = UNAVAILABLE_REASONS.has(candidate.reason)
      ? "candidate_unavailable"
      : "invalid_candidate";
    return normalizedCurrent
      ? closeSelection("current", reason, normalizedCurrent)
      : closeSelection("none", "no_valid_close", null);
  }

  const normalizedCandidate = normalizeCloseEvidence(candidate);
  if (!normalizedCandidate) {
    return normalizedCurrent
      ? closeSelection("current", "invalid_candidate", normalizedCurrent)
      : closeSelection("none", "no_valid_close", null);
  }
  if (!normalizedCurrent) {
    return closeSelection("candidate", "initial_close", normalizedCandidate);
  }

  const dateComparison = normalizedCandidate.priceDate.localeCompare(
    normalizedCurrent.priceDate,
  );
  if (dateComparison > 0) {
    return closeSelection("candidate", "newer_close", normalizedCandidate);
  }
  if (dateComparison < 0) {
    return closeSelection("current", "older_close_ignored", normalizedCurrent);
  }
  if (normalizedCandidate.price === normalizedCurrent.price) {
    return closeSelection("current", "same_date_unchanged", normalizedCurrent);
  }
  if (
    Date.parse(normalizedCandidate.fetchedAt) >
    Date.parse(normalizedCurrent.fetchedAt)
  ) {
    return closeSelection(
      "candidate",
      "same_date_correction",
      normalizedCandidate,
    );
  }
  return closeSelection(
    "current",
    "earlier_correction_ignored",
    normalizedCurrent,
  );
}

export function classifyKrxGoldCloseMovement({
  quantityG,
  baseline,
  latest,
}: {
  quantityG: number;
  baseline: KrxGoldCloseEvidence | null;
  latest: KrxGoldCloseEvidence | null;
}): KrxGoldCloseMovement {
  const normalizedBaseline = normalizeCloseEvidence(baseline);
  const normalizedLatest = normalizeCloseEvidence(latest);

  if (!Number.isFinite(quantityG) || quantityG < 0) {
    return closeMovement(
      "unavailable",
      false,
      "invalid_quantity",
      normalizedBaseline,
      normalizedLatest,
    );
  }
  if (!normalizedBaseline || !normalizedLatest) {
    return closeMovement(
      "unavailable",
      false,
      "missing_or_invalid_close",
      normalizedBaseline,
      normalizedLatest,
    );
  }

  const dateComparison = normalizedLatest.priceDate.localeCompare(
    normalizedBaseline.priceDate,
  );
  if (dateComparison < 0) {
    return closeMovement(
      "unavailable",
      false,
      "latest_older_than_baseline",
      normalizedBaseline,
      normalizedLatest,
    );
  }
  if (dateComparison === 0) {
    return closeMovement(
      "awaiting_new_close",
      false,
      "same_price_date",
      normalizedBaseline,
      normalizedLatest,
    );
  }

  const unitPriceChangeKrwPerG =
    normalizedLatest.price - normalizedBaseline.price;
  return Object.freeze({
    status: "comparable",
    includeInTodayAggregate: true,
    reason: "newer_close_available",
    baselinePriceDate: normalizedBaseline.priceDate,
    latestPriceDate: normalizedLatest.priceDate,
    unitPriceChangeKrwPerG,
    movementKrw: unitPriceChangeKrwPerG * quantityG,
    returnPct:
      (unitPriceChangeKrwPerG / normalizedBaseline.price) * 100,
  });
}

function normalizeCloseEvidence(
  evidence: KrxGoldCloseEvidence | null,
): KrxGoldCloseEvidence | null {
  if (
    !evidence ||
    evidence.status !== "ok" ||
    evidence.source !== KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.source ||
    evidence.quoteKind !== KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.quoteKind ||
    !Number.isFinite(evidence.price) ||
    evidence.price <= 0 ||
    !isIsoDate(evidence.priceDate)
  ) {
    return null;
  }

  const fetchedAtMs = Date.parse(evidence.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return null;

  return Object.freeze({
    status: "ok",
    source: KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.source,
    quoteKind: KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing.quoteKind,
    price: evidence.price,
    priceDate: evidence.priceDate,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
  });
}

function closeSelection(
  selection: KrxGoldCloseSelection["selection"],
  reason: KrxGoldCloseSelection["reason"],
  selected: KrxGoldCloseEvidence | null,
): KrxGoldCloseSelection {
  return Object.freeze({
    status: selected ? "selected" : "unavailable",
    selection,
    reason,
    selected,
  });
}

function closeMovement(
  status: KrxGoldCloseMovement["status"],
  includeInTodayAggregate: boolean,
  reason: KrxGoldCloseMovement["reason"],
  baseline: KrxGoldCloseEvidence | null,
  latest: KrxGoldCloseEvidence | null,
): KrxGoldCloseMovement {
  return Object.freeze({
    status,
    includeInTodayAggregate,
    reason,
    baselinePriceDate: baseline?.priceDate ?? null,
    latestPriceDate: latest?.priceDate ?? null,
    unitPriceChangeKrwPerG: null,
    movementKrw: null,
    returnPct: null,
  });
}

function isIsoDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeToken(value: string, casing: "lower" | "upper") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return casing === "lower"
    ? normalized.toLowerCase()
    : normalized.toUpperCase();
}
