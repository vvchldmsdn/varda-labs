export const PROVIDER_ADJUSTED_HISTORY_READINESS_POLICY = Object.freeze({
  version: "provider_adjusted_history_readiness_v1",
  instrumentIdentity: "market_currency_ticker",
  requiredPriceBasis: "distribution_adjusted_total_return",
  requiredDuplicatePolicy: "exact_instrument_date_fail_close",
  providerCalls: "none",
  databaseWrites: "none",
  writeAdmission: "all_checks_must_pass",
} as const);

export type ProviderAdjustedHistoryReadinessStatus =
  | "admitted_for_write"
  | "blocked_invalid_input"
  | "license_denied"
  | "license_unproven"
  | "schema_not_ready"
  | "provider_binding_incomplete"
  | "history_pagination_unproven"
  | "basis_ineligible"
  | "corporate_action_unproven"
  | "correction_policy_unproven"
  | "duplicate_policy_unproven"
  | "fx_incomplete";

export type ProviderAdjustedHistoryReadinessIssue =
  | "invalid_input"
  | "license_denied"
  | "license_unproven"
  | "provenance_columns_missing"
  | "exact_instrument_date_unique_missing"
  | "legacy_ticker_date_unique_blocks_multi_market"
  | "provider_binding_unproven"
  | "provider_binding_invalid"
  | "history_pagination_unproven"
  | "history_pagination_invalid"
  | "price_basis_ineligible"
  | "corporate_action_parity_unproven"
  | "corporate_action_parity_failed"
  | "correction_policy_unproven"
  | "duplicate_policy_unproven"
  | "fx_incomplete";

export type ProviderAdjustedHistoryReadinessInput = Readonly<{
  provider: string;
  market: string;
  currency: string;
  schema: Readonly<{
    provenanceColumnsReady: boolean;
    exactInstrumentDateUnique: boolean;
    legacyTickerDateUnique: boolean;
  }>;
  dataUsageEntitlement: "admitted" | "unproven" | "denied";
  instrumentBinding: "verified" | "unproven" | "invalid";
  historicalPagination: "verified" | "unproven" | "invalid";
  priceBasis:
    | "distribution_adjusted_total_return"
    | "split_adjusted_price_return"
    | "raw_price_return"
    | "unverified";
  corporateActionParity: "verified" | "unproven" | "failed";
  correctionPolicy: "verified" | "unproven";
  duplicatePolicy:
    | "exact_instrument_date_fail_close"
    | "unproven";
  fxCoverage: "not_applicable" | "complete" | "incomplete";
}>;

export type ProviderAdjustedHistoryReadiness = Readonly<{
  policy: typeof PROVIDER_ADJUSTED_HISTORY_READINESS_POLICY;
  provider: string | null;
  instrumentScope: string | null;
  status: ProviderAdjustedHistoryReadinessStatus;
  writeAdmitted: boolean;
  issues: readonly ProviderAdjustedHistoryReadinessIssue[];
  checks: Readonly<{
    schemaReady: boolean;
    licenseReady: boolean;
    providerBindingReady: boolean;
    paginationReady: boolean;
    priceBasisReady: boolean;
    corporateActionParityReady: boolean;
    correctionPolicyReady: boolean;
    duplicatePolicyReady: boolean;
    fxReady: boolean;
  }>;
}>;

export function evaluateProviderAdjustedHistoryReadiness(
  input: ProviderAdjustedHistoryReadinessInput,
): ProviderAdjustedHistoryReadiness {
  const provider = normalizeText(input?.provider)?.toLowerCase() ?? null;
  const market = normalizeText(input?.market)?.toLowerCase() ?? null;
  const currency = normalizeText(input?.currency)?.toUpperCase() ?? null;

  if (
    !provider ||
    !market ||
    (currency !== "KRW" && currency !== "USD") ||
    !hasValidReadinessValues(input)
  ) {
    return result({
      provider,
      instrumentScope:
        market && currency ? `${market}|${currency}` : null,
      status: "blocked_invalid_input",
      issues: ["invalid_input"],
      checks: emptyChecks(),
    });
  }

  const issues: ProviderAdjustedHistoryReadinessIssue[] = [];
  const schemaReady =
    input.schema.provenanceColumnsReady &&
    input.schema.exactInstrumentDateUnique &&
    !input.schema.legacyTickerDateUnique;
  const licenseReady = input.dataUsageEntitlement === "admitted";
  const providerBindingReady = input.instrumentBinding === "verified";
  const paginationReady = input.historicalPagination === "verified";
  const priceBasisReady =
    input.priceBasis ===
    PROVIDER_ADJUSTED_HISTORY_READINESS_POLICY.requiredPriceBasis;
  const corporateActionParityReady =
    input.corporateActionParity === "verified";
  const correctionPolicyReady = input.correctionPolicy === "verified";
  const duplicatePolicyReady =
    input.duplicatePolicy ===
    PROVIDER_ADJUSTED_HISTORY_READINESS_POLICY.requiredDuplicatePolicy;
  const fxReady =
    currency === "KRW"
      ? input.fxCoverage === "not_applicable"
      : input.fxCoverage === "complete";

  if (input.dataUsageEntitlement === "denied") issues.push("license_denied");
  if (input.dataUsageEntitlement === "unproven") {
    issues.push("license_unproven");
  }
  if (!input.schema.provenanceColumnsReady) {
    issues.push("provenance_columns_missing");
  }
  if (!input.schema.exactInstrumentDateUnique) {
    issues.push("exact_instrument_date_unique_missing");
  }
  if (input.schema.legacyTickerDateUnique) {
    issues.push("legacy_ticker_date_unique_blocks_multi_market");
  }
  if (input.instrumentBinding === "unproven") {
    issues.push("provider_binding_unproven");
  }
  if (input.instrumentBinding === "invalid") {
    issues.push("provider_binding_invalid");
  }
  if (input.historicalPagination === "unproven") {
    issues.push("history_pagination_unproven");
  }
  if (input.historicalPagination === "invalid") {
    issues.push("history_pagination_invalid");
  }
  if (!priceBasisReady) issues.push("price_basis_ineligible");
  if (input.corporateActionParity === "unproven") {
    issues.push("corporate_action_parity_unproven");
  }
  if (input.corporateActionParity === "failed") {
    issues.push("corporate_action_parity_failed");
  }
  if (!correctionPolicyReady) issues.push("correction_policy_unproven");
  if (!duplicatePolicyReady) issues.push("duplicate_policy_unproven");
  if (!fxReady) issues.push("fx_incomplete");

  const checks = Object.freeze({
    schemaReady,
    licenseReady,
    providerBindingReady,
    paginationReady,
    priceBasisReady,
    corporateActionParityReady,
    correctionPolicyReady,
    duplicatePolicyReady,
    fxReady,
  });
  const status = primaryStatus(issues);

  return result({
    provider,
    instrumentScope: `${market}|${currency}`,
    status,
    issues,
    checks,
  });
}

function primaryStatus(
  issues: readonly ProviderAdjustedHistoryReadinessIssue[],
): ProviderAdjustedHistoryReadinessStatus {
  if (issues.includes("license_denied")) return "license_denied";
  if (issues.includes("license_unproven")) return "license_unproven";
  if (
    issues.includes("provenance_columns_missing") ||
    issues.includes("exact_instrument_date_unique_missing") ||
    issues.includes("legacy_ticker_date_unique_blocks_multi_market")
  ) {
    return "schema_not_ready";
  }
  if (
    issues.includes("provider_binding_unproven") ||
    issues.includes("provider_binding_invalid")
  ) {
    return "provider_binding_incomplete";
  }
  if (
    issues.includes("history_pagination_unproven") ||
    issues.includes("history_pagination_invalid")
  ) {
    return "history_pagination_unproven";
  }
  if (issues.includes("price_basis_ineligible")) return "basis_ineligible";
  if (
    issues.includes("corporate_action_parity_unproven") ||
    issues.includes("corporate_action_parity_failed")
  ) {
    return "corporate_action_unproven";
  }
  if (issues.includes("correction_policy_unproven")) {
    return "correction_policy_unproven";
  }
  if (issues.includes("duplicate_policy_unproven")) {
    return "duplicate_policy_unproven";
  }
  if (issues.includes("fx_incomplete")) return "fx_incomplete";
  return "admitted_for_write";
}

function result(input: {
  provider: string | null;
  instrumentScope: string | null;
  status: ProviderAdjustedHistoryReadinessStatus;
  issues: readonly ProviderAdjustedHistoryReadinessIssue[];
  checks: ProviderAdjustedHistoryReadiness["checks"];
}): ProviderAdjustedHistoryReadiness {
  return Object.freeze({
    policy: PROVIDER_ADJUSTED_HISTORY_READINESS_POLICY,
    provider: input.provider,
    instrumentScope: input.instrumentScope,
    status: input.status,
    writeAdmitted: input.status === "admitted_for_write",
    issues: Object.freeze([...input.issues]),
    checks: input.checks,
  });
}

function emptyChecks() {
  return Object.freeze({
    schemaReady: false,
    licenseReady: false,
    providerBindingReady: false,
    paginationReady: false,
    priceBasisReady: false,
    corporateActionParityReady: false,
    correctionPolicyReady: false,
    duplicatePolicyReady: false,
    fxReady: false,
  });
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function hasValidReadinessValues(
  input: ProviderAdjustedHistoryReadinessInput,
) {
  return (
    typeof input?.schema?.provenanceColumnsReady === "boolean" &&
    typeof input.schema.exactInstrumentDateUnique === "boolean" &&
    typeof input.schema.legacyTickerDateUnique === "boolean" &&
    ["admitted", "unproven", "denied"].includes(
      input.dataUsageEntitlement,
    ) &&
    ["verified", "unproven", "invalid"].includes(input.instrumentBinding) &&
    ["verified", "unproven", "invalid"].includes(
      input.historicalPagination,
    ) &&
    [
      "distribution_adjusted_total_return",
      "split_adjusted_price_return",
      "raw_price_return",
      "unverified",
    ].includes(input.priceBasis) &&
    ["verified", "unproven", "failed"].includes(
      input.corporateActionParity,
    ) &&
    ["verified", "unproven"].includes(input.correctionPolicy) &&
    ["exact_instrument_date_fail_close", "unproven"].includes(
      input.duplicatePolicy,
    ) &&
    ["not_applicable", "complete", "incomplete"].includes(input.fxCoverage)
  );
}
