import path from "node:path";

import {
  classifyCanonicalOwnerAction,
  isCanonicalUuid,
  prepareCanonicalMigrationShadowOwner,
  summarizeCanonicalOwnerActions,
} from "./migration-canonical-owner-shadow.mjs";

export const CORE_CANONICAL_TABLES = Object.freeze([
  "accounts",
  "asset_groups",
  "assets",
  "asset_group_members",
]);

export class CoreImportArgumentError extends Error {
  constructor(code) {
    super("Base44 core import arguments are invalid");
    this.name = "CoreImportArgumentError";
    this.code = code;
  }
}

export function parseBase44CoreArgs(
  argv,
  {
    defaultDataDir = path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    legacyOwnerUserId = "base44-import",
  } = {},
) {
  const args = {
    dataDir: defaultDataDir,
    write: false,
    ownerUserId: legacyOwnerUserId,
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
      ["--data-dir", "--owner-user-id", "--canonical-owner-id"].includes(arg) &&
      !seen.has(arg)
    ) {
      seen.add(arg);
      const value = argv[index + 1] ?? "";
      index += 1;

      if (arg === "--data-dir") args.dataDir = path.resolve(value);
      if (arg === "--owner-user-id") args.ownerUserId = value;
      if (arg === "--canonical-owner-id") {
        args.canonicalOwnerId = value.trim().toLowerCase();
      }
      continue;
    }

    throw new CoreImportArgumentError("unsupported_or_duplicate_argument");
  }

  if (!args.ownerUserId.trim()) {
    throw new CoreImportArgumentError("missing_legacy_owner_evidence");
  }
  if (
    args.canonicalOwnerId !== null &&
    !isCanonicalUuid(args.canonicalOwnerId)
  ) {
    throw new CoreImportArgumentError("invalid_canonical_owner_id");
  }
  if (args.approveProvisioningOwner && args.canonicalOwnerId === null) {
    throw new CoreImportArgumentError("approval_without_canonical_owner");
  }
  if (args.write && args.canonicalOwnerId !== null) {
    throw new CoreImportArgumentError("canonical_owner_write_not_enabled");
  }

  return Object.freeze(args);
}

export function buildBase44CoreCanonicalPlan({
  canonicalOwnerId,
  approveProvisioningOwner,
  legacyOwnerUserId,
  appUser,
  tables,
}) {
  const normalizedTables = normalizeTables(tables);
  const ownerPreparation = prepareCanonicalMigrationShadowOwner({
    canonicalOwnerId,
    approveProvisioningOwner,
    legacyOwnerUserId,
    appUser,
  });
  const blockers = [...ownerPreparation.blockers];

  const globalBlock = blockers.length > 0;
  const accountActions = normalizedTables.accounts.map((row) =>
    classifyCanonicalOwnerAction({
      exists: row.exists,
      existingCanonicalOwnerId: row.canonicalOwnerUserId,
      canonicalOwnerId,
      blocked: globalBlock,
    }),
  );
  const groupActions = normalizedTables.asset_groups.map((row) =>
    classifyCanonicalOwnerAction({
      exists: row.exists,
      existingCanonicalOwnerId: row.canonicalOwnerUserId,
      canonicalOwnerId,
      blocked: globalBlock,
    }),
  );
  const relationshipChecks = {
    assetAccount: 0,
    assetGroup: 0,
    memberGroup: 0,
    memberAsset: 0,
    blocked: 0,
  };

  const assetActions = normalizedTables.assets.map((row) => {
    let action = classifyCanonicalOwnerAction({
      exists: row.exists,
      existingCanonicalOwnerId: row.canonicalOwnerUserId,
      canonicalOwnerId,
      blocked: globalBlock,
    });
    relationshipChecks.assetAccount += 1;
    if (
      !globalBlock &&
      (!parentActionAllowed(accountActions, row.accountIndex) ||
        !row.accountReferenceMatches)
    ) {
      action = "block";
      relationshipChecks.blocked += 1;
    }

    if (row.groupIndex !== null) {
      relationshipChecks.assetGroup += 1;
      if (
        !globalBlock &&
        (!parentActionAllowed(groupActions, row.groupIndex) ||
          !row.groupReferenceMatches)
      ) {
        action = "block";
        relationshipChecks.blocked += 1;
      }
    } else if (!globalBlock && !row.groupReferenceMatches) {
      action = "block";
      relationshipChecks.blocked += 1;
    }

    return action;
  });

  const memberActions = normalizedTables.asset_group_members.map((row) => {
    let action = classifyCanonicalOwnerAction({
      exists: row.exists,
      existingCanonicalOwnerId: row.canonicalOwnerUserId,
      canonicalOwnerId,
      blocked: globalBlock,
    });
    relationshipChecks.memberGroup += 1;
    relationshipChecks.memberAsset += 1;

    if (
      !globalBlock &&
      (!parentActionAllowed(groupActions, row.groupIndex) ||
        !row.groupReferenceMatches)
    ) {
      action = "block";
      relationshipChecks.blocked += 1;
    }
    if (
      !globalBlock &&
      (!parentActionAllowed(assetActions, row.assetIndex) ||
        !row.assetReferenceMatches)
    ) {
      action = "block";
      relationshipChecks.blocked += 1;
    }

    return action;
  });

  const tablePlans = Object.freeze({
    accounts: summarizeCanonicalOwnerActions(accountActions),
    asset_groups: summarizeCanonicalOwnerActions(groupActions),
    assets: summarizeCanonicalOwnerActions(assetActions),
    asset_group_members: summarizeCanonicalOwnerActions(memberActions),
  });
  const blockedRows = Object.values(tablePlans).reduce(
    (sum, plan) => sum + plan.block,
    0,
  );

  if (blockedRows > 0 && !globalBlock) {
    if (hasForeignOwner(normalizedTables, canonicalOwnerId)) {
      blockers.push("cross_owner_assignment_detected");
    }
    if (relationshipChecks.blocked > 0) {
      blockers.push("parent_child_contract_mismatch");
    }
  }

  const plannedAssignments = Object.values(tablePlans).reduce(
    (sum, plan) => sum + plan.insert + plan.update,
    0,
  );

  return Object.freeze({
    operation: "base44_core_canonical_owner",
    phase: "1E-A",
    mode: "shadow",
    source: "migration_cli",
    result:
      blockers.length === 0 && blockedRows === 0 ? "planned" : "blocked",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled:
      ownerPreparation.context?.tenantWriteContext.writesCanonicalOwner ===
      true,
    databaseSideEffects: false,
    tables: tablePlans,
    relationships: Object.freeze(relationshipChecks),
    plannedCanonicalAssignments: plannedAssignments,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

function normalizeTables(tables) {
  const normalized = {};
  for (const table of CORE_CANONICAL_TABLES) {
    if (!Array.isArray(tables?.[table])) {
      throw new CoreImportArgumentError("invalid_canonical_plan_state");
    }
    normalized[table] = tables[table];
  }
  return normalized;
}

function parentActionAllowed(actions, index) {
  return (
    Number.isSafeInteger(index) &&
    index >= 0 &&
    index < actions.length &&
    actions[index] !== "block"
  );
}

function hasForeignOwner(tables, canonicalOwnerId) {
  return CORE_CANONICAL_TABLES.some((table) =>
    tables[table].some(
      (row) =>
        row.exists &&
        row.canonicalOwnerUserId !== null &&
        row.canonicalOwnerUserId !== canonicalOwnerId,
    ),
  );
}
