import path from "node:path";

import {
  TenantWritePolicyError,
  prepareMigrationOwnerContext,
} from "../../src/lib/tenant-write-context.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    !UUID_PATTERN.test(args.canonicalOwnerId)
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
  const blockers = [];
  let context = null;

  if (appUser === null) {
    blockers.push("canonical_owner_not_found");
  } else if (appUser.role !== "user") {
    blockers.push("canonical_owner_role_not_allowed");
  } else {
    try {
      context = prepareMigrationOwnerContext({
        mode: "shadow",
        legacyOwnerUserId,
        canonicalOwnerUserId: canonicalOwnerId,
        canonicalOwnerStatus: appUser.status,
        canonicalOwnerVerified: true,
        provisioningOwnerApproved: approveProvisioningOwner,
      });
    } catch (error) {
      if (!(error instanceof TenantWritePolicyError)) throw error;
      blockers.push(`canonical_owner_context_${error.code}`);
    }
  }

  const globalBlock = blockers.length > 0;
  const accountActions = normalizedTables.accounts.map((row) =>
    classifyRow(row, canonicalOwnerId, globalBlock),
  );
  const groupActions = normalizedTables.asset_groups.map((row) =>
    classifyRow(row, canonicalOwnerId, globalBlock),
  );
  const relationshipChecks = {
    assetAccount: 0,
    assetGroup: 0,
    memberGroup: 0,
    memberAsset: 0,
    blocked: 0,
  };

  const assetActions = normalizedTables.assets.map((row) => {
    let action = classifyRow(row, canonicalOwnerId, globalBlock);
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
    let action = classifyRow(row, canonicalOwnerId, globalBlock);
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
    accounts: summarizeActions(accountActions),
    asset_groups: summarizeActions(groupActions),
    assets: summarizeActions(assetActions),
    asset_group_members: summarizeActions(memberActions),
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
      context?.tenantWriteContext.writesCanonicalOwner === true,
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

function classifyRow(row, canonicalOwnerId, globalBlock) {
  if (globalBlock) return "block";
  if (!row.exists) return "insert";
  if (row.canonicalOwnerUserId === null) return "update";
  if (row.canonicalOwnerUserId === canonicalOwnerId) return "skip";
  return "block";
}

function summarizeActions(actions) {
  const counts = { insert: 0, update: 0, skip: 0, block: 0 };
  for (const action of actions) counts[action] += 1;
  return Object.freeze(counts);
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
