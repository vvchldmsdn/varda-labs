import {
  compareAscii,
  digestCandidateSet,
  digestEligibleSet,
  fingerprintAppUserId,
  fingerprintLegacyOwner,
  normalizeAccounts,
} from "./legacy-account-ownership-evidence.mjs";

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT = 4;

export function evaluateLegacyAccountOwnerAssignment({
  accountRows,
  targetAppUserSha256,
  legacyOwnerSha256,
  candidateSetDigest,
  eligibleSetDigest,
}) {
  let normalizedAccounts;
  try {
    normalizedAccounts = normalizeAccounts(
      accountRows.map((row) => ({
        id: row.id,
        legacyOwnerUserId: row.legacy_owner_user_id,
        canonicalOwnerUserId: row.canonical_owner_user_id,
      })),
    );
  } catch {
    return blocked("account_evidence_invalid");
  }

  const classifiedRows = normalizedAccounts.map((account) => {
    const legacyFingerprint =
      account.legacyOwnerUserId === null
        ? null
        : fingerprintLegacyOwner(account.legacyOwnerUserId);
    const canonicalFingerprint =
      account.canonicalOwnerUserId === null
        ? null
        : fingerprintAppUserId(account.canonicalOwnerUserId);

    return {
      accountId: account.id,
      legacyFingerprint,
      canonicalFingerprint,
      classification: classifyAccount({
        legacyFingerprint,
        canonicalFingerprint,
        targetAppUserSha256,
        legacyOwnerSha256,
      }),
    };
  });
  const matchingAccounts = normalizedAccounts.filter(
    (account) =>
      account.legacyOwnerUserId !== null &&
      fingerprintLegacyOwner(account.legacyOwnerUserId) ===
        legacyOwnerSha256,
  );
  const eligibleAccountIds = classifiedRows
    .filter(({ classification }) => classification === "eligible")
    .map(({ accountId }) => accountId)
    .sort(compareAscii);
  const alreadyAssignedCount = countClassification(
    classifiedRows,
    "already_assigned",
  );
  const foreignOwnerCount = countClassification(
    classifiedRows,
    "foreign_owner_conflict",
  );
  const projectedPreassignmentRows = classifiedRows.map((row) =>
    row.classification === "already_assigned"
      ? {
          ...row,
          canonicalFingerprint: null,
          classification: "eligible",
        }
      : row,
  );
  const state = resolveState({
    eligibleCount: eligibleAccountIds.length,
    alreadyAssignedCount,
  });
  const snapshot = {
    state,
    accountCount: normalizedAccounts.length,
    matchingLegacyCount: matchingAccounts.length,
    foreignOwnerCount,
    eligibleAccountIds,
    alreadyAssignedCount,
    exactLegacyOwnerValue:
      matchingAccounts.length === 0
        ? null
        : matchingAccounts[0].legacyOwnerUserId,
    exactLegacyOwnerValueConsistent: matchingAccounts.every(
      ({ legacyOwnerUserId }) =>
        legacyOwnerUserId === matchingAccounts[0]?.legacyOwnerUserId,
    ),
    currentCandidateSetDigest: digestCandidateSet(
      targetAppUserSha256,
      legacyOwnerSha256,
      classifiedRows,
    ),
    currentEligibleSetDigest: digestEligibleSet(classifiedRows),
    projectedCandidateSetDigest: digestCandidateSet(
      targetAppUserSha256,
      legacyOwnerSha256,
      projectedPreassignmentRows,
    ),
    projectedEligibleSetDigest: digestEligibleSet(
      projectedPreassignmentRows,
    ),
  };
  const blocker = findBlocker(snapshot, {
    candidateSetDigest,
    eligibleSetDigest,
  });

  return {
    ...snapshot,
    blocker,
  };
}

function resolveState({ eligibleCount, alreadyAssignedCount }) {
  if (
    eligibleCount ===
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT &&
    alreadyAssignedCount === 0
  ) {
    return "assignment_pending";
  }
  if (
    eligibleCount === 0 &&
    alreadyAssignedCount ===
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT
  ) {
    return "already_applied";
  }
  return "invalid";
}

function findBlocker(
  snapshot,
  { candidateSetDigest, eligibleSetDigest },
) {
  const expectedCount =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_EXPECTED_ACCOUNT_COUNT;
  if (snapshot.accountCount !== expectedCount) {
    return "account_scope_count_mismatch";
  }
  if (snapshot.matchingLegacyCount !== expectedCount) {
    return "legacy_owner_match_count_mismatch";
  }
  if (!snapshot.exactLegacyOwnerValueConsistent) {
    return "legacy_owner_evidence_collision";
  }
  if (snapshot.foreignOwnerCount > 0) {
    return "foreign_owner_conflict";
  }
  if (snapshot.state === "invalid") {
    return "account_assignment_state_mismatch";
  }

  const currentDigestsMatch =
    snapshot.currentCandidateSetDigest === candidateSetDigest &&
    snapshot.currentEligibleSetDigest === eligibleSetDigest;
  const preassignmentDigestsMatch =
    snapshot.state === "already_applied" &&
    snapshot.projectedCandidateSetDigest === candidateSetDigest &&
    snapshot.projectedEligibleSetDigest === eligibleSetDigest;
  return currentDigestsMatch || preassignmentDigestsMatch
    ? null
    : "account_evidence_digest_drift";
}

function classifyAccount({
  legacyFingerprint,
  canonicalFingerprint,
  targetAppUserSha256,
  legacyOwnerSha256,
}) {
  if (
    canonicalFingerprint !== null &&
    canonicalFingerprint !== targetAppUserSha256
  ) {
    return "foreign_owner_conflict";
  }
  if (
    canonicalFingerprint === targetAppUserSha256 &&
    legacyFingerprint === legacyOwnerSha256
  ) {
    return "already_assigned";
  }
  if (
    canonicalFingerprint === null &&
    legacyFingerprint === legacyOwnerSha256
  ) {
    return "eligible";
  }
  if (legacyFingerprint === null) return "missing_legacy_evidence";
  return "unresolved";
}

function countClassification(rows, classification) {
  return rows.filter((row) => row.classification === classification)
    .length;
}

function blocked(blocker) {
  return {
    state: "invalid",
    blocker,
  };
}
