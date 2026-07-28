import {
  compareAscii,
  digestCandidateSet,
  digestDiscoveryEvidence,
  digestEligibleSet,
  fingerprintAppUserId,
  fingerprintLegacyOwner,
  isSha256Fingerprint,
  normalizeAccounts,
  normalizeAppUsers,
} from "./legacy-account-ownership-evidence.mjs";

export { fingerprintAppUserId, fingerprintLegacyOwner };

export class LegacyAccountOwnershipArgumentError extends Error {
  constructor(code) {
    super("Legacy account ownership preflight arguments are invalid");
    this.name = "LegacyAccountOwnershipArgumentError";
    this.code = code;
  }
}

export function parseLegacyAccountOwnershipArgs(argv) {
  let discover = false;
  let targetAppUserSha256 = null;
  let legacyOwnerSha256 = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--discover" && !discover) {
      discover = true;
      continue;
    }
    if (
      argument === "--target-app-user-sha256" &&
      targetAppUserSha256 === null
    ) {
      targetAppUserSha256 = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument === "--legacy-owner-sha256" && legacyOwnerSha256 === null) {
      legacyOwnerSha256 = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    throw new LegacyAccountOwnershipArgumentError(
      "unsupported_or_duplicate_argument",
    );
  }

  if (discover) {
    if (targetAppUserSha256 !== null || legacyOwnerSha256 !== null) {
      throw new LegacyAccountOwnershipArgumentError(
        "discovery_cannot_include_evaluation_inputs",
      );
    }
    return Object.freeze({ mode: "discover" });
  }

  if (!isSha256Fingerprint(targetAppUserSha256)) {
    throw new LegacyAccountOwnershipArgumentError(
      "invalid_target_app_user_sha256",
    );
  }
  if (!isSha256Fingerprint(legacyOwnerSha256)) {
    throw new LegacyAccountOwnershipArgumentError(
      "invalid_legacy_owner_sha256",
    );
  }

  return Object.freeze({
    mode: "evaluate",
    targetAppUserSha256,
    legacyOwnerSha256,
  });
}

export function buildLegacyAccountOwnershipDiscovery({
  appUsers,
  accounts,
}) {
  const normalizedAppUsers = normalizeAppUsers(appUsers);
  const normalizedAccounts = normalizeAccounts(accounts);
  const legacyOwnerCounts = new Map();

  for (const account of normalizedAccounts) {
    if (account.legacyOwnerUserId === null) continue;
    const fingerprint = fingerprintLegacyOwner(account.legacyOwnerUserId);
    legacyOwnerCounts.set(
      fingerprint,
      (legacyOwnerCounts.get(fingerprint) ?? 0) + 1,
    );
  }

  const appUserCandidates = normalizedAppUsers
    .map((appUser) =>
      Object.freeze({
        fingerprint: fingerprintAppUserId(appUser.id),
        status: appUser.status,
        role: appUser.role,
      }),
    )
    .sort(compareFingerprint);
  const legacyOwnerCandidates = [...legacyOwnerCounts.entries()]
    .map(([fingerprint, accountRows]) =>
      Object.freeze({ fingerprint, accountRows }),
    )
    .sort(compareFingerprint);

  return Object.freeze({
    operation: "legacy_account_ownership_evidence_preflight_v1",
    mode: "candidate_discovery",
    result: "discovered",
    readOnly: true,
    databaseSideEffects: false,
    appUserCandidates: Object.freeze(appUserCandidates),
    legacyOwnerCandidates: Object.freeze(legacyOwnerCandidates),
    accountRows: Object.freeze({
      total: normalizedAccounts.length,
      canonicalUnassigned: normalizedAccounts.filter(
        ({ canonicalOwnerUserId }) => canonicalOwnerUserId === null,
      ).length,
      canonicalAssigned: normalizedAccounts.filter(
        ({ canonicalOwnerUserId }) => canonicalOwnerUserId !== null,
      ).length,
    }),
    evidenceDigest: digestDiscoveryEvidence(
      normalizedAppUsers,
      normalizedAccounts,
    ),
    plannedWrites: zeroWrites(),
  });
}

export function buildLegacyAccountOwnershipPreflight({
  appUsers,
  accounts,
  targetAppUserSha256,
  legacyOwnerSha256,
  intentionallySkippedTables = [],
}) {
  if (!isSha256Fingerprint(targetAppUserSha256)) {
    throw new LegacyAccountOwnershipArgumentError(
      "invalid_target_app_user_sha256",
    );
  }
  if (!isSha256Fingerprint(legacyOwnerSha256)) {
    throw new LegacyAccountOwnershipArgumentError(
      "invalid_legacy_owner_sha256",
    );
  }

  const normalizedAppUsers = normalizeAppUsers(appUsers);
  const normalizedAccounts = normalizeAccounts(accounts);
  const targetMatches = normalizedAppUsers.filter(
    (appUser) =>
      fingerprintAppUserId(appUser.id) === targetAppUserSha256,
  );
  const target = targetMatches.length === 1 ? targetMatches[0] : null;
  const blockers = [];

  if (targetMatches.length === 0) blockers.push("target_app_user_not_found");
  if (targetMatches.length > 1) blockers.push("target_app_user_ambiguous");
  if (
    target !== null &&
    (target.status !== "provisioning" || target.role !== "user")
  ) {
    blockers.push("target_app_user_state_mismatch");
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
    const classification = classifyAccount({
      legacyFingerprint,
      canonicalFingerprint,
      targetAppUserSha256,
      legacyOwnerSha256,
    });

    return {
      accountId: account.id,
      legacyFingerprint,
      canonicalFingerprint,
      classification,
    };
  });

  const classifications = Object.freeze({
    eligible: countClassification(classifiedRows, "eligible"),
    alreadyAssigned: countClassification(classifiedRows, "already_assigned"),
    foreignOwnerConflict: countClassification(
      classifiedRows,
      "foreign_owner_conflict",
    ),
    missingLegacyEvidence: countClassification(
      classifiedRows,
      "missing_legacy_evidence",
    ),
    unresolved: countClassification(classifiedRows, "unresolved"),
  });
  const matchingLegacyRows = classifiedRows.filter(
    ({ legacyFingerprint }) => legacyFingerprint === legacyOwnerSha256,
  ).length;

  if (matchingLegacyRows === 0) blockers.push("legacy_owner_evidence_not_found");

  const findings = [];
  if (classifications.foreignOwnerConflict > 0) {
    findings.push("foreign_owner_conflict_present");
  }
  if (classifications.missingLegacyEvidence > 0) {
    findings.push("missing_legacy_evidence_present");
  }
  if (classifications.unresolved > 0) {
    findings.push("unresolved_account_rows_present");
  }

  const result =
    blockers.length > 0
      ? "blocked"
      : findings.length > 0
        ? "review_required"
        : "evidence_ready";

  return Object.freeze({
    operation: "legacy_account_ownership_evidence_preflight_v1",
    mode: "evaluation",
    result,
    readOnly: true,
    databaseSideEffects: false,
    target: Object.freeze({
      fingerprint: targetAppUserSha256,
      matchCount: targetMatches.length,
      status: target?.status ?? null,
      role: target?.role ?? null,
    }),
    legacyEvidence: Object.freeze({
      fingerprint: legacyOwnerSha256,
      matchingRows: matchingLegacyRows,
    }),
    accountRows: normalizedAccounts.length,
    classifications,
    candidateSetDigest: digestCandidateSet(
      targetAppUserSha256,
      legacyOwnerSha256,
      classifiedRows,
    ),
    eligibleSetDigest: digestEligibleSet(classifiedRows),
    intentionallySkippedTables: Object.freeze(
      [...intentionallySkippedTables].sort(compareAscii),
    ),
    blockers: Object.freeze(blockers),
    findings: Object.freeze(findings),
    plannedWrites: zeroWrites(),
  });
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
  return rows.filter((row) => row.classification === classification).length;
}

function compareFingerprint(left, right) {
  return compareAscii(left.fingerprint, right.fingerprint);
}

function zeroWrites() {
  return Object.freeze({
    appUsers: 0,
    authIdentities: 0,
    accounts: 0,
    otherProductTables: 0,
  });
}
