import { isRiskDate } from "../portfolio-risk-calendar.ts";
import {
  evaluateProviderAdjustedHistoryReadiness,
  type ProviderAdjustedHistoryReadiness,
  type ProviderAdjustedHistoryReadinessInput,
} from "./provider-adjusted-history-readiness.ts";
import {
  evaluateProviderFxWindowEvidence,
  type ProviderFxWindowEvidence,
  type ProviderFxWindowRow,
} from "./provider-fx-window-evidence.ts";

export const PROVIDER_INSTRUMENT_EVIDENCE_MATRIX_POLICY = Object.freeze({
  version: "provider_instrument_evidence_matrix_v1",
  identity: "market_currency_ticker",
  binding:
    "provider_symbol_exchange_and_effective_range_per_instrument",
  entitlementDimensions: Object.freeze([
    "fetch",
    "store",
    "display",
    "multi_user",
  ] as const),
  fxScope: "candidate_requested_source_date_window",
  providerCalls: "none",
  databaseWrites: "none",
  writeAdmission: "all_exact_candidate_checks_must_pass",
} as const);

export type ProviderEntitlementStatus =
  | "admitted"
  | "unproven"
  | "denied";

export type ProviderInstrumentEvidenceCandidateInput = Readonly<{
  instrument: Readonly<{
    market: string;
    currency: string;
    ticker: string;
  }>;
  provider: Readonly<{
    id: string;
    symbol: string;
    exchange: string;
    bindingStatus: "verified" | "unproven" | "invalid";
    effectiveFrom: string;
    effectiveTo: string;
  }>;
  entitlements: Readonly<{
    fetch: ProviderEntitlementStatus;
    store: ProviderEntitlementStatus;
    display: ProviderEntitlementStatus;
    multiUser: ProviderEntitlementStatus;
  }>;
  endpoint: Readonly<{
    id: string;
    priceField: string;
    priceBasis: ProviderAdjustedHistoryReadinessInput["priceBasis"];
  }>;
  historicalPagination: ProviderAdjustedHistoryReadinessInput["historicalPagination"];
  corporateActionParity: ProviderAdjustedHistoryReadinessInput["corporateActionParity"];
  correctionPolicy: ProviderAdjustedHistoryReadinessInput["correctionPolicy"];
  duplicatePolicy: ProviderAdjustedHistoryReadinessInput["duplicatePolicy"];
  requestedSourceDateRange: Readonly<{ from: string; to: string }>;
  requiredServiceDates: readonly string[];
  maxFxCarryDays: number;
  fxRows: readonly ProviderFxWindowRow[];
}>;

export type ProviderInstrumentEvidenceCandidate = Readonly<{
  instrumentKey: string | null;
  instrument: Readonly<{
    market: string;
    currency: string;
    ticker: string;
  }> | null;
  provider: Readonly<{
    id: string | null;
    symbol: string | null;
    exchange: string | null;
    bindingStatus: "verified" | "unproven" | "invalid";
    effectiveFrom: string | null;
    effectiveTo: string | null;
    requestedRangeCovered: boolean;
  }>;
  entitlements: ProviderInstrumentEvidenceCandidateInput["entitlements"];
  endpoint: ProviderInstrumentEvidenceCandidateInput["endpoint"];
  requestedSourceDateRange: Readonly<{ from: string; to: string }> | null;
  fxEvidence: ProviderFxWindowEvidence;
  readiness: ProviderAdjustedHistoryReadiness;
  status: ProviderAdjustedHistoryReadiness["status"];
  writeAdmitted: boolean;
  blockers: readonly string[];
}>;

export type ProviderInstrumentEvidenceMatrix = Readonly<{
  policy: typeof PROVIDER_INSTRUMENT_EVIDENCE_MATRIX_POLICY;
  candidates: readonly ProviderInstrumentEvidenceCandidate[];
  summary: Readonly<{
    candidateCount: number;
    writeAdmittedCount: number;
    blockedCount: number;
    duplicateInstrumentKeys: readonly string[];
  }>;
}>;

export function buildProviderInstrumentEvidenceMatrix(input: {
  schema: ProviderAdjustedHistoryReadinessInput["schema"];
  candidates: readonly ProviderInstrumentEvidenceCandidateInput[];
}): ProviderInstrumentEvidenceMatrix {
  const keys = input.candidates.map((candidate) =>
    normalizedInstrument(candidate.instrument)?.instrumentKey ?? null,
  );
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateInstrumentKeys = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  const duplicateSet = new Set(duplicateInstrumentKeys);
  const candidates = input.candidates.map((candidate, index) =>
    evaluateCandidate({
      schema: input.schema,
      candidate,
      duplicateInstrument:
        keys[index] !== null && duplicateSet.has(keys[index]!),
    }),
  );
  const writeAdmittedCount = candidates.filter(
    (candidate) => candidate.writeAdmitted,
  ).length;

  return Object.freeze({
    policy: PROVIDER_INSTRUMENT_EVIDENCE_MATRIX_POLICY,
    candidates: Object.freeze(candidates),
    summary: Object.freeze({
      candidateCount: candidates.length,
      writeAdmittedCount,
      blockedCount: candidates.length - writeAdmittedCount,
      duplicateInstrumentKeys: Object.freeze(duplicateInstrumentKeys),
    }),
  });
}

function evaluateCandidate(input: {
  schema: ProviderAdjustedHistoryReadinessInput["schema"];
  candidate: ProviderInstrumentEvidenceCandidateInput;
  duplicateInstrument: boolean;
}): ProviderInstrumentEvidenceCandidate {
  const candidate = input.candidate;
  const instrument = normalizedInstrument(candidate.instrument);
  const providerId = normalizeText(candidate.provider?.id)?.toLowerCase() ?? null;
  const providerSymbol =
    normalizeText(candidate.provider?.symbol)?.toUpperCase() ?? null;
  const providerExchange =
    normalizeText(candidate.provider?.exchange)?.toUpperCase() ?? null;
  const effectiveFrom = normalizeDate(candidate.provider?.effectiveFrom);
  const effectiveTo = normalizeDate(candidate.provider?.effectiveTo);
  const requestedRange = normalizeRange(candidate.requestedSourceDateRange);
  const bindingRangeValid =
    effectiveFrom !== null &&
    effectiveTo !== null &&
    effectiveFrom <= effectiveTo;
  const requestedRangeCovered =
    bindingRangeValid &&
    requestedRange !== null &&
    effectiveFrom <= requestedRange.from &&
    effectiveTo >= requestedRange.to;
  const bindingInputValid =
    providerId !== null &&
    providerSymbol !== null &&
    providerExchange !== null &&
    bindingRangeValid &&
    requestedRange !== null;
  const bindingStatus =
    !bindingInputValid || !requestedRangeCovered
      ? ("invalid" as const)
      : candidate.provider.bindingStatus;
  const entitlement = aggregateEntitlement(candidate.entitlements);
  const fxEvidence = evaluateProviderFxWindowEvidence({
    currency: instrument?.currency ?? candidate.instrument?.currency ?? "",
    sourceDateRange: candidate.requestedSourceDateRange,
    requiredServiceDates: candidate.requiredServiceDates,
    maxCarryDays: candidate.maxFxCarryDays,
    rows: candidate.fxRows,
  });
  const readiness = evaluateProviderAdjustedHistoryReadiness({
    provider: providerId ?? "",
    market: instrument?.market ?? "",
    currency: instrument?.currency ?? "",
    schema: input.schema,
    dataUsageEntitlement: entitlement,
    instrumentBinding: bindingStatus,
    historicalPagination: candidate.historicalPagination,
    priceBasis: candidate.endpoint.priceBasis,
    corporateActionParity: candidate.corporateActionParity,
    correctionPolicy: candidate.correctionPolicy,
    duplicatePolicy: candidate.duplicatePolicy,
    fxCoverage:
      instrument?.currency === "KRW"
        ? "not_applicable"
        : fxEvidence.status === "complete"
          ? "complete"
          : "incomplete",
  });
  const blockers = new Set<string>(readiness.issues);

  if (!instrument) blockers.add("invalid_instrument_identity");
  if (input.duplicateInstrument) blockers.add("duplicate_instrument_identity");
  if (!bindingInputValid) blockers.add("invalid_provider_binding");
  if (bindingInputValid && !requestedRangeCovered) {
    blockers.add("provider_binding_range_mismatch");
  }
  addEntitlementBlockers(blockers, candidate.entitlements);
  for (const issue of fxEvidence.issues) blockers.add(`fx_${issue}`);

  const writeAdmitted =
    readiness.writeAdmitted &&
    Boolean(instrument) &&
    !input.duplicateInstrument &&
    requestedRangeCovered &&
    blockers.size === 0;
  const status =
    !instrument || input.duplicateInstrument
      ? ("blocked_invalid_input" as const)
      : readiness.status;

  return Object.freeze({
    instrumentKey: instrument?.instrumentKey ?? null,
    instrument: instrument
      ? Object.freeze({
          market: instrument.market,
          currency: instrument.currency,
          ticker: instrument.ticker,
        })
      : null,
    provider: Object.freeze({
      id: providerId,
      symbol: providerSymbol,
      exchange: providerExchange,
      bindingStatus,
      effectiveFrom,
      effectiveTo,
      requestedRangeCovered,
    }),
    entitlements: Object.freeze({ ...candidate.entitlements }),
    endpoint: Object.freeze({ ...candidate.endpoint }),
    requestedSourceDateRange: requestedRange,
    fxEvidence,
    readiness,
    status,
    writeAdmitted,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function normalizedInstrument(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const instrument = value as {
    market?: unknown;
    currency?: unknown;
    ticker?: unknown;
  };
  const market = normalizeText(instrument.market)?.toLowerCase() ?? null;
  const currency = normalizeText(instrument.currency)?.toUpperCase() ?? null;
  const ticker = normalizeText(instrument.ticker)?.toUpperCase() ?? null;
  if (
    !market ||
    (currency !== "KRW" && currency !== "USD") ||
    !ticker
  ) {
    return null;
  }
  return Object.freeze({
    market,
    currency,
    ticker,
    instrumentKey: `${market}|${currency}|${ticker}`,
  });
}

function aggregateEntitlement(
  entitlements: ProviderInstrumentEvidenceCandidateInput["entitlements"],
): ProviderEntitlementStatus {
  const values = [
    entitlements?.fetch,
    entitlements?.store,
    entitlements?.display,
    entitlements?.multiUser,
  ];
  if (values.some((value) => value === "denied")) return "denied";
  return values.every((value) => value === "admitted")
    ? "admitted"
    : "unproven";
}

function addEntitlementBlockers(
  blockers: Set<string>,
  entitlements: ProviderInstrumentEvidenceCandidateInput["entitlements"],
) {
  const dimensions = [
    ["fetch", entitlements?.fetch],
    ["store", entitlements?.store],
    ["display", entitlements?.display],
    ["multi_user", entitlements?.multiUser],
  ] as const;
  for (const [dimension, status] of dimensions) {
    if (status !== "admitted") {
      blockers.add(`${dimension}_entitlement_${status ?? "invalid"}`);
    }
  }
}

function normalizeRange(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const range = value as { from?: unknown; to?: unknown };
  const from = normalizeDate(range.from);
  const to = normalizeDate(range.to);
  return from && to && from <= to ? Object.freeze({ from, to }) : null;
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  return isRiskDate(date) ? date : null;
}

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}
