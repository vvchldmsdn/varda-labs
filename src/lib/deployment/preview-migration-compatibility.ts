/** A documented deployment artifact, not permission to rewrite migration history. */
export const PREVIEW_MIGRATION_HASH_COMPATIBILITY = Object.freeze({
  tag: "0047_member_activity",
  createdAt: 1789310468770,
  canonicalSha256: "16682f2e10957052ab3d8af41c7b2d4c1c7406edec06fab8c4ec28f5d4a0ab1d",
  appliedSha256: "9cc1fd0c45f7a9e41c7679876042460c89575bf808583b9630e09e8c97868391",
  reason: "documented_crlf_artifact",
} as const);

type MigrationEvidence = Readonly<{ createdAt: number; sha256: string }>;

/** Returns comparison evidence only; callers must retain the raw database ledger. */
export function canonicalizePreviewMigrationEvidence(migration: MigrationEvidence): {
  createdAt: number;
  sha256: string;
} {
  const reviewed = PREVIEW_MIGRATION_HASH_COMPATIBILITY;
  return {
    createdAt: migration.createdAt,
    sha256: migration.createdAt === reviewed.createdAt && migration.sha256 === reviewed.appliedSha256
      ? reviewed.canonicalSha256
      : migration.sha256,
  };
}

export function previewMigrationEvidenceMatches(
  expected: MigrationEvidence & Readonly<{ tag: string }>,
  actual: MigrationEvidence,
): boolean {
  if (actual.createdAt !== expected.createdAt) return false;
  if (actual.sha256 === expected.sha256) return true;
  const reviewed = PREVIEW_MIGRATION_HASH_COMPATIBILITY;
  return expected.tag === reviewed.tag && expected.createdAt === reviewed.createdAt
    && expected.sha256 === reviewed.canonicalSha256 && actual.sha256 === reviewed.appliedSha256;
}
