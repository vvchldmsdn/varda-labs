import {
  classifyCanonicalOwnerAction,
  summarizeCanonicalOwnerActions,
} from "./migration-canonical-owner-shadow.mjs";

const REFERENCE_STATUSES = [
  "not_applicable",
  "legacy_only_reference",
  "compatible_planned",
  "compatible",
  "block",
];

export function planHistorySnapshots({
  source,
  state,
  canonicalOwnerId,
  globalBlock,
  coreProofState,
}) {
  const accountIndex = indexBy(state.accounts, ({ code }) => code);
  const assetIndex = indexBy(
    state.assets,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const context = {
    canonicalOwnerId,
    globalBlock,
    coreProofState,
    accountIndex,
    assetIndex,
  };

  const balancePlan = planSnapshotTable({
    table: "account_balance_snapshots",
    sourceRows: source.balances,
    databaseRows: state.balances,
    sourceNaturalKey: ({ balanceDate }) => balanceDate,
    databaseNaturalKey: ({ balanceDate }) => balanceDate,
    evaluateReferences: () => [],
    context,
  });
  const portfolioPlan = planSnapshotTable({
    table: "daily_portfolio_snapshots",
    sourceRows: source.portfolios,
    databaseRows: state.portfolios,
    sourceNaturalKey: portfolioNaturalKey,
    databaseNaturalKey: portfolioNaturalKey,
    evaluateReferences: (row, databaseRow) => [
      evaluateParentReference({
        kind: "account",
        reference: row.account,
        databaseRow,
        linkedField: "accountId",
        candidates: accountIndex.get(row.account) ?? [],
        allowAggregateAll: true,
        context,
      }),
    ],
    context,
  });
  const positionPlan = planSnapshotTable({
    table: "daily_position_snapshots",
    sourceRows: source.positions,
    databaseRows: state.positions,
    sourceNaturalKey: (row) =>
      positionSourceNaturalKey(row, assetIndex.get(row.legacyAssetId) ?? []),
    databaseNaturalKey: positionDatabaseNaturalKey,
    evaluateReferences: (row, databaseRow) => [
      evaluateParentReference({
        kind: "account",
        reference: row.account,
        databaseRow,
        linkedField: "accountId",
        candidates: accountIndex.get(row.account) ?? [],
        allowAggregateAll: false,
        context,
      }),
      evaluateParentReference({
        kind: "asset",
        reference: row.legacyAssetId,
        databaseRow,
        linkedField: "assetId",
        candidates: assetIndex.get(row.legacyAssetId) ?? [],
        allowAggregateAll: false,
        context,
      }),
    ],
    context,
  });
  const allActions = [
    ...balancePlan.actions,
    ...portfolioPlan.actions,
    ...positionPlan.actions,
  ];

  return Object.freeze({
    actions: summarizeCanonicalOwnerActions(allActions),
    tables: Object.freeze({
      account_balance_snapshots: balancePlan.summary,
      daily_portfolio_snapshots: portfolioPlan.summary,
      daily_position_snapshots: positionPlan.summary,
    }),
    references: summarizeReferences([
      ...portfolioPlan.references,
      ...positionPlan.references,
    ]),
    reasons: Object.freeze([
      ...balancePlan.reasons,
      ...portfolioPlan.reasons,
      ...positionPlan.reasons,
    ]),
  });
}

function planSnapshotTable({
  table,
  sourceRows,
  databaseRows,
  sourceNaturalKey,
  databaseNaturalKey,
  evaluateReferences,
  context,
}) {
  const sourceIdentityIndex = indexBy(
    sourceRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const databaseIdentityIndex = indexBy(
    databaseRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const sourceNaturalIndex = indexBy(sourceRows, sourceNaturalKey);
  const databaseNaturalIndex = indexBy(databaseRows, databaseNaturalKey);
  const sourceNaturalKeys = new Set(sourceNaturalIndex.keys());
  const sourceDuplicateIdentities = duplicateKeyCount(sourceIdentityIndex);
  const databaseDuplicateIdentities = [...sourceIdentityIndex.keys()].filter(
    (key) => (databaseIdentityIndex.get(key)?.length ?? 0) > 1,
  ).length;
  const sourceNaturalCollisions = duplicateKeyCount(sourceNaturalIndex);
  const databaseNaturalCollisions = [...sourceNaturalKeys].filter((key) => {
    const sourceIds = new Set(
      (sourceNaturalIndex.get(key) ?? []).map(
        ({ legacyBase44Id }) => legacyBase44Id,
      ),
    );
    const rows = databaseNaturalIndex.get(key) ?? [];
    return (
      rows.length > 1 ||
      rows.some(({ legacyBase44Id }) => !sourceIds.has(legacyBase44Id))
    );
  }).length;
  const actions = [];
  const references = [];
  const reasons = [];

  for (const sourceRow of sourceRows) {
    const identityCandidates =
      databaseIdentityIndex.get(sourceRow.legacyBase44Id) ?? [];
    const databaseRow =
      identityCandidates.length === 1 ? identityCandidates[0] : null;
    const naturalKey = sourceNaturalKey(sourceRow);
    const naturalCandidates = databaseNaturalIndex.get(naturalKey) ?? [];
    const sourceIdentityAmbiguous =
      (sourceIdentityIndex.get(sourceRow.legacyBase44Id)?.length ?? 0) > 1;
    const sourceNaturalAmbiguous =
      (sourceNaturalIndex.get(naturalKey)?.length ?? 0) > 1;
    const databaseIdentityAmbiguous = identityCandidates.length > 1;
    const databaseNaturalCollision =
      naturalCandidates.length > 1 ||
      naturalCandidates.some(
        ({ legacyBase44Id }) =>
          legacyBase44Id !== sourceRow.legacyBase44Id,
      );
    const databaseNaturalMismatch =
      databaseRow !== null && databaseNaturalKey(databaseRow) !== naturalKey;
    let action = classifyCanonicalOwnerAction({
      exists: databaseRow !== null,
      existingCanonicalOwnerId:
        databaseRow?.canonicalOwnerUserId ?? null,
      canonicalOwnerId: context.canonicalOwnerId,
      blocked:
        context.globalBlock ||
        sourceIdentityAmbiguous ||
        sourceNaturalAmbiguous ||
        databaseIdentityAmbiguous ||
        databaseNaturalCollision ||
        databaseNaturalMismatch,
    });
    const rowReferences = evaluateReferences(sourceRow, databaseRow);
    references.push(...rowReferences);
    if (rowReferences.some(({ status }) => status === "block")) {
      action = "block";
    }
    actions.push(action);
    reasons.push(
      snapshotActionReason({
        table,
        action,
        sourceIdentityAmbiguous,
        sourceNaturalAmbiguous,
        databaseIdentityAmbiguous,
        databaseNaturalCollision,
        databaseNaturalMismatch,
        databaseRow,
        canonicalOwnerId: context.canonicalOwnerId,
      }),
      ...rowReferences.map(({ reason }) => reason),
    );
  }

  return Object.freeze({
    actions: Object.freeze(actions),
    references: Object.freeze(references),
    reasons: Object.freeze(reasons),
    summary: Object.freeze({
      ...summarizeCanonicalOwnerActions(actions),
      sourceDuplicateIdentities,
      databaseDuplicateIdentities,
      sourceNaturalCollisions,
      databaseNaturalCollisions,
    }),
  });
}

function evaluateParentReference({
  kind,
  reference,
  databaseRow,
  linkedField,
  candidates,
  allowAggregateAll,
  context,
}) {
  const linkedId = databaseRow?.[linkedField] ?? null;
  if (allowAggregateAll && reference === "all") {
    return linkedId === null
      ? referenceResult(
          kind,
          "not_applicable",
          "account_all_is_parentless_aggregate",
        )
      : referenceResult(
          kind,
          "block",
          "account_all_has_unexpected_resolved_parent",
        );
  }
  if (candidates.length === 0) {
    return linkedId === null
      ? referenceResult(
          kind,
          "legacy_only_reference",
          `${kind}_database_parent_missing`,
        )
      : referenceResult(
          kind,
          "block",
          `${kind}_resolved_relation_mismatch`,
        );
  }
  if (candidates.length > 1) {
    return referenceResult(
      kind,
      "block",
      `${kind}_database_parent_ambiguous`,
    );
  }

  const candidate = candidates[0];
  if (databaseRow !== null && linkedId !== candidate.id) {
    return referenceResult(
      kind,
      "block",
      `${kind}_resolved_relation_mismatch`,
    );
  }
  if (candidate.canonicalOwnerUserId === context.canonicalOwnerId) {
    return referenceResult(kind, "compatible", `${kind}_owner_matches`);
  }
  if (candidate.canonicalOwnerUserId !== null) {
    return referenceResult(kind, "block", `${kind}_foreign_owner`);
  }
  if (hasFreshCoreProof(context.coreProofState, kind, reference)) {
    return referenceResult(
      kind,
      "compatible_planned",
      `${kind}_owner_covered_by_fresh_core_shadow`,
    );
  }
  return referenceResult(
    kind,
    "block",
    `${kind}_resolved_parent_without_fresh_core_proof`,
  );
}

function snapshotActionReason({
  table,
  action,
  sourceIdentityAmbiguous,
  sourceNaturalAmbiguous,
  databaseIdentityAmbiguous,
  databaseNaturalCollision,
  databaseNaturalMismatch,
  databaseRow,
  canonicalOwnerId,
}) {
  if (sourceIdentityAmbiguous) return `${table}_source_identity_duplicate`;
  if (sourceNaturalAmbiguous) return `${table}_source_natural_key_collision`;
  if (databaseIdentityAmbiguous) {
    return `${table}_database_identity_ambiguous`;
  }
  if (databaseNaturalCollision) {
    return `${table}_database_natural_key_collision`;
  }
  if (databaseNaturalMismatch) {
    return `${table}_database_natural_key_mismatch`;
  }
  if (action === "insert") return `${table}_candidate_absent`;
  if (action === "update") return `${table}_canonical_owner_missing`;
  if (action === "skip") return `${table}_canonical_owner_matches`;
  if (
    databaseRow?.canonicalOwnerUserId !== null &&
    databaseRow?.canonicalOwnerUserId !== undefined &&
    databaseRow.canonicalOwnerUserId !== canonicalOwnerId
  ) {
    return `${table}_canonical_owner_conflict`;
  }
  return `${table}_contract_blocked`;
}

function summarizeReferences(results) {
  const byKind = { account: [], asset: [] };
  for (const result of results) byKind[result.kind].push(result);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(byKind).map(([kind, rows]) => [
        kind,
        summarizeReferenceStatuses(rows),
      ]),
    ),
  );
}

function summarizeReferenceStatuses(results) {
  const counts = Object.fromEntries(
    REFERENCE_STATUSES.map((status) => [status, 0]),
  );
  for (const { status } of results) counts[status] += 1;
  return Object.freeze(counts);
}

function referenceResult(kind, status, reason) {
  return Object.freeze({ kind, status, reason });
}

function hasFreshCoreProof(coreProof, kind, reference) {
  if (!coreProof.fresh) return false;
  if (kind === "account") return coreProof.accountCodes.has(reference);
  if (kind === "asset") return coreProof.assetLegacyIds.has(reference);
  return false;
}

function portfolioNaturalKey({ snapshotDate, account, source }) {
  return [snapshotDate, account, source].join("\u001f");
}

function positionSourceNaturalKey(row, assetCandidates) {
  const assetKey =
    assetCandidates.length === 1
      ? `asset:${assetCandidates[0].id}`
      : `legacy:${row.legacyAssetId}`;
  return [row.snapshotDate, row.account, assetKey, row.source].join("\u001f");
}

function positionDatabaseNaturalKey(row) {
  const assetKey =
    row.assetId === null
      ? `legacy:${row.legacyAssetId}`
      : `asset:${row.assetId}`;
  return [row.snapshotDate, row.account, assetKey, row.source].join("\u001f");
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
