import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LEGACY_CORE_OWNER_ASSIGNMENT_POLICY = Object.freeze({
  operation: "legacy_core_owner_assignment_v1",
  manifestVersion: "legacy_core_owner_assignment_manifest_v1",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export class LegacyCoreOwnerAssignmentError extends Error {
  constructor(code) {
    super("Legacy core owner assignment failed");
    this.name = "LegacyCoreOwnerAssignmentError";
    this.code = code;
  }
}

export function buildLegacyCoreOwnerAssignmentPlan({
  appUsers,
  authIdentities,
  accounts,
  assets,
  assetGroups,
  assetGroupMembers,
}) {
  assertArray(appUsers, "app_users_invalid");
  assertArray(authIdentities, "auth_identities_invalid");
  assertArray(accounts, "accounts_invalid");
  assertArray(assets, "assets_invalid");
  assertArray(assetGroups, "asset_groups_invalid");
  assertArray(assetGroupMembers, "asset_group_members_invalid");

  const targetOwnerUserId = resolveSingleActiveOwner({
    appUsers,
    authIdentities,
  });
  const accountById = normalizeAccounts(accounts, targetOwnerUserId);
  const normalizedAssets = normalizeAssets({
    rows: assets,
    accountById,
    targetOwnerUserId,
  });
  assertNoInstrumentCollisions(normalizedAssets);

  const normalizedGroups = normalizeOwnerRows({
    rows: assetGroups,
    tableName: "asset_groups",
    targetOwnerUserId,
  });
  const assetById = new Map(
    normalizedAssets.map((row) => [row.id, row]),
  );
  const groupById = new Map(
    normalizedGroups.map((row) => [row.id, row]),
  );
  const normalizedMembers = normalizeMembers({
    rows: assetGroupMembers,
    assetById,
    groupById,
    targetOwnerUserId,
  });

  const manifestRows = [
    ...normalizedAssets.map((row) => ({
      table: "assets",
      id: row.id,
      currentOwnerUserId: row.canonicalOwnerUserId,
      proposedOwnerUserId: targetOwnerUserId,
      accountId: row.accountId,
    })),
    ...normalizedGroups.map((row) => ({
      table: "asset_groups",
      id: row.id,
      currentOwnerUserId: row.canonicalOwnerUserId,
      proposedOwnerUserId: targetOwnerUserId,
    })),
    ...normalizedMembers.map((row) => ({
      table: "asset_group_members",
      id: row.id,
      currentOwnerUserId: row.canonicalOwnerUserId,
      proposedOwnerUserId: targetOwnerUserId,
      groupId: row.groupId,
      assetId: row.assetId,
    })),
  ].sort(compareManifestRows);

  const eligibleAssetIds = eligibleIds(normalizedAssets);
  const eligibleAssetGroupIds = eligibleIds(normalizedGroups);
  const eligibleAssetGroupMemberIds = eligibleIds(normalizedMembers);
  const plannedWrites = Object.freeze({
    assets: eligibleAssetIds.length,
    assetGroups: eligibleAssetGroupIds.length,
    assetGroupMembers: eligibleAssetGroupMemberIds.length,
  });
  const totalPlannedWrites = Object.values(plannedWrites).reduce(
    (sum, count) => sum + count,
    0,
  );

  return Object.freeze({
    state: totalPlannedWrites === 0 ? "already_applied" : "assignment_pending",
    targetOwnerUserId,
    ownerFingerprint: sha256("app-user-id-v1", targetOwnerUserId),
    manifestSha256: sha256(
      LEGACY_CORE_OWNER_ASSIGNMENT_POLICY.manifestVersion,
      stableStringify({
        targetOwnerUserId,
        rows: manifestRows,
      }),
    ),
    candidateCounts: Object.freeze({
      accounts: accountById.size,
      assets: normalizedAssets.length,
      assetGroups: normalizedGroups.length,
      assetGroupMembers: normalizedMembers.length,
    }),
    plannedWrites,
    eligibleIds: Object.freeze({
      assets: Object.freeze(eligibleAssetIds),
      assetGroups: Object.freeze(eligibleAssetGroupIds),
      assetGroupMembers: Object.freeze(eligibleAssetGroupMemberIds),
    }),
  });
}

function resolveSingleActiveOwner({ appUsers, authIdentities }) {
  if (appUsers.length !== 1) {
    throw new LegacyCoreOwnerAssignmentError("single_app_user_required");
  }
  const appUser = appUsers[0];
  const appUserId = canonicalUuid(
    readOwn(appUser, "id"),
    "app_user_invalid",
  );
  if (
    readOwn(appUser, "status") !== "active" ||
    !["user", "admin"].includes(readOwn(appUser, "role"))
  ) {
    throw new LegacyCoreOwnerAssignmentError("active_app_user_required");
  }

  const activeIdentities = authIdentities.filter(
    (identity) => readOwn(identity, "status") === "active",
  );
  if (activeIdentities.length !== 1) {
    throw new LegacyCoreOwnerAssignmentError(
      "single_active_identity_required",
    );
  }
  if (
    canonicalUuid(
      readOwn(activeIdentities[0], "app_user_id"),
      "auth_identity_invalid",
    ) !== appUserId
  ) {
    throw new LegacyCoreOwnerAssignmentError(
      "active_identity_owner_mismatch",
    );
  }
  return appUserId;
}

function normalizeAccounts(rows, targetOwnerUserId) {
  if (rows.length === 0) {
    throw new LegacyCoreOwnerAssignmentError("accounts_required");
  }
  const accountById = new Map();
  for (const row of rows) {
    const id = canonicalUuid(readOwn(row, "id"), "account_invalid");
    const canonicalOwnerUserId = canonicalOptionalUuid(
      readOwn(row, "canonical_owner_user_id"),
      "account_owner_invalid",
    );
    const code = normalizedText(readOwn(row, "code"), "account_invalid");
    if (canonicalOwnerUserId !== targetOwnerUserId) {
      throw new LegacyCoreOwnerAssignmentError(
        "account_owner_not_canonical",
      );
    }
    if (accountById.has(id)) {
      throw new LegacyCoreOwnerAssignmentError("account_duplicate");
    }
    accountById.set(
      id,
      Object.freeze({ id, code, canonicalOwnerUserId }),
    );
  }
  return accountById;
}

function normalizeAssets({ rows, accountById, targetOwnerUserId }) {
  const seenIds = new Set();
  return rows.map((row) => {
    const id = canonicalUuid(readOwn(row, "id"), "asset_invalid");
    if (seenIds.has(id)) {
      throw new LegacyCoreOwnerAssignmentError("asset_duplicate");
    }
    seenIds.add(id);
    const accountId = canonicalUuid(
      readOwn(row, "account_id"),
      "asset_account_required",
    );
    const account = accountById.get(accountId);
    if (!account) {
      throw new LegacyCoreOwnerAssignmentError(
        "asset_account_relationship_invalid",
      );
    }
    const accountCode = normalizedText(
      readOwn(row, "account"),
      "asset_account_relationship_invalid",
    );
    if (accountCode !== account.code) {
      throw new LegacyCoreOwnerAssignmentError(
        "asset_account_relationship_invalid",
      );
    }
    const canonicalOwnerUserId = canonicalOptionalUuid(
      readOwn(row, "canonical_owner_user_id"),
      "asset_owner_invalid",
    );
    assertAssignableOwner(
      canonicalOwnerUserId,
      targetOwnerUserId,
      "asset_owner_conflict",
    );
    return Object.freeze({
      id,
      accountId,
      canonicalOwnerUserId,
      market: normalizedText(readOwn(row, "market"), "asset_invalid")
        .toLowerCase(),
      currency: normalizedText(readOwn(row, "currency"), "asset_invalid")
        .toUpperCase(),
      ticker: normalizedOptionalText(readOwn(row, "ticker"))?.toUpperCase() ?? null,
    });
  });
}

function normalizeOwnerRows({ rows, tableName, targetOwnerUserId }) {
  const seenIds = new Set();
  return rows.map((row) => {
    const id = canonicalUuid(
      readOwn(row, "id"),
      `${tableName}_invalid`,
    );
    if (seenIds.has(id)) {
      throw new LegacyCoreOwnerAssignmentError(`${tableName}_duplicate`);
    }
    seenIds.add(id);
    const canonicalOwnerUserId = canonicalOptionalUuid(
      readOwn(row, "canonical_owner_user_id"),
      `${tableName}_owner_invalid`,
    );
    assertAssignableOwner(
      canonicalOwnerUserId,
      targetOwnerUserId,
      `${tableName}_owner_conflict`,
    );
    return Object.freeze({ id, canonicalOwnerUserId });
  });
}

function normalizeMembers({
  rows,
  assetById,
  groupById,
  targetOwnerUserId,
}) {
  const normalized = normalizeOwnerRows({
    rows,
    tableName: "asset_group_members",
    targetOwnerUserId,
  });
  return normalized.map((base, index) => {
    const row = rows[index];
    const groupId = canonicalUuid(
      readOwn(row, "group_id"),
      "asset_group_member_relationship_invalid",
    );
    const assetId = canonicalUuid(
      readOwn(row, "asset_id"),
      "asset_group_member_relationship_invalid",
    );
    if (!groupById.has(groupId) || !assetById.has(assetId)) {
      throw new LegacyCoreOwnerAssignmentError(
        "asset_group_member_relationship_invalid",
      );
    }
    return Object.freeze({ ...base, groupId, assetId });
  });
}

function assertNoInstrumentCollisions(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (row.ticker === null) continue;
    const key = [row.accountId, row.market, row.currency, row.ticker].join("\0");
    if (seen.has(key)) {
      throw new LegacyCoreOwnerAssignmentError(
        "asset_owner_instrument_collision",
      );
    }
    seen.add(key);
  }
}

function assertAssignableOwner(currentOwner, targetOwner, code) {
  if (currentOwner !== null && currentOwner !== targetOwner) {
    throw new LegacyCoreOwnerAssignmentError(code);
  }
}

function eligibleIds(rows) {
  return rows
    .filter((row) => row.canonicalOwnerUserId === null)
    .map((row) => row.id)
    .sort(compareAscii);
}

function canonicalUuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new LegacyCoreOwnerAssignmentError(code);
  }
  return value.trim().toLowerCase();
}

function canonicalOptionalUuid(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return canonicalUuid(value, code);
}

function normalizedText(value, code) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LegacyCoreOwnerAssignmentError(code);
  }
  return value.trim();
}

function normalizedOptionalText(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new LegacyCoreOwnerAssignmentError("asset_invalid");
  }
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function assertArray(value, code) {
  if (!Array.isArray(value)) {
    throw new LegacyCoreOwnerAssignmentError(code);
  }
}

function compareManifestRows(left, right) {
  const tableComparison = compareAscii(left.table, right.table);
  return tableComparison === 0
    ? compareAscii(left.id, right.id)
    : tableComparison;
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${value}`)
    .digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareAscii)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readOwn(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
