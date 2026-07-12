export const HISTORICAL_EVIDENCE_COMPLETENESS_POLICY = Object.freeze({
  version: "historical_evidence_completeness_consumer_eligibility_v1",
  rawEvidenceMutation: "forbidden",
  providerBackfillKind: "source_evidence",
  reconstructionKind: "derived_evidence",
  displayEstimateUsage: "display_only",
  silentDrop: "forbidden",
  zeroFill: "forbidden",
  confidenceScore: "not_defined",
  calculationDefault: "observed_or_provider_backfilled_only",
} as const);

export const HISTORICAL_EVIDENCE_CONSUMERS = Object.freeze([
  "dashboard",
  "today_movement",
  "history",
  "portfolio_structure",
  "additional_contribution",
  "portfolio_risk",
  "investment_lab",
  "simulation_validation",
  "optimizer",
] as const);

export type HistoricalEvidenceKind =
  | "observed"
  | "provider_backfilled"
  | "reconstructed"
  | "display_estimated"
  | "missing"
  | "ambiguous"
  | "invalid";

export type HistoricalEvidenceConsumer =
  (typeof HISTORICAL_EVIDENCE_CONSUMERS)[number];

export type HistoricalEvidenceConsumerKind = "display" | "calculation";

export type HistoricalEvidenceRequirement = Readonly<{
  key: string;
  evidenceKind: HistoricalEvidenceKind;
  source: string | null;
  asOfDate: string;
  sourceDates: readonly string[];
  methodVersion: string | null;
  reason: string | null;
}>;

export type HistoricalEvidenceIssue =
  | "duplicate_requirement_key"
  | "invalid_as_of_date"
  | "invalid_evidence_kind"
  | "invalid_requirement_key"
  | "invalid_source_date"
  | "method_version_required"
  | "reason_required"
  | "source_date_required"
  | "source_required";

export type HistoricalEvidenceUsage =
  | "canonical"
  | "approved_reconstruction"
  | "derived_display"
  | "display_only"
  | "gap";

export type HistoricalEvidenceEligibilityReason =
  | "observed_evidence"
  | "provider_backfilled_evidence"
  | "reconstruction_allowed_for_display"
  | "reconstruction_method_approved"
  | "reconstruction_not_approved"
  | "display_estimate_allowed_for_display"
  | "display_estimate_forbidden_for_calculation"
  | "evidence_missing"
  | "evidence_ambiguous"
  | "evidence_invalid";

export type HistoricalEvidenceClassification = Readonly<{
  key: string | null;
  consumer: HistoricalEvidenceConsumer;
  consumerKind: HistoricalEvidenceConsumerKind;
  requestedEvidenceKind: HistoricalEvidenceKind;
  effectiveEvidenceKind: HistoricalEvidenceKind;
  eligible: boolean;
  usage: HistoricalEvidenceUsage;
  disclosureRequired: boolean;
  eligibilityReason: HistoricalEvidenceEligibilityReason;
  lineage: Readonly<{
    source: string | null;
    asOfDate: string | null;
    sourceDates: readonly string[];
    methodVersion: string | null;
    reason: string | null;
  }>;
  issues: readonly HistoricalEvidenceIssue[];
}>;

export type HistoricalEvidenceSummaryStatus =
  | "ready"
  | "partial"
  | "unavailable"
  | "blocked";

const DISPLAY_CONSUMERS = new Set<HistoricalEvidenceConsumer>([
  "dashboard",
  "today_movement",
  "history",
  "portfolio_structure",
]);
const EVIDENCE_KINDS = new Set<HistoricalEvidenceKind>([
  "observed",
  "provider_backfilled",
  "reconstructed",
  "display_estimated",
  "missing",
  "ambiguous",
  "invalid",
]);

export function classifyHistoricalEvidenceForConsumer(input: {
  requirement: HistoricalEvidenceRequirement;
  consumer: HistoricalEvidenceConsumer;
  approvedReconstructionMethodVersions?: readonly string[];
}): HistoricalEvidenceClassification {
  return classifyRequirement({
    ...input,
    duplicateKey: false,
  });
}

export function summarizeHistoricalEvidenceForConsumer(input: {
  requirements: readonly HistoricalEvidenceRequirement[];
  consumer: HistoricalEvidenceConsumer;
  approvedReconstructionMethodVersions?: readonly string[];
}) {
  const requirements = Array.isArray(input.requirements)
    ? input.requirements
    : [];
  const keyCounts = new Map<string, number>();
  for (const requirement of requirements) {
    const key = normalizeText(requirement?.key);
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }

  const rows = requirements
    .map((requirement) => {
      const key = normalizeText(requirement?.key);
      return classifyRequirement({
        requirement,
        consumer: input.consumer,
        approvedReconstructionMethodVersions:
          input.approvedReconstructionMethodVersions,
        duplicateKey: key !== null && (keyCounts.get(key) ?? 0) > 1,
      });
    })
    .sort(compareClassifications);
  const consumerKind = consumerKindFor(input.consumer);
  const requiredCount = rows.length;
  const eligibleCount = rows.filter((row) => row.eligible).length;
  const canonicalCount = rows.filter(
    (row) =>
      row.effectiveEvidenceKind === "observed" ||
      row.effectiveEvidenceKind === "provider_backfilled",
  ).length;
  const reconstructedCount = rows.filter(
    (row) => row.effectiveEvidenceKind === "reconstructed",
  ).length;
  const displayEstimatedCount = rows.filter(
    (row) => row.effectiveEvidenceKind === "display_estimated",
  ).length;
  const disclosureRequiredCount = rows.filter(
    (row) => row.disclosureRequired,
  ).length;
  const gapCount = requiredCount - eligibleCount;
  const status = summarizeStatus({
    consumerKind,
    requiredCount,
    eligibleCount,
    reconstructedCount,
    displayEstimatedCount,
  });

  return Object.freeze({
    status,
    policy: HISTORICAL_EVIDENCE_COMPLETENESS_POLICY,
    consumer: input.consumer,
    consumerKind,
    coverage: Object.freeze({
      requiredCount,
      eligibleCount,
      canonicalCount,
      reconstructedCount,
      displayEstimatedCount,
      disclosureRequiredCount,
      gapCount,
      canonicalCoveragePct: percentage(canonicalCount, requiredCount),
      consumerCoveragePct: percentage(eligibleCount, requiredCount),
    }),
    gapDates: Object.freeze(
      uniqueSorted(
        rows
          .filter((row) => !row.eligible)
          .flatMap((row) => (row.lineage.asOfDate ? [row.lineage.asOfDate] : [])),
      ),
    ),
    estimatedDates: Object.freeze(
      uniqueSorted(
        rows
          .filter(
            (row) => row.effectiveEvidenceKind === "display_estimated",
          )
          .flatMap((row) => (row.lineage.asOfDate ? [row.lineage.asOfDate] : [])),
      ),
    ),
    reasons: Object.freeze(
      uniqueSorted(
        rows.flatMap((row) => [
          row.eligibilityReason,
          ...row.issues,
          ...(row.lineage.reason ? [row.lineage.reason] : []),
        ]),
      ),
    ),
    rows: Object.freeze(rows),
  });
}

function classifyRequirement({
  requirement,
  consumer,
  approvedReconstructionMethodVersions = [],
  duplicateKey,
}: {
  requirement: HistoricalEvidenceRequirement;
  consumer: HistoricalEvidenceConsumer;
  approvedReconstructionMethodVersions?: readonly string[];
  duplicateKey: boolean;
}): HistoricalEvidenceClassification {
  const key = normalizeText(requirement?.key);
  const requestedEvidenceKind = EVIDENCE_KINDS.has(requirement?.evidenceKind)
    ? requirement.evidenceKind
    : "invalid";
  const source = normalizeText(requirement?.source);
  const asOfDate = normalizeDate(requirement?.asOfDate);
  const sourceDateInputs = Array.isArray(requirement?.sourceDates)
    ? requirement.sourceDates
    : [];
  const sourceDates = uniqueSorted(
    sourceDateInputs.flatMap((value) => {
      const normalized = normalizeDate(value);
      return normalized ? [normalized] : [];
    }),
  );
  const methodVersion = normalizeText(requirement?.methodVersion);
  const reason = normalizeText(requirement?.reason);
  const issues = new Set<HistoricalEvidenceIssue>();

  if (!key) issues.add("invalid_requirement_key");
  if (!asOfDate) issues.add("invalid_as_of_date");
  if (!EVIDENCE_KINDS.has(requirement?.evidenceKind)) {
    issues.add("invalid_evidence_kind");
  }
  if (duplicateKey) issues.add("duplicate_requirement_key");
  if (sourceDateInputs.some((value) => normalizeDate(value) === null)) {
    issues.add("invalid_source_date");
  }

  if (
    requestedEvidenceKind === "observed" ||
    requestedEvidenceKind === "provider_backfilled" ||
    requestedEvidenceKind === "reconstructed" ||
    requestedEvidenceKind === "display_estimated"
  ) {
    if (!source) issues.add("source_required");
    if (sourceDates.length === 0) issues.add("source_date_required");
  }
  if (
    requestedEvidenceKind === "provider_backfilled" ||
    requestedEvidenceKind === "reconstructed" ||
    requestedEvidenceKind === "display_estimated"
  ) {
    if (!methodVersion) issues.add("method_version_required");
  }
  if (
    requestedEvidenceKind === "missing" ||
    requestedEvidenceKind === "ambiguous" ||
    requestedEvidenceKind === "invalid"
  ) {
    if (!reason) issues.add("reason_required");
  }

  const effectiveEvidenceKind: HistoricalEvidenceKind =
    issues.size > 0 ? "invalid" : requestedEvidenceKind;
  const consumerKind = consumerKindFor(consumer);
  const decision = eligibilityDecision({
    evidenceKind: effectiveEvidenceKind,
    consumerKind,
    methodVersion,
    approvedReconstructionMethodVersions,
  });

  return Object.freeze({
    key,
    consumer,
    consumerKind,
    requestedEvidenceKind,
    effectiveEvidenceKind,
    eligible: decision.eligible,
    usage: decision.usage,
    disclosureRequired: decision.disclosureRequired,
    eligibilityReason: decision.eligibilityReason,
    lineage: Object.freeze({
      source,
      asOfDate,
      sourceDates: Object.freeze(sourceDates),
      methodVersion,
      reason,
    }),
    issues: Object.freeze([...issues].sort()),
  });
}

function eligibilityDecision({
  evidenceKind,
  consumerKind,
  methodVersion,
  approvedReconstructionMethodVersions,
}: {
  evidenceKind: HistoricalEvidenceKind;
  consumerKind: HistoricalEvidenceConsumerKind;
  methodVersion: string | null;
  approvedReconstructionMethodVersions: readonly string[];
}): Pick<
  HistoricalEvidenceClassification,
  "eligible" | "usage" | "disclosureRequired" | "eligibilityReason"
> {
  if (evidenceKind === "observed") {
    return decision(true, "canonical", false, "observed_evidence");
  }
  if (evidenceKind === "provider_backfilled") {
    return decision(
      true,
      "canonical",
      true,
      "provider_backfilled_evidence",
    );
  }
  if (evidenceKind === "reconstructed") {
    if (consumerKind === "display") {
      return decision(
        true,
        "derived_display",
        true,
        "reconstruction_allowed_for_display",
      );
    }
    const approved =
      methodVersion !== null &&
      approvedReconstructionMethodVersions
        .map(normalizeText)
        .filter((value): value is string => value !== null)
        .includes(methodVersion);
    return approved
      ? decision(
          true,
          "approved_reconstruction",
          true,
          "reconstruction_method_approved",
        )
      : decision(
          false,
          "gap",
          true,
          "reconstruction_not_approved",
        );
  }
  if (evidenceKind === "display_estimated") {
    return consumerKind === "display"
      ? decision(
          true,
          "display_only",
          true,
          "display_estimate_allowed_for_display",
        )
      : decision(
          false,
          "gap",
          true,
          "display_estimate_forbidden_for_calculation",
        );
  }
  if (evidenceKind === "missing") {
    return decision(false, "gap", true, "evidence_missing");
  }
  if (evidenceKind === "ambiguous") {
    return decision(false, "gap", true, "evidence_ambiguous");
  }
  return decision(false, "gap", true, "evidence_invalid");
}

function decision(
  eligible: boolean,
  usage: HistoricalEvidenceUsage,
  disclosureRequired: boolean,
  eligibilityReason: HistoricalEvidenceEligibilityReason,
) {
  return { eligible, usage, disclosureRequired, eligibilityReason } as const;
}

function consumerKindFor(
  consumer: HistoricalEvidenceConsumer,
): HistoricalEvidenceConsumerKind {
  return DISPLAY_CONSUMERS.has(consumer) ? "display" : "calculation";
}

function summarizeStatus({
  consumerKind,
  requiredCount,
  eligibleCount,
  reconstructedCount,
  displayEstimatedCount,
}: {
  consumerKind: HistoricalEvidenceConsumerKind;
  requiredCount: number;
  eligibleCount: number;
  reconstructedCount: number;
  displayEstimatedCount: number;
}): HistoricalEvidenceSummaryStatus {
  if (consumerKind === "calculation") {
    return requiredCount > 0 && eligibleCount === requiredCount
      ? "ready"
      : "blocked";
  }
  if (requiredCount === 0 || eligibleCount === 0) return "unavailable";
  if (
    eligibleCount === requiredCount &&
    reconstructedCount === 0 &&
    displayEstimatedCount === 0
  ) {
    return "ready";
  }
  return "partial";
}

function compareClassifications(
  left: HistoricalEvidenceClassification,
  right: HistoricalEvidenceClassification,
) {
  const keyOrder = (left.key ?? "").localeCompare(right.key ?? "");
  if (keyOrder !== 0) return keyOrder;
  return (left.lineage.asOfDate ?? "").localeCompare(
    right.lineage.asOfDate ?? "",
  );
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}
