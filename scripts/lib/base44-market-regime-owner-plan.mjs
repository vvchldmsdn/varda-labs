import {
  classifyCanonicalOwnerAction,
  summarizeCanonicalOwnerActions,
} from "./migration-canonical-owner-shadow.mjs";

const REFERENCE_STATUSES = [
  "not_applicable",
  "compatible_planned",
  "compatible",
  "block",
];

export function buildMarketRegimeOwnerPlan({
  sourceRows,
  databaseRows,
  accounts,
  canonicalOwnerId,
  globalBlock,
  coreProofState,
}) {
  const sourceIdentityIndex = indexBy(
    sourceRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const databaseIdentityIndex = indexBy(
    databaseRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const sourceNaturalIndex = indexBy(sourceRows, regimeNaturalKey);
  const databaseNaturalIndex = indexBy(databaseRows, regimeNaturalKey);
  const accountIndex = indexBy(accounts, ({ code }) => code);
  const rowStates = sourceRows.map((sourceRow) => {
    const identityCandidates =
      databaseIdentityIndex.get(sourceRow.legacyBase44Id) ?? [];
    const databaseRow =
      identityCandidates.length === 1 ? identityCandidates[0] : null;
    const sourceIdentityAmbiguous =
      (sourceIdentityIndex.get(sourceRow.legacyBase44Id)?.length ?? 0) > 1;
    const databaseIdentityAmbiguous = identityCandidates.length > 1;
    const storedNaturalKeyMismatch =
      databaseRow !== null &&
      regimeNaturalKey(databaseRow) !== regimeNaturalKey(sourceRow);
    let action = classifyCanonicalOwnerAction({
      exists: databaseRow !== null,
      existingCanonicalOwnerId:
        databaseRow?.canonicalOwnerUserId ?? null,
      canonicalOwnerId,
      blocked:
        globalBlock ||
        sourceIdentityAmbiguous ||
        databaseIdentityAmbiguous ||
        storedNaturalKeyMismatch,
    });
    const accountReference = evaluateAccountReference({
      sourceRow,
      databaseRow,
      candidates: accountIndex.get(sourceRow.account) ?? [],
      canonicalOwnerId,
      coreProofState,
    });
    if (accountReference.status === "block") action = "block";

    return {
      sourceRow,
      databaseRow,
      naturalKey: regimeNaturalKey(sourceRow),
      action,
      accountReference,
      sourceIdentityAmbiguous,
      databaseIdentityAmbiguous,
      storedNaturalKeyMismatch,
      duplicateGroupBlocked: false,
    };
  });
  const rowStatesByNaturalKey = indexBy(rowStates, ({ naturalKey }) => naturalKey);
  let blockedDuplicateGroups = 0;

  for (const [naturalKey, groupStates] of rowStatesByNaturalKey) {
    const databaseGroup = databaseNaturalIndex.get(naturalKey) ?? [];
    const isDuplicateGroup =
      groupStates.length > 1 || databaseGroup.length > 1;
    if (!isDuplicateGroup) continue;

    const sourceIds = new Set(
      groupStates.map(({ sourceRow }) => sourceRow.legacyBase44Id),
    );
    const hasUnplannedDatabaseIdentity = databaseGroup.some(
      ({ legacyBase44Id }) => !sourceIds.has(legacyBase44Id),
    );
    const hasForeignDatabaseOwner = databaseGroup.some(
      ({ canonicalOwnerUserId }) =>
        canonicalOwnerUserId !== null &&
        canonicalOwnerUserId !== canonicalOwnerId,
    );
    const hasBlockedContract = groupStates.some(
      ({ action }) => action === "block",
    );
    if (
      !hasUnplannedDatabaseIdentity &&
      !hasForeignDatabaseOwner &&
      !hasBlockedContract
    ) {
      continue;
    }

    blockedDuplicateGroups += 1;
    for (const rowState of groupStates) {
      rowState.action = "block";
      rowState.duplicateGroupBlocked = true;
    }
  }

  const actions = summarizeCanonicalOwnerActions(
    rowStates.map(({ action }) => action),
  );
  const sourceDuplicateGroups = duplicateGroups(sourceNaturalIndex);
  const databaseDuplicateGroups = duplicateGroupsForKeys(
    databaseNaturalIndex,
    new Set(sourceNaturalIndex.keys()),
  );
  const missingLabelRows = sourceRows.filter(
    ({ labelPresent }) => !labelPresent,
  ).length;
  const missingDriversRows = sourceRows.filter(
    ({ driversPresent }) => !driversPresent,
  ).length;
  const incompletePayloadRows = sourceRows.filter(
    ({ labelPresent, driversPresent }) => !labelPresent || !driversPresent,
  ).length;
  const dataHealthNeedsReview =
    sourceDuplicateGroups.groups > 0 ||
    databaseDuplicateGroups.groups > 0 ||
    incompletePayloadRows > 0;
  const references = summarizeReferenceStatuses(
    rowStates.map(({ accountReference }) => accountReference),
  );
  const reasons = [
    ...rowStates.map((rowState) =>
      regimeActionReason(rowState, canonicalOwnerId),
    ),
    ...rowStates.map(({ accountReference }) => accountReference.reason),
  ];

  return Object.freeze({
    result: actions.block === 0 ? "planned" : "blocked",
    actions,
    references: Object.freeze({ account: references }),
    reasonCounts: summarizeStrings(reasons),
    identityDiagnostics: Object.freeze({
      sourceDuplicateIdentities: duplicateKeyCount(sourceIdentityIndex),
      databaseDuplicateIdentities: [...sourceIdentityIndex.keys()].filter(
        (key) => (databaseIdentityIndex.get(key)?.length ?? 0) > 1,
      ).length,
      storedNaturalKeyMismatches: rowStates.filter(
        ({ storedNaturalKeyMismatch }) => storedNaturalKeyMismatch,
      ).length,
      blockedDuplicateGroups,
    }),
    dataHealth: Object.freeze({
      result: dataHealthNeedsReview ? "needs_review" : "healthy",
      duplicateDateAccount: Object.freeze({
        sourceGroups: sourceDuplicateGroups.groups,
        sourceRows: sourceDuplicateGroups.rows,
        databaseGroups: databaseDuplicateGroups.groups,
        databaseRows: databaseDuplicateGroups.rows,
      }),
      payload: Object.freeze({
        missingLabelRows,
        missingDriversRows,
        incompleteRows: incompletePayloadRows,
      }),
    }),
    plannedCanonicalAssignments: actions.insert + actions.update,
  });
}

function evaluateAccountReference({
  sourceRow,
  databaseRow,
  candidates,
  canonicalOwnerId,
  coreProofState,
}) {
  const linkedId = databaseRow?.accountId ?? null;
  if (sourceRow.account === "all") {
    return linkedId === null
      ? referenceResult(
          "not_applicable",
          "account_all_is_parentless_aggregate",
        )
      : referenceResult(
          "block",
          "account_all_has_unexpected_resolved_parent",
        );
  }
  if (candidates.length === 0) {
    return referenceResult("block", "account_database_parent_missing");
  }
  if (candidates.length > 1) {
    return referenceResult("block", "account_database_parent_ambiguous");
  }

  const candidate = candidates[0];
  if (databaseRow !== null && linkedId !== candidate.id) {
    return referenceResult("block", "account_resolved_relation_mismatch");
  }
  if (candidate.canonicalOwnerUserId === canonicalOwnerId) {
    return referenceResult("compatible", "account_owner_matches");
  }
  if (candidate.canonicalOwnerUserId !== null) {
    return referenceResult("block", "account_foreign_owner");
  }
  if (
    coreProofState.fresh &&
    coreProofState.accountCodes.has(sourceRow.account)
  ) {
    return referenceResult(
      "compatible_planned",
      "account_owner_covered_by_fresh_core_shadow",
    );
  }
  return referenceResult(
    "block",
    "account_resolved_parent_without_fresh_core_proof",
  );
}

function regimeActionReason(rowState, canonicalOwnerId) {
  if (rowState.duplicateGroupBlocked) {
    return "duplicate_regime_group_owner_contract_blocked";
  }
  if (rowState.sourceIdentityAmbiguous) {
    return "market_regime_source_identity_duplicate";
  }
  if (rowState.databaseIdentityAmbiguous) {
    return "market_regime_database_identity_ambiguous";
  }
  if (rowState.storedNaturalKeyMismatch) {
    return "market_regime_stored_natural_key_mismatch";
  }
  if (rowState.action === "insert") return "market_regime_candidate_absent";
  if (rowState.action === "update") {
    return "market_regime_canonical_owner_missing";
  }
  if (rowState.action === "skip") return "market_regime_owner_matches";
  if (
    rowState.databaseRow?.canonicalOwnerUserId !== null &&
    rowState.databaseRow?.canonicalOwnerUserId !== undefined &&
    rowState.databaseRow.canonicalOwnerUserId !== canonicalOwnerId
  ) {
    return "market_regime_foreign_owner";
  }
  return "market_regime_contract_blocked";
}

function regimeNaturalKey({ regimeDate, account }) {
  return `${regimeDate}\u001f${account}`;
}

function referenceResult(status, reason) {
  return Object.freeze({ status, reason });
}

function summarizeReferenceStatuses(results) {
  const counts = Object.fromEntries(
    REFERENCE_STATUSES.map((status) => [status, 0]),
  );
  for (const { status } of results) counts[status] += 1;
  return Object.freeze(counts);
}

function indexBy(rows, keySelector) {
  const index = new Map();
  for (const row of rows) {
    const key = keySelector(row);
    if (key === null || key === undefined) continue;
    const matches = index.get(key) ?? [];
    matches.push(row);
    index.set(key, matches);
  }
  return index;
}

function duplicateKeyCount(index) {
  return [...index.values()].filter((rows) => rows.length > 1).length;
}

function duplicateGroups(index) {
  const groups = [...index.values()].filter((rows) => rows.length > 1);
  return {
    groups: groups.length,
    rows: groups.reduce((sum, rows) => sum + rows.length, 0),
  };
}

function duplicateGroupsForKeys(index, keys) {
  const groups = [...keys]
    .map((key) => index.get(key) ?? [])
    .filter((rows) => rows.length > 1);
  return {
    groups: groups.length,
    rows: groups.reduce((sum, rows) => sum + rows.length, 0),
  };
}

function summarizeStrings(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}
