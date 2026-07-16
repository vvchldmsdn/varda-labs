const LEGACY_SOURCE = "base44_import";
const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const NAMED_ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"]);
const SCALE = 1_000_000n;

// Re-review both writers before changing these pinned provenance findings.
export const DEFAULT_SOURCE_TRANSITION_WRITER_REVIEW = Object.freeze({
  reviewBasis: "reviewed_writer_and_import_code",
  scope: "observed_total_market_value_path_only",
  sharedSemantics: Object.freeze([
    "service_day_changes_at_07_kst",
    "named_account_scope",
    "open_investment_position_scope",
    "zero_cash_snapshot_scope",
    "quantity_price_fx_plus_fractional_value_formula",
    "all_is_derived_named_account_sum",
  ]),
  conflicts: Object.freeze([
    "domestic_reference_calendar_contract_differs",
    "fx_reference_date_contract_differs",
    "valuation_rounding_contract_differs",
  ]),
});

export const SOURCE_TRANSITION_EQUIVALENCE_AUDIT_POLICY = Object.freeze({
  version: "investment_lab_source_transition_equivalence_v1",
  resultStates: Object.freeze([
    "equivalent_proven",
    "equivalence_unproven",
    "contradictory",
  ]),
  canonicalAggregate: "derived_named_account_sum",
  storedAllAuthority: "optional_reconciliation_evidence_only",
  flowAuthority: "independent_event_ledger",
  runtimeIntegration: "not_established",
  output: "aggregate_diagnostics_only",
});

export function buildInvestmentLabSourceTransitionReport({
  evidence,
  fountReadiness,
  writerReview = DEFAULT_SOURCE_TRANSITION_WRITER_REVIEW,
}) {
  const unproven = new Set();
  const contradictions = new Set();
  const segmentRows = nullableArray(evidence?.segmentRows);
  const axisRows = nullableArray(evidence?.axisRows);
  const transitionRows = nullableArray(evidence?.transitionRows);
  const reconciliationRows = nullableArray(evidence?.reconciliationRows);
  const basisRows = nullableArray(evidence?.basisRows);
  const allRows = nullableArray(evidence?.allRows);

  if (
    [segmentRows, axisRows, transitionRows, reconciliationRows, basisRows, allRows].some(
      (rows) => rows === null,
    )
  ) {
    unproven.add("select_evidence_unavailable");
  }

  const segments = segmentRows ?? [];
  const sources = new Set(segments.map((row) => stableText(row.source)));
  const unknownSources = [...sources].filter(
    (source) => source !== LEGACY_SOURCE && source !== CURRENT_SOURCE,
  );
  const legacySegments = segments.filter(
    (row) => stableText(row.source) === LEGACY_SOURCE,
  );
  const currentSegments = segments.filter(
    (row) => stableText(row.source) === CURRENT_SOURCE,
  );

  if (legacySegments.length === 0 || currentSegments.length === 0) {
    unproven.add("expected_source_segment_missing");
  }
  if (unknownSources.length > 0) contradictions.add("unknown_source_segment_present");

  const legacyProvenance =
    legacySegments.length === NAMED_ACCOUNTS.length &&
    legacySegments.every((row) => {
      const rowCount = safeCount(row.row_count);
      return (
        rowCount !== null &&
        safeCount(row.imported_identity_rows) === rowCount &&
        safeCount(row.generated_identity_rows) === 0
      );
    });
  const currentProvenance =
    currentSegments.length === NAMED_ACCOUNTS.length &&
    currentSegments.every((row) => {
      const rowCount = safeCount(row.row_count);
      return (
        rowCount !== null &&
        safeCount(row.generated_identity_rows) === rowCount &&
        safeCount(row.imported_identity_rows) === 0 &&
        safeCount(row.rule_version_rows) === rowCount
      );
    });
  if (legacySegments.length > 0 && !legacyProvenance) {
    unproven.add("legacy_import_provenance_unproven");
  }
  if (currentSegments.length > 0 && !currentProvenance) {
    unproven.add("current_writer_provenance_unproven");
  }

  const axis = axisRows ?? [];
  const invalidAxisDates = axis.filter(
    (row) =>
      safeCount(row.named_row_count) !== NAMED_ACCOUNTS.length ||
      safeCount(row.account_count) !== NAMED_ACCOUNTS.length ||
      safeCount(row.unknown_source_rows) > 0,
  ).length;
  if (axis.length === 0) unproven.add("audit_axis_missing");
  if (invalidAxisDates > 0) contradictions.add("account_axis_conflict");

  const transitions = transitionRows ?? [];
  const transitionAccounts = new Set(
    transitions.map((row) => stableText(row.account)).filter(Boolean),
  );
  const transitionDates = new Set(
    transitions.map((row) => stableText(row.snapshot_date)).filter(Boolean),
  );
  const invalidTransitionRows = transitions.filter(
    (row) =>
      stableText(row.previous_source) !== LEGACY_SOURCE ||
      stableText(row.source) !== CURRENT_SOURCE ||
      !NAMED_ACCOUNTS.includes(stableText(row.account)),
  ).length;
  if (transitions.length === 0) unproven.add("source_transition_not_observed");
  if (
    transitions.length > 0 &&
    (transitions.length !== NAMED_ACCOUNTS.length ||
      transitionAccounts.size !== NAMED_ACCOUNTS.length ||
      transitionDates.size !== 1)
  ) {
    contradictions.add("source_transition_shape_conflict");
  }
  if (invalidTransitionRows > 0) contradictions.add("source_transition_direction_conflict");

  const reconciliations = reconciliationRows ?? [];
  const reconciliationSummary = summarizeReconciliations(reconciliations);
  const legacyReconciliation = summarizeReconciliations(
    reconciliations.filter((row) => stableText(row.source) === LEGACY_SOURCE),
  );
  const currentReconciliation = summarizeReconciliations(
    reconciliations.filter((row) => stableText(row.source) === CURRENT_SOURCE),
  );

  if (reconciliations.length === 0) unproven.add("portfolio_reconciliation_missing");
  if (reconciliationSummary.invalidAmountRows > 0) {
    unproven.add("portfolio_amount_evidence_invalid");
  }
  if (reconciliationSummary.mismatchRows > 0) {
    contradictions.add("position_portfolio_reconciliation_conflict");
  }
  if (reconciliationSummary.nonZeroCashRows > 0) {
    contradictions.add("cash_semantics_conflict");
  }
  if (reconciliationSummary.duplicatePositionIdentityGroups > 0) {
    contradictions.add("duplicate_position_identity_conflict");
  }

  const basis = basisRows ?? [];
  const basisTotals = sumBasisRows(basis);
  if (basis.length === 0) unproven.add("position_basis_evidence_missing");
  if (basisTotals.tickeredNonCloseRows > 0) {
    contradictions.add("tickered_non_close_position_present");
  }
  if (
    basisTotals.missingTickeredReferenceDateRows > 0 ||
    basisTotals.invalidUsdFxRows > 0 ||
    basisTotals.missingUsdFxReferenceRows > 0
  ) {
    unproven.add("position_price_or_fx_provenance_incomplete");
  }

  const storedAll = allRows ?? [];
  let storedAllRows = 0;
  let storedAllDuplicateDates = 0;
  let storedAllReconciledRows = 0;
  let storedAllMismatchRows = 0;
  for (const row of storedAll) {
    const storedCount = safeCount(row.stored_row_count);
    if (storedCount === null) {
      unproven.add("stored_all_evidence_invalid");
      continue;
    }
    if (storedCount === 0) continue;
    storedAllRows += storedCount;
    if (storedCount > 1) storedAllDuplicateDates += 1;
    const derived = parseFixed(row.derived_total_krw);
    const stored = parseFixed(row.stored_total_krw);
    const storedMax = parseFixed(row.stored_total_max_krw);
    if (derived === null || stored === null || storedMax === null) {
      unproven.add("stored_all_evidence_invalid");
      continue;
    }
    if (stored === storedMax && absolute(derived - stored) <= 1n) {
      storedAllReconciledRows += 1;
    } else {
      storedAllMismatchRows += 1;
    }
  }
  if (storedAllDuplicateDates > 0 || storedAllMismatchRows > 0) {
    contradictions.add("stored_all_reconciliation_conflict");
  }

  const fountBlockers = Array.isArray(fountReadiness?.transformer?.blockers)
    ? fountReadiness.transformer.blockers
    : null;
  const sourceTransitionOnlyFountBlock =
    fountReadiness?.status === "blocked" &&
    fountReadiness?.binding?.exactBindingResolved === true &&
    fountBlockers?.length === 1 &&
    fountBlockers[0] === "portfolio_source_transition_unproven";
  if (!sourceTransitionOnlyFountBlock) {
    unproven.add("fount_event_or_binding_boundary_unproven");
  }

  const writerConflicts = Array.isArray(writerReview?.conflicts)
    ? uniqueStrings(writerReview.conflicts)
    : [];
  if (writerConflicts.length > 0) contradictions.add("writer_contract_contradictory");
  if (!Array.isArray(writerReview?.sharedSemantics) || writerReview.sharedSemantics.length === 0) {
    unproven.add("writer_contract_review_missing");
  }

  const contradictionList = [...contradictions].sort();
  const unprovenList = [...unproven].sort();
  const status =
    contradictionList.length > 0
      ? "contradictory"
      : unprovenList.length > 0
        ? "equivalence_unproven"
        : "equivalent_proven";

  return Object.freeze({
    audit: "investment_lab_source_transition_equivalence",
    status,
    readOnly: true,
    policy: SOURCE_TRANSITION_EQUIVALENCE_AUDIT_POLICY,
    runtimeTrustStatus: "not_established",
    writerContract: Object.freeze({
      reviewBasis: stableText(writerReview?.reviewBasis) || "unavailable",
      scope: stableText(writerReview?.scope) || "unavailable",
      sharedSemanticCount: Array.isArray(writerReview?.sharedSemantics)
        ? writerReview.sharedSemantics.length
        : 0,
      conflictCount: writerConflicts.length,
      conflicts: Object.freeze(writerConflicts),
    }),
    sourceEvidence: Object.freeze({
      sourceSegmentCount: sources.size,
      expectedSourceSegmentCount: 2,
      legacyImportProvenanceResolved: legacyProvenance,
      currentWriterProvenanceResolved: currentProvenance,
      transitionCount: transitions.length,
      transitionAccountCount: transitionAccounts.size,
      transitionDateCount: transitionDates.size,
      invalidTransitionRows,
    }),
    axis: Object.freeze({
      dateCount: axis.length,
      invalidDateCount: invalidAxisDates,
      startDate: firstDate(axis),
      endDate: lastDate(axis),
    }),
    reconciliation: Object.freeze({
      ...reconciliationSummary,
      segments: Object.freeze({
        legacyImport: Object.freeze({
          ...legacyReconciliation,
          accounts: Object.freeze(summarizeReconciliationAccounts(
            reconciliations.filter((row) => stableText(row.source) === LEGACY_SOURCE),
          )),
        }),
        currentWriter: Object.freeze({
          ...currentReconciliation,
          accounts: Object.freeze(summarizeReconciliationAccounts(
            reconciliations.filter((row) => stableText(row.source) === CURRENT_SOURCE),
          )),
        }),
      }),
      storedAllRows,
      storedAllReconciledRows,
      storedAllMismatchRows,
      storedAllDuplicateDates,
    }),
    positionBasis: Object.freeze({
      ...basisTotals,
      segments: Object.freeze({
        legacyImport: Object.freeze(
          sumBasisRows(
            basis.filter((row) => stableText(row.source) === LEGACY_SOURCE),
          ),
        ),
        currentWriter: Object.freeze(
          sumBasisRows(
            basis.filter((row) => stableText(row.source) === CURRENT_SOURCE),
          ),
        ),
      }),
    }),
    eventBoundary: Object.freeze({
      authority: "independent_event_ledger",
      fountBindingAndEventBoundaryResolved: sourceTransitionOnlyFountBlock,
    }),
    contradictions: Object.freeze(contradictionList),
    unproven: Object.freeze(unprovenList),
    blockers: Object.freeze([...new Set([...contradictionList, ...unprovenList])].sort()),
    boundaries: Object.freeze({
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      runtimeImports: 0,
      pageOrUiChanges: 0,
    }),
  });
}

function summarizeReconciliations(rows) {
  let exactReconciledRows = 0;
  let roundingToleranceReconciledRows = 0;
  let mismatchRows = 0;
  let nonZeroCashRows = 0;
  let duplicatePositionIdentityGroups = 0;
  let invalidAmountRows = 0;

  for (const row of rows) {
    const portfolio = parseFixed(row.portfolio_total_krw);
    const cash = parseFixed(row.cash_value_krw);
    const positions = parseFixed(row.position_total_krw);
    const positionCount = safeCount(row.position_count);
    duplicatePositionIdentityGroups += safeCount(row.duplicate_identity_count) ?? 0;

    if (portfolio === null || cash === null || positions === null || positionCount === null) {
      invalidAmountRows += 1;
      continue;
    }
    if (cash !== 0n) nonZeroCashRows += 1;
    const delta = absolute(portfolio - cash - positions);
    if (delta === 0n) exactReconciledRows += 1;
    const tolerance = BigInt(positionCount + 1) * (SCALE / 2n);
    if (delta <= tolerance) roundingToleranceReconciledRows += 1;
    else mismatchRows += 1;
  }

  return {
    namedPortfolioRows: rows.length,
    exactReconciledRows,
    roundingToleranceReconciledRows,
    mismatchRows,
    nonZeroCashRows,
    duplicatePositionIdentityGroups,
    invalidAmountRows,
  };
}

function summarizeReconciliationAccounts(rows) {
  return Object.fromEntries(
    NAMED_ACCOUNTS.map((account) => [
      account,
      Object.freeze(
        summarizeReconciliations(
          rows.filter((row) => stableText(row.account) === account),
        ),
      ),
    ]),
  );
}

function sumBasisRows(rows) {
  return {
    sourceSegmentCount: new Set(rows.map((row) => stableText(row.source))).size,
    positionRows: sumCount(rows, "position_rows"),
    tickerlessRows: sumCount(rows, "tickerless_rows"),
    tickeredNonCloseRows: sumCount(rows, "tickered_non_close_rows"),
    missingReferenceDateRows: sumCount(rows, "missing_reference_date_rows"),
    missingTickeredReferenceDateRows: sumCount(
      rows,
      "missing_tickered_reference_date_rows",
    ),
    missingTickerlessReferenceDateRows: sumCount(
      rows,
      "missing_tickerless_reference_date_rows",
    ),
    referencePriceDateMismatchRows: sumCount(
      rows,
      "reference_price_date_mismatch_rows",
    ),
    usdRows: sumCount(rows, "usd_rows"),
    invalidUsdFxRows: sumCount(rows, "invalid_usd_fx_rows"),
    missingUsdFxReferenceRows: sumCount(rows, "missing_usd_fx_reference_rows"),
    legacyFallbackMarkerRows: sumCount(rows, "legacy_fallback_marker_rows"),
  };
}

function sumCount(rows, key) {
  return rows.reduce((sum, row) => sum + (safeCount(row[key]) ?? 0), 0);
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

function absolute(value) {
  return value < 0n ? -value : value;
}

function safeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function nullableArray(value) {
  return Array.isArray(value) ? value : null;
}

function stableText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))].sort();
}

function firstDate(rows) {
  return rows
    .map((row) => stableText(row.snapshot_date))
    .filter(Boolean)
    .sort()
    .at(0) ?? null;
}

function lastDate(rows) {
  return rows
    .map((row) => stableText(row.snapshot_date))
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}
