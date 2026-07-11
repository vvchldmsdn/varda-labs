const STATUS_BUCKETS = [
  "ok",
  "revised",
  "preliminary",
  "non_trading",
  "missing",
  "fetch_failed",
  "absent",
  "unknown",
];

export function buildGlobalFactorDiagnostic(sourceRows, databaseRows) {
  const sourceIdentityIndex = indexBy(
    sourceRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const databaseIdentityIndex = indexBy(
    databaseRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const sourceNaturalIndex = indexBy(sourceRows, factorNaturalKey);
  const databaseNaturalIndex = indexBy(databaseRows, factorNaturalKey);
  const sourceNaturalKeys = new Set(sourceNaturalIndex.keys());
  const sourceDuplicateIdentities = duplicateKeyCount(sourceIdentityIndex);
  const databaseDuplicateIdentities = [...sourceIdentityIndex.keys()].filter(
    (key) => (databaseIdentityIndex.get(key)?.length ?? 0) > 1,
  ).length;
  const sourceNaturalDuplicates = duplicateGroups(sourceNaturalIndex);
  const databaseNaturalDuplicates = duplicateGroupsForKeys(
    databaseNaturalIndex,
    sourceNaturalKeys,
  );
  const status = summarizeStatus(sourceRows);
  const estimated = summarizeBooleanEvidence(
    sourceRows,
    "estimatedPresent",
    "isEstimated",
  );
  const currentPreliminary = summarizeBooleanEvidence(
    sourceRows,
    "preliminaryPresent",
    "isPreliminary",
  );
  const blocked =
    sourceDuplicateIdentities > 0 || databaseDuplicateIdentities > 0;
  const needsReview =
    sourceNaturalDuplicates.groups > 0 ||
    databaseNaturalDuplicates.groups > 0 ||
    status.absent > 0 ||
    status.unknown > 0 ||
    status.missing > 0 ||
    status.fetch_failed > 0 ||
    estimated.true > 0 ||
    estimated.absent > 0 ||
    estimated.unknown > 0;

  return Object.freeze({
    classification: "shared_reference",
    result: blocked ? "blocked" : needsReview ? "needs_review" : "healthy",
    ownerActions: 0,
    actualWriteAllowed: false,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      source: sourceRows.length,
      database: databaseRows.length,
    }),
    identityDiagnostics: Object.freeze({
      sourceDuplicateIdentities,
      databaseDuplicateIdentities,
    }),
    naturalKeyDiagnostics: Object.freeze({
      sourceDuplicateGroups: sourceNaturalDuplicates.groups,
      sourceDuplicateRows: sourceNaturalDuplicates.rows,
      databaseDuplicateGroups: databaseNaturalDuplicates.groups,
      databaseDuplicateRows: databaseNaturalDuplicates.rows,
    }),
    healthEvidence: Object.freeze({
      status,
      estimated,
      currentPreliminary,
      sampleRows: sourceRows.filter(({ isSample }) => isSample).length,
    }),
  });
}

function summarizeStatus(rows) {
  const counts = Object.fromEntries(STATUS_BUCKETS.map((status) => [status, 0]));
  for (const row of rows) {
    let bucket = "unknown";
    if (!row.statusPresent) bucket = "absent";
    else if (STATUS_BUCKETS.includes(row.status)) bucket = row.status;
    counts[bucket] += 1;
  }
  return Object.freeze(counts);
}

function summarizeBooleanEvidence(rows, presentKey, valueKey) {
  const counts = { true: 0, false: 0, absent: 0, unknown: 0 };
  for (const row of rows) {
    if (!row[presentKey]) counts.absent += 1;
    else if (row[valueKey] === true) counts.true += 1;
    else if (row[valueKey] === false) counts.false += 1;
    else counts.unknown += 1;
  }
  return Object.freeze(counts);
}

function factorNaturalKey({ factorKey, factorDate }) {
  return `${factorKey}\u001f${factorDate}`;
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
