import {
  aggregateCommercialStatus,
  duplicateValues,
  isEntitlementStatus,
  isHistoryEvidenceStatus,
  isVerificationStatus,
  normalizeInstrument,
  normalizeRange,
  normalizeRequiredInstruments,
  normalizeText,
  validateClaimSources,
  validateSources,
  validPriceModel,
} from "./provider-history-shortlist-evidence.ts";
import {
  PROVIDER_HISTORY_SHORTLIST_POLICY,
  type ProviderHistoryCandidateEvaluation,
  type ProviderHistoryCandidateInput,
  type ProviderHistoryEvidenceStatus,
  type ProviderHistoryInstrument,
  type ProviderHistoryNextAction,
  type ProviderHistoryPriceModel,
  type ProviderHistoryShortlist,
  type ProviderHistoryVerificationStatus,
} from "./provider-history-shortlist-types.ts";

export {
  PROVIDER_HISTORY_SHORTLIST_POLICY,
  type ProviderHistoryCandidateEvaluation,
  type ProviderHistoryCandidateInput,
  type ProviderHistoryEntitlementStatus,
  type ProviderHistoryEvidenceClaim,
  type ProviderHistoryEvidenceStatus,
  type ProviderHistoryInstrument,
  type ProviderHistoryNextAction,
  type ProviderHistoryOfficialSource,
  type ProviderHistoryPriceModel,
  type ProviderHistoryShortlist,
  type ProviderHistoryVerificationStatus,
} from "./provider-history-shortlist-types.ts";

const ACTION_DISTANCE: Readonly<Record<ProviderHistoryNextAction, number>> =
  Object.freeze({
    ready_for_separate_adapter_review: 0,
    run_separately_authorized_bounded_payload_parity_trial: 1,
    confirm_transport_and_correction_contract: 2,
    request_written_commercial_terms: 3,
    confirm_total_return_price_model: 4,
    confirm_historical_range_capability: 5,
    confirm_exact_instrument_binding: 6,
    reject_not_supported: 7,
    blocked_invalid_evidence: 8,
  });

export function buildProviderHistoryShortlist(input: {
  requestedSourceDateRange: Readonly<{ from: string; to: string }>;
  requiredInstruments: readonly ProviderHistoryInstrument[];
  candidates: readonly ProviderHistoryCandidateInput[];
}): ProviderHistoryShortlist {
  const requestedSourceDateRange = normalizeRange(
    input.requestedSourceDateRange,
  );
  const required = normalizeRequiredInstruments(input.requiredInstruments);
  const providerIds = input.candidates.map(
    (candidate) => normalizeText(candidate.providerId)?.toLowerCase() ?? null,
  );
  const duplicateProviderIds = duplicateValues(providerIds);
  const duplicateProviderSet = new Set(duplicateProviderIds);
  const candidates = input.candidates.map((candidate) =>
    evaluateCandidate({
      candidate,
      required,
      requestValid:
        requestedSourceDateRange !== null && required.inputValid,
      duplicateProvider:
        duplicateProviderSet.has(
          normalizeText(candidate.providerId)?.toLowerCase() ?? "",
        ),
    }),
  );
  const selectable = candidates.filter(
    (candidate) =>
      candidate.providerId !== null &&
      candidate.nextAction !== "blocked_invalid_evidence" &&
      candidate.nextAction !== "reject_not_supported",
  );
  const nearestDistance =
    selectable.length > 0
      ? Math.min(
          ...selectable.map(
            (candidate) => ACTION_DISTANCE[candidate.nextAction],
          ),
        )
      : null;
  const recommendedProviderIds =
    nearestDistance === null
      ? []
      : selectable
          .filter(
            (candidate) =>
              ACTION_DISTANCE[candidate.nextAction] === nearestDistance,
          )
          .map((candidate) => candidate.providerId!)
          .sort();

  return Object.freeze({
    policy: PROVIDER_HISTORY_SHORTLIST_POLICY,
    requestedSourceDateRange,
    requiredInstrumentKeys: Object.freeze([...required.keys]),
    candidates: Object.freeze(candidates),
    summary: Object.freeze({
      candidateCount: candidates.length,
      recommendedProviderIds: Object.freeze(recommendedProviderIds),
      duplicateProviderIds: Object.freeze(duplicateProviderIds),
      providerCallsAdmitted: 0,
      sharedCacheWritesAdmitted: 0,
    }),
  });
}

function evaluateCandidate(input: {
  candidate: ProviderHistoryCandidateInput;
  required: ReturnType<typeof normalizeRequiredInstruments>;
  requestValid: boolean;
  duplicateProvider: boolean;
}): ProviderHistoryCandidateEvaluation {
  const { candidate, required } = input;
  const providerId = normalizeText(candidate.providerId)?.toLowerCase() ?? null;
  const blockers = new Set<string>();
  const sources = validateSources(candidate.officialSources, blockers);
  const bindings = new Map<
    string,
    ProviderHistoryCandidateInput["instrumentBindings"][number]
  >();
  const normalizedBindings: Array<
    ProviderHistoryCandidateEvaluation["instrumentBindings"][number]
  > = [];

  for (const binding of candidate.instrumentBindings ?? []) {
    const instrument = normalizeInstrument(binding.instrument);
    if (!instrument) {
      blockers.add("invalid_instrument_binding");
      continue;
    }
    if (bindings.has(instrument.key)) {
      blockers.add(`duplicate_instrument_binding:${instrument.key}`);
      continue;
    }
    bindings.set(instrument.key, binding);
    validateClaimSources(binding.evidence, sources, blockers);
    if (!isHistoryEvidenceStatus(binding.evidence?.status)) {
      blockers.add(`invalid_binding_evidence:${instrument.key}`);
    }
    if (
      !normalizeText(binding.providerSymbol) ||
      !normalizeText(binding.providerExchange)
    ) {
      blockers.add(`invalid_provider_binding:${instrument.key}`);
      continue;
    }
    normalizedBindings.push(
      Object.freeze({
        instrumentKey: instrument.key,
        providerSymbol: normalizeText(binding.providerSymbol)!,
        providerExchange: normalizeText(binding.providerExchange)!,
        evidenceStatus: binding.evidence.status,
      }),
    );
  }

  const coverage = {
    documentedCount: 0,
    runtimeObservedCount: 0,
    unprovenCount: 0,
    notSupportedCount: 0,
    missingInstrumentKeys: [] as string[],
  };
  for (const key of required.keys) {
    const binding = bindings.get(key);
    if (!binding) {
      coverage.missingInstrumentKeys.push(key);
      continue;
    }
    switch (binding.evidence.status) {
      case "documented":
        coverage.documentedCount += 1;
        break;
      case "runtime_observed":
        coverage.runtimeObservedCount += 1;
        break;
      case "unproven":
        coverage.unprovenCount += 1;
        break;
      case "not_supported":
        coverage.notSupportedCount += 1;
        break;
      default:
        blockers.add(`invalid_binding_evidence:${key}`);
    }
  }

  const claims = [
    candidate.entitlements?.fetch,
    candidate.entitlements?.store,
    candidate.entitlements?.display,
    candidate.entitlements?.multiUser,
    candidate.history?.rangeCapability,
    candidate.history?.pagination,
    candidate.history?.priceModel,
    candidate.history?.correctionPolicy,
    candidate.history?.duplicatePolicy,
  ];
  for (const claim of claims) {
    validateClaimSources(claim, sources, blockers);
  }
  for (const claim of [
    candidate.history?.rangeCapability,
    candidate.history?.pagination,
    candidate.history?.correctionPolicy,
    candidate.history?.duplicatePolicy,
  ]) {
    if (!isHistoryEvidenceStatus(claim?.status)) {
      blockers.add("invalid_history_evidence_status");
    }
  }
  for (const claim of [
    candidate.entitlements?.fetch,
    candidate.entitlements?.store,
    candidate.entitlements?.display,
    candidate.entitlements?.multiUser,
  ]) {
    if (!isEntitlementStatus(claim?.status)) {
      blockers.add("invalid_entitlement_status");
    }
  }

  if (!providerId) blockers.add("invalid_provider_id");
  if (input.duplicateProvider && providerId) {
    blockers.add(`duplicate_provider_id:${providerId}`);
  }
  if (!input.requestValid) blockers.add("invalid_review_request");
  if (!normalizeText(candidate.history?.endpointId)) {
    blockers.add("invalid_history_endpoint");
  }
  if (
    !["verified", "unproven", "failed"].includes(
      candidate.history?.requestedWindowCoverage,
    ) ||
    !["verified", "unproven", "failed"].includes(
      candidate.history?.corporateActionParity,
    )
  ) {
    blockers.add("invalid_verification_status");
  }

  const commercialStatus = aggregateCommercialStatus(candidate.entitlements);
  const priceModel = validPriceModel(candidate.history?.priceModel?.status);
  if (!priceModel) blockers.add("invalid_price_model");
  const nextAction = decideNextAction({
    invalid: blockers.size > 0,
    coverage,
    rangeCapability: candidate.history?.rangeCapability?.status,
    pagination: candidate.history?.pagination?.status,
    priceModel,
    commercialStatus,
    requestedWindowCoverage: candidate.history?.requestedWindowCoverage,
    corporateActionParity: candidate.history?.corporateActionParity,
    correctionPolicy: candidate.history?.correctionPolicy?.status,
    duplicatePolicy: candidate.history?.duplicatePolicy?.status,
  });

  return Object.freeze({
    providerId,
    validEvidence: blockers.size === 0,
    officialSources: Object.freeze(
      (candidate.officialSources ?? []).map((source) =>
        Object.freeze({ ...source }),
      ),
    ),
    instrumentBindings: Object.freeze(
      normalizedBindings.sort((left, right) =>
        left.instrumentKey.localeCompare(right.instrumentKey),
      ),
    ),
    instrumentCoverage: Object.freeze({
      requiredCount: required.keys.length,
      documentedCount: coverage.documentedCount,
      runtimeObservedCount: coverage.runtimeObservedCount,
      unprovenCount: coverage.unprovenCount,
      notSupportedCount: coverage.notSupportedCount,
      missingInstrumentKeys: Object.freeze([
        ...coverage.missingInstrumentKeys,
      ]),
    }),
    commercialStatus,
    priceModel,
    historyEvidence: Object.freeze({
      endpointId: normalizeText(candidate.history?.endpointId),
      rangeCapability: isHistoryEvidenceStatus(
        candidate.history?.rangeCapability?.status,
      )
        ? candidate.history.rangeCapability.status
        : null,
      pagination: isHistoryEvidenceStatus(
        candidate.history?.pagination?.status,
      )
        ? candidate.history.pagination.status
        : null,
      requestedWindowCoverage: isVerificationStatus(
        candidate.history?.requestedWindowCoverage,
      )
        ? candidate.history.requestedWindowCoverage
        : null,
      corporateActionParity: isVerificationStatus(
        candidate.history?.corporateActionParity,
      )
        ? candidate.history.corporateActionParity
        : null,
      correctionPolicy: isHistoryEvidenceStatus(
        candidate.history?.correctionPolicy?.status,
      )
        ? candidate.history.correctionPolicy.status
        : null,
      duplicatePolicy: isHistoryEvidenceStatus(
        candidate.history?.duplicatePolicy?.status,
      )
        ? candidate.history.duplicatePolicy.status
        : null,
    }),
    nextAction,
    blockers: Object.freeze([...blockers].sort()),
    providerCallAdmitted: false,
    sharedCacheWriteAdmitted: false,
  });
}

function decideNextAction(input: {
  invalid: boolean;
  coverage: {
    documentedCount: number;
    runtimeObservedCount: number;
    unprovenCount: number;
    notSupportedCount: number;
    missingInstrumentKeys: readonly string[];
  };
  rangeCapability: ProviderHistoryEvidenceStatus | undefined;
  pagination: ProviderHistoryEvidenceStatus | undefined;
  priceModel: ProviderHistoryPriceModel | null;
  commercialStatus: ProviderHistoryCandidateEvaluation["commercialStatus"];
  requestedWindowCoverage: ProviderHistoryVerificationStatus | undefined;
  corporateActionParity: ProviderHistoryVerificationStatus | undefined;
  correctionPolicy: ProviderHistoryEvidenceStatus | undefined;
  duplicatePolicy: ProviderHistoryEvidenceStatus | undefined;
}): ProviderHistoryNextAction {
  if (input.invalid) return "blocked_invalid_evidence";
  if (
    input.coverage.notSupportedCount > 0 ||
    input.rangeCapability === "not_supported"
  ) {
    return "reject_not_supported";
  }
  if (
    input.coverage.missingInstrumentKeys.length > 0 ||
    input.coverage.runtimeObservedCount > 0 ||
    input.coverage.unprovenCount > 0
  ) {
    return "confirm_exact_instrument_binding";
  }
  if (input.rangeCapability !== "documented") {
    return "confirm_historical_range_capability";
  }
  if (
    !input.priceModel ||
    !PROVIDER_HISTORY_SHORTLIST_POLICY.acceptedPriceModels.includes(
      input.priceModel as
        | "distribution_adjusted_documented"
        | "split_and_distribution_components_documented",
    )
  ) {
    return "confirm_total_return_price_model";
  }
  if (input.commercialStatus === "denied") return "reject_not_supported";
  if (input.commercialStatus !== "admitted") {
    return "request_written_commercial_terms";
  }
  if (
    input.pagination !== "documented" ||
    input.correctionPolicy !== "documented" ||
    input.duplicatePolicy !== "documented"
  ) {
    return "confirm_transport_and_correction_contract";
  }
  if (
    input.requestedWindowCoverage !== "verified" ||
    input.corporateActionParity !== "verified"
  ) {
    return "run_separately_authorized_bounded_payload_parity_trial";
  }
  return "ready_for_separate_adapter_review";
}
