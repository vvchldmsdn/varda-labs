export const PROVIDER_HISTORY_SHORTLIST_POLICY = Object.freeze({
  version: "provider_history_shortlist_v1",
  scope: "read_only_provider_selection_evidence",
  instrumentIdentity: "market_currency_ticker",
  requiredEntitlements: Object.freeze([
    "fetch",
    "store",
    "display",
    "multiUser",
  ] as const),
  acceptedPriceModels: Object.freeze([
    "distribution_adjusted_documented",
    "split_and_distribution_components_documented",
  ] as const),
  contractRequiredIsAdmitted: false,
  providerCalls: "none",
  databaseWrites: "none",
  sharedCacheWriteAdmission: "never",
  selection:
    "fewest_remaining_evidence_stages_without_numeric_vendor_score",
} as const);

export type ProviderHistoryEvidenceStatus =
  | "documented"
  | "runtime_observed"
  | "unproven"
  | "not_supported";

export type ProviderHistoryEntitlementStatus =
  | "admitted"
  | "contract_required"
  | "unproven"
  | "denied";

export type ProviderHistoryPriceModel =
  | "distribution_adjusted_documented"
  | "split_and_distribution_components_documented"
  | "split_adjusted_only_documented"
  | "unproven";

export type ProviderHistoryVerificationStatus =
  | "verified"
  | "unproven"
  | "failed";

export type ProviderHistoryNextAction =
  | "blocked_invalid_evidence"
  | "reject_not_supported"
  | "confirm_exact_instrument_binding"
  | "confirm_historical_range_capability"
  | "confirm_total_return_price_model"
  | "request_written_commercial_terms"
  | "confirm_transport_and_correction_contract"
  | "run_separately_authorized_bounded_payload_parity_trial"
  | "ready_for_separate_adapter_review";

export type ProviderHistoryOfficialSource = Readonly<{
  id: string;
  title: string;
  url: string;
  reviewedAt: string;
}>;

export type ProviderHistoryEvidenceClaim<T extends string> = Readonly<{
  status: T;
  sourceIds: readonly string[];
}>;

export type ProviderHistoryInstrument = Readonly<{
  market: string;
  currency: string;
  ticker: string;
}>;

export type ProviderHistoryCandidateInput = Readonly<{
  providerId: string;
  officialSources: readonly ProviderHistoryOfficialSource[];
  entitlements: Readonly<{
    fetch: ProviderHistoryEvidenceClaim<ProviderHistoryEntitlementStatus>;
    store: ProviderHistoryEvidenceClaim<ProviderHistoryEntitlementStatus>;
    display: ProviderHistoryEvidenceClaim<ProviderHistoryEntitlementStatus>;
    multiUser: ProviderHistoryEvidenceClaim<ProviderHistoryEntitlementStatus>;
  }>;
  instrumentBindings: readonly Readonly<{
    instrument: ProviderHistoryInstrument;
    providerSymbol: string;
    providerExchange: string;
    evidence: ProviderHistoryEvidenceClaim<ProviderHistoryEvidenceStatus>;
  }>[];
  history: Readonly<{
    endpointId: string;
    rangeCapability: ProviderHistoryEvidenceClaim<ProviderHistoryEvidenceStatus>;
    pagination: ProviderHistoryEvidenceClaim<ProviderHistoryEvidenceStatus>;
    priceModel: ProviderHistoryEvidenceClaim<ProviderHistoryPriceModel>;
    requestedWindowCoverage: ProviderHistoryVerificationStatus;
    corporateActionParity: ProviderHistoryVerificationStatus;
    correctionPolicy: ProviderHistoryEvidenceClaim<ProviderHistoryEvidenceStatus>;
    duplicatePolicy: ProviderHistoryEvidenceClaim<ProviderHistoryEvidenceStatus>;
  }>;
}>;

export type ProviderHistoryCandidateEvaluation = Readonly<{
  providerId: string | null;
  validEvidence: boolean;
  officialSources: readonly ProviderHistoryOfficialSource[];
  instrumentBindings: readonly Readonly<{
    instrumentKey: string;
    providerSymbol: string;
    providerExchange: string;
    evidenceStatus: ProviderHistoryEvidenceStatus;
  }>[];
  instrumentCoverage: Readonly<{
    requiredCount: number;
    documentedCount: number;
    runtimeObservedCount: number;
    unprovenCount: number;
    notSupportedCount: number;
    missingInstrumentKeys: readonly string[];
  }>;
  commercialStatus:
    | "admitted"
    | "contract_required"
    | "unproven"
    | "denied";
  priceModel: ProviderHistoryPriceModel | null;
  historyEvidence: Readonly<{
    endpointId: string | null;
    rangeCapability: ProviderHistoryEvidenceStatus | null;
    pagination: ProviderHistoryEvidenceStatus | null;
    requestedWindowCoverage: ProviderHistoryVerificationStatus | null;
    corporateActionParity: ProviderHistoryVerificationStatus | null;
    correctionPolicy: ProviderHistoryEvidenceStatus | null;
    duplicatePolicy: ProviderHistoryEvidenceStatus | null;
  }>;
  nextAction: ProviderHistoryNextAction;
  blockers: readonly string[];
  providerCallAdmitted: false;
  sharedCacheWriteAdmitted: false;
}>;

export type ProviderHistoryShortlist = Readonly<{
  policy: typeof PROVIDER_HISTORY_SHORTLIST_POLICY;
  requestedSourceDateRange: Readonly<{ from: string; to: string }> | null;
  requiredInstrumentKeys: readonly string[];
  candidates: readonly ProviderHistoryCandidateEvaluation[];
  summary: Readonly<{
    candidateCount: number;
    recommendedProviderIds: readonly string[];
    duplicateProviderIds: readonly string[];
    providerCallsAdmitted: 0;
    sharedCacheWritesAdmitted: 0;
  }>;
}>;
