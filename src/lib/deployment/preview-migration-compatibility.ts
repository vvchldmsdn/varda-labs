/** A documented deployment artifact, not permission to rewrite migration history. */
export const PREVIEW_MIGRATION_HASH_COMPATIBILITY = Object.freeze({
  tag: "0047_member_activity",
  createdAt: 1789310468770,
  canonicalSha256: "16682f2e10957052ab3d8af41c7b2d4c1c7406edec06fab8c4ec28f5d4a0ab1d",
  appliedSha256: "9cc1fd0c45f7a9e41c7679876042460c89575bf808583b9630e09e8c97868391",
  reason: "documented_crlf_artifact",
} as const);

// Every artifact below is reproduced from its unchanged SQL bytes in tests.
export const PREVIEW_MIGRATION_HASH_COMPATIBILITIES = Object.freeze([
  PREVIEW_MIGRATION_HASH_COMPATIBILITY,
  Object.freeze({
    tag: "0057_native_settlement_cutoff",
    createdAt: 1790208000000,
    canonicalSha256: "b1db66812f77eeefcee6c0ffa2aed086b00bd11b30e95ccfaf46812f520c6ef8",
    appliedSha256: "019aaece4243aa438bcd64bc00c4dc998a2f8100f5ceee7baa48d0a6df7129c7",
    reason: "verified_crlf_artifact",
  } as const),
  Object.freeze({
    tag: "0058_broker_recovery_evidence",
    createdAt: 1790208000001,
    canonicalSha256: "a6954dfe6014948205770dd74cb6c5ecc537e68ed6944570589eb5048d0d5629",
    appliedSha256: "2923446a0a51604659acae4589f94c9c9a2d34ed9ab51779948fd883e73c7256",
    // 1-based newline positions 22-25 are LF; the other 50 are CRLF.
    reason: "verified_mixed_newline_artifact",
  } as const),
  Object.freeze({
    tag: "0061_portfolio_target_plan_rows",
    createdAt: 1790640000000,
    canonicalSha256: "5ab7eb47586eb8cf5fd20c46d6349bd77a99964a1875160da5bbbe69ad756159",
    appliedSha256: "2d016c52274b8292e0d07fe868ddb916fb22ee163ff79f8ac6071b8d68102006",
    reason: "verified_crlf_artifact",
  } as const),
]);

type MigrationEvidence = Readonly<{ createdAt: number; sha256: string }>;

/** Returns comparison evidence only; callers must retain the raw database ledger. */
export function canonicalizePreviewMigrationEvidence(migration: MigrationEvidence): {
  createdAt: number;
  sha256: string;
} {
  const reviewed = PREVIEW_MIGRATION_HASH_COMPATIBILITIES.find(entry =>
    migration.createdAt === entry.createdAt && migration.sha256 === entry.appliedSha256);
  return { createdAt: migration.createdAt, sha256: reviewed?.canonicalSha256 ?? migration.sha256 };
}

export function previewMigrationEvidenceMatches(
  expected: MigrationEvidence & Readonly<{ tag: string }>,
  actual: MigrationEvidence,
): boolean {
  if (actual.createdAt !== expected.createdAt) return false;
  if (actual.sha256 === expected.sha256) return true;
  return PREVIEW_MIGRATION_HASH_COMPATIBILITIES.some(reviewed =>
    expected.tag === reviewed.tag && expected.createdAt === reviewed.createdAt
    && expected.sha256 === reviewed.canonicalSha256 && actual.sha256 === reviewed.appliedSha256);
}
