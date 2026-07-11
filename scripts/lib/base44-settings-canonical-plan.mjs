import path from "node:path";

import {
  classifyCanonicalOwnerAction,
  isCanonicalUuid,
  prepareCanonicalMigrationShadowOwner,
  shadowFingerprint,
  summarizeCanonicalOwnerActions,
} from "./migration-canonical-owner-shadow.mjs";

export class SettingsImportArgumentError extends Error {
  constructor(code) {
    super("Base44 settings import arguments are invalid");
    this.name = "SettingsImportArgumentError";
    this.code = code;
  }
}

export function parseBase44SettingsArgs(
  argv,
  {
    defaultDataDir = path.resolve(
      process.cwd(),
      "..",
      "gyeol-fin",
      "migration-data",
    ),
  } = {},
) {
  const args = {
    dataDir: defaultDataDir,
    write: false,
    canonicalOwnerId: null,
    approveProvisioningOwner: false,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write" && !seen.has(arg)) {
      seen.add(arg);
      args.write = true;
      continue;
    }

    if (arg === "--approve-provisioning-owner" && !seen.has(arg)) {
      seen.add(arg);
      args.approveProvisioningOwner = true;
      continue;
    }

    if (
      ["--data-dir", "--canonical-owner-id"].includes(arg) &&
      !seen.has(arg)
    ) {
      seen.add(arg);
      const value = argv[index + 1] ?? "";
      index += 1;

      if (arg === "--data-dir") args.dataDir = path.resolve(value);
      if (arg === "--canonical-owner-id") {
        args.canonicalOwnerId = value.trim().toLowerCase();
      }
      continue;
    }

    throw new SettingsImportArgumentError("unsupported_or_duplicate_argument");
  }

  if (
    args.canonicalOwnerId !== null &&
    !isCanonicalUuid(args.canonicalOwnerId)
  ) {
    throw new SettingsImportArgumentError("invalid_canonical_owner_id");
  }
  if (args.approveProvisioningOwner && args.canonicalOwnerId === null) {
    throw new SettingsImportArgumentError("approval_without_canonical_owner");
  }
  if (args.write && args.canonicalOwnerId !== null) {
    throw new SettingsImportArgumentError("canonical_owner_write_not_enabled");
  }

  return Object.freeze(args);
}

export function buildBase44SettingsCanonicalPlan({
  canonicalOwnerId,
  approveProvisioningOwner,
  appUser,
  sourceRows,
  databaseRows,
}) {
  const ownerPreparation = prepareCanonicalMigrationShadowOwner({
    canonicalOwnerId,
    approveProvisioningOwner,
    appUser,
  });
  const reasons = [...ownerPreparation.blockers];
  const sourceCandidate = sourceRows.length === 1 ? sourceRows[0] : null;

  if (sourceRows.length !== 1) {
    reasons.push("ambiguous_source_candidate_count");
  }
  if (databaseRows.length > 1) {
    reasons.push("ambiguous_database_candidate_count");
  }
  if (
    sourceCandidate !== null &&
    databaseRows.length === 1 &&
    databaseRows[0].legacyBase44Id !== sourceCandidate.legacyBase44Id
  ) {
    reasons.push("database_candidate_identity_mismatch");
  }

  const blocked = reasons.length > 0;
  const databaseCandidate = databaseRows.length === 1 ? databaseRows[0] : null;
  const action = classifyCanonicalOwnerAction({
    exists: databaseCandidate !== null,
    existingCanonicalOwnerId:
      databaseCandidate?.canonicalOwnerUserId ?? null,
    canonicalOwnerId,
    blocked,
  });

  if (
    action === "block" &&
    !blocked &&
    databaseCandidate?.canonicalOwnerUserId !== null
  ) {
    reasons.push("canonical_owner_conflict");
  }

  const tablePlan = summarizeCanonicalOwnerActions([action]);
  const result =
    reasons.length === 0 && action !== "block" ? "planned" : "blocked";
  const reason =
    reasons[0] ??
    {
      insert: "settings_candidate_absent",
      update: "canonical_owner_missing",
      skip: "canonical_owner_already_matches",
    }[action];
  const databaseFingerprintState = databaseRows.map((row) => ({
    candidateMatch:
      sourceCandidate !== null &&
      row.legacyBase44Id === sourceCandidate.legacyBase44Id,
    ownerState:
      row.canonicalOwnerUserId === null
        ? "missing"
        : row.canonicalOwnerUserId === canonicalOwnerId
          ? "same"
          : "different",
  }));

  return Object.freeze({
    operation: "base44_settings_canonical_owner",
    phase: "1E-B",
    mode: "shadow",
    source: "migration_cli",
    result,
    reason,
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled:
      ownerPreparation.context?.tenantWriteContext.writesCanonicalOwner ===
      true,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      source: sourceRows.length,
      database: databaseRows.length,
    }),
    fingerprints: Object.freeze({
      owner: shadowFingerprint(canonicalOwnerId),
      source: shadowFingerprint(sourceRows),
      databaseState: shadowFingerprint(databaseFingerprintState),
    }),
    tables: Object.freeze({ settings: tablePlan }),
    plannedCanonicalAssignments: tablePlan.insert + tablePlan.update,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}
