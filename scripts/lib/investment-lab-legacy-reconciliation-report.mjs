const SCALE = 1_000_000n;

export const LEGACY_RECONCILIATION_CLASSES = Object.freeze([
  "numeric_evidence_incomplete",
  "position_value_incomplete",
  "position_identity_incomplete",
  "duplicate_explicit_position_identity",
  "cash_semantics_conflict",
  "portfolio_membership_evidence_incomplete",
  "portfolio_membership_count_conflict",
  "tickered_non_close_basis",
  "tickered_reference_date_incomplete",
  "usd_fx_reference_incomplete",
  "rounding_rule_unproven_small_delta",
  "unclassified",
]);

export const LEGACY_RECONCILIATION_EVIDENCE_POLICY = Object.freeze({
  version: "investment_lab_legacy_reconciliation_evidence_v1",
  purpose: "policy_evidence_not_equivalence_restoration",
  scope: "legacy_named_account_snapshot_native_evidence_only",
  interpretation: "mutually_exclusive_evidence_class_not_root_cause",
  roundingOnlyRequirement: "explicit_rule_evidence_plus_integer_snapshot_consistency",
  output: "count_only",
});

export const UNESTABLISHED_LEGACY_ROUNDING_EVIDENCE = Object.freeze({
  status: "not_established",
  policyId: null,
  portfolioRoundedOnce: false,
  positionsRoundedIndividually: false,
});

export function buildInvestmentLabLegacyReconciliationReport({
  rows,
  roundingEvidence = UNESTABLISHED_LEGACY_ROUNDING_EVIDENCE,
}) {
  const evidenceRows = Array.isArray(rows) ? rows : null;
  const classCounts = Object.fromEntries(
    LEGACY_RECONCILIATION_CLASSES.map((name) => [name, 0]),
  );
  let exactRows = 0;
  let roundingOnlyRows = 0;
  let materialMismatchRows = 0;
  let incompleteNumericRows = 0;
  let roundingRuleUnprovenSmallDeltaRows = 0;

  for (const row of evidenceRows ?? []) {
    const portfolio = parseFixed(row?.portfolio_total_krw);
    const cash = parseFixed(row?.cash_value_krw);
    const positions = parseFixed(row?.position_total_krw);
    const positionCount = safeCount(row?.position_count);
    const valuesComplete =
      safeCount(row?.valued_position_count) === positionCount &&
      safeCount(row?.missing_value_rows) === 0;

    if (
      portfolio !== null &&
      cash !== null &&
      positions !== null &&
      positionCount !== null &&
      valuesComplete
    ) {
      const delta = absolute(portfolio - cash - positions);
      if (delta === 0n) {
        exactRows += 1;
        continue;
      }

      if (
        isProvenRoundingOnly({
          row,
          portfolio,
          cash,
          positions,
          delta,
          positionCount,
          roundingEvidence,
        })
      ) {
        roundingOnlyRows += 1;
        continue;
      }

      if (delta <= roundingTolerance(positionCount)) {
        roundingRuleUnprovenSmallDeltaRows += 1;
      } else {
        materialMismatchRows += 1;
      }
    } else {
      incompleteNumericRows += 1;
    }

    classCounts[classifyEvidence(row, {
      portfolio,
      cash,
      positions,
      positionCount,
      valuesComplete,
      roundingRuleUnprovenSmallDelta:
        portfolio !== null &&
        cash !== null &&
        positions !== null &&
        positionCount !== null &&
        valuesComplete &&
        absolute(portfolio - cash - positions) <= roundingTolerance(positionCount),
    })] += 1;
  }

  const classifiedNonExactRows = sumCounts(classCounts);
  const legacyRows = evidenceRows?.length ?? 0;
  const expectedClassifiedRows = legacyRows - exactRows - roundingOnlyRows;
  const classificationComplete = classifiedNonExactRows === expectedClassifiedRows;

  return Object.freeze({
    audit: "investment_lab_legacy_reconciliation_evidence_classification",
    status:
      evidenceRows === null || evidenceRows.length === 0 || !classificationComplete
        ? "unavailable"
        : "complete",
    readOnly: true,
    policy: LEGACY_RECONCILIATION_EVIDENCE_POLICY,
    runtimeTrustStatus: "not_established",
    roundingEvidence: Object.freeze({
      status: isRoundingEvidenceEstablished(roundingEvidence)
        ? "established"
        : "not_established",
      policyId: stableText(roundingEvidence?.policyId) || null,
    }),
    counts: Object.freeze({
      legacyRows,
      exactRows,
      roundingOnlyRows,
      materialMismatchRows,
      incompleteNumericRows,
      classifiedNonExactRows,
      roundingRuleUnprovenSmallDeltaRows,
    }),
    classes: Object.freeze(classCounts),
    classificationComplete,
    sourceTransition: Object.freeze({
      status: "remains_contradictory",
      blocker: "portfolio_source_transition_unproven",
      authorityEffect: "none",
    }),
    specialHoldingBoundaries: Object.freeze({
      fount: "separate_exclusion_boundary_not_an_explanation",
      krxGold: "separate_close_only_boundary_not_an_explanation",
    }),
    decisionPolicy: Object.freeze({
      unexplainedStoredEvidence: "legacy_display_only",
      canonicalReconstruction: "requires_separate_policy_approval",
      providerBackfill: "requires_official_source_license_and_separate_approval",
    }),
    boundaries: Object.freeze({
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      runtimeImports: 0,
      pageOrUiChanges: 0,
    }),
  });
}

function classifyEvidence(row, parsed) {
  if (
    parsed.portfolio === null ||
    parsed.cash === null ||
    parsed.positions === null ||
    parsed.positionCount === null
  ) {
    return "numeric_evidence_incomplete";
  }
  if (!parsed.valuesComplete) return "position_value_incomplete";
  if ((safeCount(row?.missing_legacy_identity_rows) ?? 0) > 0) {
    return "position_identity_incomplete";
  }
  if ((safeCount(row?.duplicate_identity_count) ?? 0) > 0) {
    return "duplicate_explicit_position_identity";
  }
  if (parsed.cash !== 0n) return "cash_semantics_conflict";

  const portfolioCount = safeCount(row?.num_assets);
  if (portfolioCount === null) return "portfolio_membership_evidence_incomplete";
  if (portfolioCount !== parsed.positionCount) {
    return "portfolio_membership_count_conflict";
  }
  if ((safeCount(row?.tickered_non_close_rows) ?? 0) > 0) {
    return "tickered_non_close_basis";
  }
  if ((safeCount(row?.missing_tickered_reference_date_rows) ?? 0) > 0) {
    return "tickered_reference_date_incomplete";
  }
  if ((safeCount(row?.incomplete_usd_fx_rows) ?? 0) > 0) {
    return "usd_fx_reference_incomplete";
  }
  if (parsed.roundingRuleUnprovenSmallDelta) {
    return "rounding_rule_unproven_small_delta";
  }
  return "unclassified";
}

function isProvenRoundingOnly({
  row,
  portfolio,
  cash,
  positions,
  delta,
  positionCount,
  roundingEvidence,
}) {
  if (!isRoundingEvidenceEstablished(roundingEvidence)) return false;
  if (delta > roundingTolerance(positionCount)) return false;
  if (!isWholeKrw(portfolio) || !isWholeKrw(cash) || !isWholeKrw(positions)) {
    return false;
  }
  if ((safeCount(row?.fractional_value_rows) ?? -1) !== 0) return false;
  if ((safeCount(row?.missing_legacy_identity_rows) ?? -1) !== 0) return false;
  if ((safeCount(row?.duplicate_identity_count) ?? -1) !== 0) return false;
  if ((safeCount(row?.tickered_non_close_rows) ?? -1) !== 0) return false;
  if ((safeCount(row?.missing_tickered_reference_date_rows) ?? -1) !== 0) return false;
  if ((safeCount(row?.incomplete_usd_fx_rows) ?? -1) !== 0) return false;
  return safeCount(row?.num_assets) === positionCount;
}

function isRoundingEvidenceEstablished(evidence) {
  return (
    evidence?.status === "established" &&
    stableText(evidence.policyId) !== "" &&
    evidence.portfolioRoundedOnce === true &&
    evidence.positionsRoundedIndividually === true
  );
}

function roundingTolerance(positionCount) {
  return BigInt(positionCount + 1) * (SCALE / 2n);
}

function isWholeKrw(value) {
  return value % SCALE === 0n;
}

function parseFixed(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(match[2]) * SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function safeCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function stableText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function absolute(value) {
  return value < 0n ? -value : value;
}

function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}
