export function buildSharedFxDiagnostic(sourceRows, databaseRows) {
  const sourceIdentityIndex = indexBy(
    sourceRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const databaseIdentityIndex = indexBy(
    databaseRows,
    ({ legacyBase44Id }) => legacyBase44Id,
  );
  const sourceDateIndex = indexBy(sourceRows, ({ rateDate }) => rateDate);
  const databaseDateIndex = indexBy(databaseRows, ({ rateDate }) => rateDate);
  const sourceDates = new Set(sourceDateIndex.keys());
  const diagnostic = {
    sourceDuplicateIdentities: duplicateKeyCount(sourceIdentityIndex),
    databaseDuplicateIdentities: [...sourceIdentityIndex.keys()].filter(
      (key) => (databaseIdentityIndex.get(key)?.length ?? 0) > 1,
    ).length,
    sourceDuplicateDateGroups: duplicateKeyCount(sourceDateIndex),
    databaseDuplicateDateGroups: [...sourceDates].filter(
      (date) => (databaseDateIndex.get(date)?.length ?? 0) > 1,
    ).length,
    missingStatusRows: sourceRows.filter(({ status }) => status === null).length,
    nonOkStatusRows: sourceRows.filter(
      ({ status }) => status !== null && status.toLowerCase() !== "ok",
    ).length,
    sampleRows: sourceRows.filter(({ isSample }) => isSample).length,
  };
  const needsReview = Object.values(diagnostic).some((count) => count > 0);

  return Object.freeze({
    classification: "shared_reference",
    result: needsReview ? "needs_review" : "healthy",
    ownerActions: 0,
    actualWriteAllowed: false,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      source: sourceRows.length,
      database: databaseRows.length,
    }),
    diagnostics: Object.freeze(diagnostic),
  });
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
