import type {
  ProviderHistoryCandidateEvaluation,
  ProviderHistoryCandidateInput,
  ProviderHistoryEntitlementStatus,
  ProviderHistoryEvidenceClaim,
  ProviderHistoryEvidenceStatus,
  ProviderHistoryInstrument,
  ProviderHistoryOfficialSource,
  ProviderHistoryPriceModel,
  ProviderHistoryVerificationStatus,
} from "./provider-history-shortlist-types.ts";

export function validateSources(
  values: readonly ProviderHistoryOfficialSource[] | undefined,
  blockers: Set<string>,
) {
  const ids = new Set<string>();
  for (const source of values ?? []) {
    const id = normalizeText(source.id)?.toLowerCase() ?? null;
    if (
      !id ||
      ids.has(id) ||
      !normalizeText(source.title) ||
      !isHttpsUrl(source.url) ||
      !normalizeDate(source.reviewedAt)
    ) {
      blockers.add("invalid_official_source");
      continue;
    }
    ids.add(id);
  }
  if (ids.size === 0) blockers.add("official_source_required");
  return ids;
}

export function validateClaimSources(
  claim: ProviderHistoryEvidenceClaim<string> | undefined,
  sources: ReadonlySet<string>,
  blockers: Set<string>,
) {
  if (!claim || !normalizeText(claim.status)) {
    blockers.add("invalid_evidence_claim");
    return;
  }
  const sourceIds = [...(claim.sourceIds ?? [])].map(
    (value) => normalizeText(value)?.toLowerCase() ?? "",
  );
  if (
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !id || !sources.has(id))
  ) {
    blockers.add("invalid_evidence_source_reference");
  }
  if (
    ["documented", "admitted", "contract_required"].includes(claim.status) &&
    sourceIds.length === 0
  ) {
    blockers.add("evidence_source_required");
  }
}

export function aggregateCommercialStatus(
  entitlements: ProviderHistoryCandidateInput["entitlements"] | undefined,
): ProviderHistoryCandidateEvaluation["commercialStatus"] {
  const statuses = [
    entitlements?.fetch?.status,
    entitlements?.store?.status,
    entitlements?.display?.status,
    entitlements?.multiUser?.status,
  ];
  if (statuses.some((status) => status === "denied")) return "denied";
  if (statuses.some((status) => status === "unproven")) return "unproven";
  if (statuses.some((status) => status === "contract_required")) {
    return "contract_required";
  }
  return statuses.every((status) => status === "admitted")
    ? "admitted"
    : "unproven";
}

export function validPriceModel(
  value: unknown,
): ProviderHistoryPriceModel | null {
  return [
    "distribution_adjusted_documented",
    "split_and_distribution_components_documented",
    "split_adjusted_only_documented",
    "unproven",
  ].includes(String(value))
    ? (value as ProviderHistoryPriceModel)
    : null;
}

export function isHistoryEvidenceStatus(
  value: unknown,
): value is ProviderHistoryEvidenceStatus {
  return [
    "documented",
    "runtime_observed",
    "unproven",
    "not_supported",
  ].includes(String(value));
}

export function isEntitlementStatus(
  value: unknown,
): value is ProviderHistoryEntitlementStatus {
  return [
    "admitted",
    "contract_required",
    "unproven",
    "denied",
  ].includes(String(value));
}

export function isVerificationStatus(
  value: unknown,
): value is ProviderHistoryVerificationStatus {
  return ["verified", "unproven", "failed"].includes(String(value));
}

export function normalizeRequiredInstruments(
  values: readonly ProviderHistoryInstrument[] | undefined,
) {
  const keys: string[] = [];
  let inputValid = true;
  for (const value of values ?? []) {
    const instrument = normalizeInstrument(value);
    if (!instrument || keys.includes(instrument.key)) {
      inputValid = false;
      continue;
    }
    keys.push(instrument.key);
  }
  if (keys.length === 0) inputValid = false;
  return Object.freeze({ keys: Object.freeze(keys.sort()), inputValid });
}

export function normalizeInstrument(
  value: ProviderHistoryInstrument | undefined,
) {
  const market = normalizeText(value?.market)?.toLowerCase() ?? null;
  const currency = normalizeText(value?.currency)?.toUpperCase() ?? null;
  const ticker = normalizeText(value?.ticker)?.toUpperCase() ?? null;
  if (!market || !ticker || !["KRW", "USD"].includes(currency ?? "")) {
    return null;
  }
  return Object.freeze({
    market,
    currency: currency!,
    ticker,
    key: `${market}|${currency}|${ticker}`,
  });
}

export function normalizeRange(
  value: Readonly<{ from: string; to: string }> | undefined,
) {
  const from = normalizeDate(value?.from);
  const to = normalizeDate(value?.to);
  return from && to && from <= to ? Object.freeze({ from, to }) : null;
}

export function duplicateValues(values: readonly (string | null)[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}

export function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
    ? null
    : text;
}

function isHttpsUrl(value: unknown) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}
