export const HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY = Object.freeze({
  version: "history_coverage_manifest_validator_v1",
  validationScope: "shape_and_supported_fixture_only",
  runtimeTrust: "not_established",
  approvalRecordRuntimeTrust: "forbidden",
  markdownImport: "forbidden",
  implementedModes: Object.freeze(["observed_only"] as const),
  supportedCandidate: Object.freeze({
    manifestVersion: "portfolio-brokerage-observed-v1",
    sourceAuthority: "stored_daily_portfolio_snapshots_display_evidence_v1",
    lane: "portfolio",
    account: "brokerage",
    mode: "observed_only",
  }),
  supportedValidationEvidence: Object.freeze([
    "portfolio_named_account_source_summary_read_2026-07-12",
    "repository_data_integrity_audit_2026-07-12T00:47:06.560Z",
  ]),
  observedOnlyForbiddenFields: Object.freeze([
    "coverageStartDate",
    "coverageEndDate",
    "explicitDates",
    "serviceDatePolicyVersion",
    "activeComponentsByDate",
    "approvedSkipDates",
    "requiredDates",
  ] as const),
} as const);

export type HistoryCoverageManifestLane = "balance" | "portfolio";
export type HistoryCoverageManifestAccount =
  | "brokerage"
  | "isa"
  | "irp"
  | "all";
export type HistoryCoverageManifestMode =
  | "observed_only"
  | "explicit_date_list"
  | "declared_service_schedule";

export type HistoryCoverageManifestValidationIssueCode =
  | "account_invalid"
  | "lane_invalid"
  | "manifest_identity_unsupported"
  | "manifest_not_object"
  | "manifest_version_invalid"
  | "mode_invalid"
  | "mode_not_implemented"
  | "observed_only_forbidden_field"
  | "source_authority_invalid"
  | "unknown_field"
  | "validation_evidence_duplicate"
  | "validation_evidence_invalid"
  | "validation_evidence_unsupported";

export type HistoryCoverageManifestValidationIssue = Readonly<{
  code: HistoryCoverageManifestValidationIssueCode;
  field: string | null;
}>;

export type ValidatedHistoryCoverageManifest = Readonly<{
  manifestVersion: "portfolio-brokerage-observed-v1";
  sourceAuthority: "stored_daily_portfolio_snapshots_display_evidence_v1";
  lane: "portfolio";
  account: "brokerage";
  mode: "observed_only";
  validationEvidence: readonly string[];
}>;

const CORE_FIELDS = Object.freeze([
  "manifestVersion",
  "sourceAuthority",
  "lane",
  "account",
  "mode",
] as const);
const OPTIONAL_FIELDS = Object.freeze(["validationEvidence"] as const);
const CONTRACT_MODES = new Set<HistoryCoverageManifestMode>([
  "observed_only",
  "explicit_date_list",
  "declared_service_schedule",
]);
const LANES = new Set<HistoryCoverageManifestLane>(["balance", "portfolio"]);
const ACCOUNTS = new Set<HistoryCoverageManifestAccount>([
  "brokerage",
  "isa",
  "irp",
  "all",
]);

export function validateHistoryCoverageManifest(input: unknown) {
  if (!isPlainObject(input)) {
    return blockedResult({
      shapeIssues: [issue("manifest_not_object", null)],
      supportIssue: issue("manifest_identity_unsupported", null),
    });
  }

  const manifest = input as Record<string, unknown>;
  const shapeIssues: HistoryCoverageManifestValidationIssue[] = [];
  validateCoreFields(manifest, shapeIssues);
  validateKnownFields(manifest, shapeIssues);
  validateModeFields(manifest, shapeIssues);
  const validationEvidence = validateValidationEvidence(manifest, shapeIssues);
  const isSupported = matchesSupportedCandidate(manifest);
  const supportIssue = isSupported
    ? null
    : issue("manifest_identity_unsupported", null);

  if (shapeIssues.length > 0 || !isSupported) {
    return blockedResult({ shapeIssues, supportIssue });
  }

  const supported = HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.supportedCandidate;
  return Object.freeze({
    status: "valid_supported_fixture" as const,
    shapeStatus: "valid" as const,
    supportStatus: "supported_fixture" as const,
    runtimeTrustStatus:
      HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.runtimeTrust,
    policy: HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY,
    manifest: Object.freeze({
      ...supported,
      validationEvidence: Object.freeze(validationEvidence),
    }) as ValidatedHistoryCoverageManifest,
    issues: Object.freeze([]) as readonly HistoryCoverageManifestValidationIssue[],
  });
}

function validateCoreFields(
  manifest: Record<string, unknown>,
  issues: HistoryCoverageManifestValidationIssue[],
) {
  if (!isNonEmptyString(manifest.manifestVersion)) {
    issues.push(issue("manifest_version_invalid", "manifestVersion"));
  }
  if (!isNonEmptyString(manifest.sourceAuthority)) {
    issues.push(issue("source_authority_invalid", "sourceAuthority"));
  }
  if (!LANES.has(manifest.lane as HistoryCoverageManifestLane)) {
    issues.push(issue("lane_invalid", "lane"));
  }
  if (!ACCOUNTS.has(manifest.account as HistoryCoverageManifestAccount)) {
    issues.push(issue("account_invalid", "account"));
  }
  if (!CONTRACT_MODES.has(manifest.mode as HistoryCoverageManifestMode)) {
    issues.push(issue("mode_invalid", "mode"));
  }
}

function validateKnownFields(
  manifest: Record<string, unknown>,
  issues: HistoryCoverageManifestValidationIssue[],
) {
  const knownFields = new Set<string>([
    ...CORE_FIELDS,
    ...OPTIONAL_FIELDS,
    ...HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.observedOnlyForbiddenFields,
  ]);
  if (Object.keys(manifest).some((field) => !knownFields.has(field))) {
    issues.push(issue("unknown_field", null));
  }
}

function validateModeFields(
  manifest: Record<string, unknown>,
  issues: HistoryCoverageManifestValidationIssue[],
) {
  if (manifest.mode === "observed_only") {
    for (const field of HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY
      .observedOnlyForbiddenFields) {
      if (hasOwn(manifest, field)) {
        issues.push(issue("observed_only_forbidden_field", field));
      }
    }
    return;
  }
  if (CONTRACT_MODES.has(manifest.mode as HistoryCoverageManifestMode)) {
    issues.push(issue("mode_not_implemented", "mode"));
  }
}

function validateValidationEvidence(
  manifest: Record<string, unknown>,
  issues: HistoryCoverageManifestValidationIssue[],
) {
  if (!hasOwn(manifest, "validationEvidence")) return [];
  if (!Array.isArray(manifest.validationEvidence)) {
    issues.push(issue("validation_evidence_invalid", "validationEvidence"));
    return [];
  }

  const values = manifest.validationEvidence;
  if (!values.every(isNonEmptyString)) {
    issues.push(issue("validation_evidence_invalid", "validationEvidence"));
    return [];
  }
  const normalized = values.map((value) => value.trim()).sort();
  if (new Set(normalized).size !== normalized.length) {
    issues.push(issue("validation_evidence_duplicate", "validationEvidence"));
  }
  const supported = new Set<string>(
    HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.supportedValidationEvidence,
  );
  if (normalized.some((value) => !supported.has(value))) {
    issues.push(issue("validation_evidence_unsupported", "validationEvidence"));
  }
  return normalized;
}

function matchesSupportedCandidate(manifest: Record<string, unknown>) {
  const supported = HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.supportedCandidate;
  return CORE_FIELDS.every((field) => manifest[field] === supported[field]);
}

function blockedResult({
  shapeIssues,
  supportIssue,
}: {
  shapeIssues: readonly HistoryCoverageManifestValidationIssue[];
  supportIssue: HistoryCoverageManifestValidationIssue | null;
}) {
  const issues = uniqueSortedIssues([
    ...shapeIssues,
    ...(supportIssue ? [supportIssue] : []),
  ]);
  return Object.freeze({
    status: "blocked" as const,
    shapeStatus: shapeIssues.length === 0 ? ("valid" as const) : ("blocked" as const),
    supportStatus:
      supportIssue === null
        ? ("supported_fixture" as const)
        : ("unsupported" as const),
    runtimeTrustStatus:
      HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.runtimeTrust,
    policy: HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY,
    manifest: null,
    issues: Object.freeze(issues),
  });
}

function issue(
  code: HistoryCoverageManifestValidationIssueCode,
  field: string | null,
): HistoryCoverageManifestValidationIssue {
  return Object.freeze({ code, field });
}

function uniqueSortedIssues(
  issues: readonly HistoryCoverageManifestValidationIssue[],
) {
  const keyed = new Map(
    issues.map((row) => [`${row.code}|${row.field ?? ""}`, row]),
  );
  return [...keyed.values()].sort((left, right) => {
    const codeOrder = left.code.localeCompare(right.code);
    return codeOrder !== 0
      ? codeOrder
      : (left.field ?? "").localeCompare(right.field ?? "");
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
