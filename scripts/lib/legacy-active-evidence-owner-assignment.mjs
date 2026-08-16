import { createHash } from "node:crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/i;

export const LEGACY_ACTIVE_EVIDENCE_TABLES = Object.freeze({
  accountBalanceSnapshots: "account_balance_snapshots",
  dailyPortfolioSnapshots: "daily_portfolio_snapshots",
  dailyPositionSnapshots: "daily_position_snapshots",
  eventLedgerEntries: "event_ledger_entries",
  marketRegimeDaily: "market_regime_daily",
  settings: "settings",
});

export const LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_POLICY = Object.freeze({
  operation: "legacy_active_evidence_owner_assignment_v1",
  manifestVersion: "legacy_active_evidence_owner_assignment_manifest_v1",
  transactionIsolation: "read_committed",
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 8_000,
  retryCount: 0,
});

export class LegacyActiveEvidenceOwnerAssignmentError extends Error {
  constructor(code) {
    super("Legacy active evidence owner assignment failed");
    this.name = "LegacyActiveEvidenceOwnerAssignmentError";
    this.code = code;
  }
}

export function buildLegacyActiveEvidenceOwnerAssignmentPlan({
  appUsers,
  authIdentities,
  accounts,
  assets,
  assetGroups,
  accountBalanceSnapshots,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  marketRegimeDaily,
  settings,
}) {
  const arrays = {
    appUsers,
    authIdentities,
    accounts,
    assets,
    assetGroups,
    accountBalanceSnapshots,
    dailyPortfolioSnapshots,
    dailyPositionSnapshots,
    eventLedgerEntries,
    marketRegimeDaily,
    settings,
  };
  for (const [name, rows] of Object.entries(arrays)) {
    assertArray(rows, `${camelToSnake(name)}_invalid`);
  }

  const targetOwnerUserId = resolveSingleActiveOwner({
    appUsers,
    authIdentities,
  });
  const accountById = normalizeOwnedAccounts(accounts, targetOwnerUserId);
  const assetById = normalizeOwnedReferences({
    rows: assets,
    name: "asset",
    targetOwnerUserId,
    extra: (row) => ({
      accountId: canonicalUuid(
        readOwn(row, "account_id"),
        "asset_account_invalid",
      ),
    }),
  });
  const groupById = normalizeOwnedReferences({
    rows: assetGroups,
    name: "asset_group",
    targetOwnerUserId,
  });

  for (const asset of assetById.values()) {
    if (!accountById.has(asset.accountId)) {
      fail("asset_account_invalid");
    }
  }

  const normalized = {
    accountBalanceSnapshots: normalizeSimpleLegacyRows({
      rows: accountBalanceSnapshots,
      table: LEGACY_ACTIVE_EVIDENCE_TABLES.accountBalanceSnapshots,
      targetOwnerUserId,
    }),
    dailyPortfolioSnapshots: normalizePortfolioSnapshots({
      rows: dailyPortfolioSnapshots,
      accountById,
      targetOwnerUserId,
    }),
    dailyPositionSnapshots: normalizePositionSnapshots({
      rows: dailyPositionSnapshots,
      accountById,
      assetById,
      targetOwnerUserId,
    }),
    eventLedgerEntries: normalizeEvents({
      rows: eventLedgerEntries,
      accountById,
      assetById,
      groupById,
      targetOwnerUserId,
    }),
    marketRegimeDaily: normalizeMarketRegimes({
      rows: marketRegimeDaily,
      accountById,
      targetOwnerUserId,
    }),
    settings: normalizeSimpleLegacyRows({
      rows: settings,
      table: LEGACY_ACTIVE_EVIDENCE_TABLES.settings,
      targetOwnerUserId,
    }),
  };

  const totalCandidates = Object.values(normalized).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  if (totalCandidates === 0) fail("legacy_active_evidence_required");

  const manifestRows = Object.entries(normalized)
    .flatMap(([key, rows]) =>
      rows.map((row) => ({
        table: LEGACY_ACTIVE_EVIDENCE_TABLES[key],
        id: row.id,
        legacyBase44Id: row.legacyBase44Id,
        currentOwnerUserId: row.canonicalOwnerUserId,
        proposedOwnerUserId: targetOwnerUserId,
        ...row.manifestReferences,
      })),
    )
    .sort(compareManifestRows);

  const eligibleIds = Object.fromEntries(
    Object.entries(normalized).map(([key, rows]) => [
      key,
      Object.freeze(
        rows
          .filter((row) => row.canonicalOwnerUserId === null)
          .map((row) => row.id)
          .sort(compareAscii),
      ),
    ]),
  );
  const candidateCounts = Object.freeze(
    Object.fromEntries(
      Object.entries(normalized).map(([key, rows]) => [key, rows.length]),
    ),
  );
  const plannedWrites = Object.freeze(
    Object.fromEntries(
      Object.entries(eligibleIds).map(([key, ids]) => [key, ids.length]),
    ),
  );
  const totalPlannedWrites = Object.values(plannedWrites).reduce(
    (sum, count) => sum + count,
    0,
  );

  return Object.freeze({
    state: totalPlannedWrites === 0 ? "already_applied" : "assignment_pending",
    targetOwnerUserId,
    ownerFingerprint: sha256("app-user-id-v1", targetOwnerUserId),
    manifestSha256: sha256(
      LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_POLICY.manifestVersion,
      stableStringify({ targetOwnerUserId, rows: manifestRows }),
    ),
    candidateCounts,
    plannedWrites,
    eligibleIds: Object.freeze(eligibleIds),
  });
}

function normalizeSimpleLegacyRows({ rows, table, targetOwnerUserId }) {
  return normalizeLegacyRows({
    rows,
    table,
    targetOwnerUserId,
    buildReferences: () => ({}),
  });
}

function normalizePortfolioSnapshots({
  rows,
  accountById,
  targetOwnerUserId,
}) {
  const normalized = normalizeLegacyRows({
    rows,
    table: LEGACY_ACTIVE_EVIDENCE_TABLES.dailyPortfolioSnapshots,
    targetOwnerUserId,
    buildReferences: (row) => {
      assertBase44Import(row, "portfolio_snapshot_source_invalid");
      const account = normalizedAccount(
        readOwn(row, "account"),
        "portfolio_snapshot_account_invalid",
      );
      const accountId = canonicalOptionalUuid(
        readOwn(row, "account_id"),
        "portfolio_snapshot_account_invalid",
      );
      if (account === "all") {
        if (accountId !== null) fail("portfolio_snapshot_account_invalid");
      } else {
        assertAccountRelationship({
          account,
          accountId,
          accountById,
          code: "portfolio_snapshot_account_invalid",
        });
      }
      return {
        snapshotDate: normalizedDate(
          readOwn(row, "snapshot_date"),
          "portfolio_snapshot_date_invalid",
        ),
        account,
        accountId,
        source: "base44_import",
      };
    },
  });
  assertUniqueKeys(
    normalized,
    (row) => [
      row.manifestReferences.snapshotDate,
      row.manifestReferences.account,
      row.manifestReferences.source,
    ],
    "portfolio_snapshot_key_collision",
  );
  return normalized;
}

function normalizePositionSnapshots({
  rows,
  accountById,
  assetById,
  targetOwnerUserId,
}) {
  const normalized = normalizeLegacyRows({
    rows,
    table: LEGACY_ACTIVE_EVIDENCE_TABLES.dailyPositionSnapshots,
    targetOwnerUserId,
    buildReferences: (row) => {
      assertBase44Import(row, "position_snapshot_source_invalid");
      const account = normalizedAccount(
        readOwn(row, "account"),
        "position_snapshot_account_invalid",
      );
      const accountId = canonicalUuid(
        readOwn(row, "account_id"),
        "position_snapshot_account_invalid",
      );
      assertAccountRelationship({
        account,
        accountId,
        accountById,
        code: "position_snapshot_account_invalid",
      });
      const assetId = canonicalOptionalUuid(
        readOwn(row, "asset_id"),
        "position_snapshot_asset_invalid",
      );
      const legacyAssetId = canonicalLegacyId(
        readOwn(row, "legacy_asset_id"),
        "position_snapshot_asset_invalid",
      );
      if (assetId !== null) {
        const asset = assetById.get(assetId);
        if (!asset || asset.accountId !== accountId) {
          fail("position_snapshot_asset_invalid");
        }
      }
      return {
        snapshotDate: normalizedDate(
          readOwn(row, "snapshot_date"),
          "position_snapshot_date_invalid",
        ),
        account,
        accountId,
        assetId,
        legacyAssetId,
        source: "base44_import",
      };
    },
  });
  assertUniqueKeys(
    normalized,
    (row) => [
      row.manifestReferences.snapshotDate,
      row.manifestReferences.account,
      row.manifestReferences.legacyAssetId,
      row.manifestReferences.source,
    ],
    "position_snapshot_key_collision",
  );
  return normalized;
}

function normalizeEvents({
  rows,
  accountById,
  assetById,
  groupById,
  targetOwnerUserId,
}) {
  const normalized = normalizeLegacyRows({
    rows,
    table: LEGACY_ACTIVE_EVIDENCE_TABLES.eventLedgerEntries,
    targetOwnerUserId,
    buildReferences: (row) => {
      const account = normalizedOptionalAccount(readOwn(row, "account"));
      const accountId = canonicalOptionalUuid(
        readOwn(row, "account_id"),
        "event_account_invalid",
      );
      if (accountId === null ? account !== null : account === null) {
        fail("event_account_invalid");
      }
      if (accountId !== null) {
        assertAccountRelationship({
          account,
          accountId,
          accountById,
          code: "event_account_invalid",
        });
      }
      const assetId = canonicalOptionalUuid(
        readOwn(row, "asset_id"),
        "event_asset_invalid",
      );
      if (assetId !== null) {
        const asset = assetById.get(assetId);
        if (!asset || (accountId !== null && asset.accountId !== accountId)) {
          fail("event_asset_invalid");
        }
      }
      const groupId = canonicalOptionalUuid(
        readOwn(row, "group_id"),
        "event_group_invalid",
      );
      if (groupId !== null && !groupById.has(groupId)) {
        fail("event_group_invalid");
      }
      return {
        account,
        accountId,
        assetId,
        legacyAssetId: canonicalLegacyId(
          readOwn(row, "legacy_asset_id"),
          "event_asset_invalid",
        ),
        groupId,
        correctsEventId: canonicalOptionalUuid(
          readOwn(row, "corrects_event_id"),
          "event_correction_invalid",
        ),
      };
    },
  });
  const eventIds = new Set(normalized.map((row) => row.id));
  for (const row of normalized) {
    const correctsEventId = row.manifestReferences.correctsEventId;
    if (correctsEventId !== null && !eventIds.has(correctsEventId)) {
      fail("event_correction_invalid");
    }
  }
  return normalized;
}

function normalizeMarketRegimes({ rows, accountById, targetOwnerUserId }) {
  return normalizeLegacyRows({
    rows,
    table: LEGACY_ACTIVE_EVIDENCE_TABLES.marketRegimeDaily,
    targetOwnerUserId,
    buildReferences: (row) => {
      const account = normalizedAccount(
        readOwn(row, "account"),
        "market_regime_account_invalid",
      );
      const accountId = canonicalUuid(
        readOwn(row, "account_id"),
        "market_regime_account_invalid",
      );
      assertAccountRelationship({
        account,
        accountId,
        accountById,
        code: "market_regime_account_invalid",
      });
      return {
        regimeDate: normalizedDate(
          readOwn(row, "date"),
          "market_regime_date_invalid",
        ),
        account,
        accountId,
      };
    },
  });
}

function normalizeLegacyRows({
  rows,
  table,
  targetOwnerUserId,
  buildReferences,
}) {
  const seenIds = new Set();
  const seenLegacyIds = new Set();
  return rows.map((row) => {
    const id = canonicalUuid(readOwn(row, "id"), `${table}_row_invalid`);
    const legacyBase44Id = canonicalLegacyId(
      readOwn(row, "legacy_base44_id"),
      `${table}_legacy_id_invalid`,
    );
    if (seenIds.has(id) || seenLegacyIds.has(legacyBase44Id)) {
      fail(`${table}_row_duplicate`);
    }
    seenIds.add(id);
    seenLegacyIds.add(legacyBase44Id);
    const canonicalOwnerUserId = canonicalOptionalUuid(
      readOwn(row, "canonical_owner_user_id"),
      `${table}_owner_invalid`,
    );
    if (
      canonicalOwnerUserId !== null &&
      canonicalOwnerUserId !== targetOwnerUserId
    ) {
      fail(`${table}_owner_conflict`);
    }
    return Object.freeze({
      id,
      legacyBase44Id,
      canonicalOwnerUserId,
      manifestReferences: Object.freeze(buildReferences(row)),
    });
  });
}

function normalizeOwnedAccounts(rows, targetOwnerUserId) {
  if (rows.length === 0) fail("accounts_required");
  const result = new Map();
  const codes = new Set();
  for (const row of rows) {
    const id = canonicalUuid(readOwn(row, "id"), "account_invalid");
    const owner = canonicalUuid(
      readOwn(row, "canonical_owner_user_id"),
      "account_owner_not_canonical",
    );
    const code = normalizedAccount(readOwn(row, "code"), "account_invalid");
    if (owner !== targetOwnerUserId) fail("account_owner_not_canonical");
    if (result.has(id) || codes.has(code)) fail("account_duplicate");
    result.set(id, Object.freeze({ id, code }));
    codes.add(code);
  }
  return result;
}

function normalizeOwnedReferences({
  rows,
  name,
  targetOwnerUserId,
  extra = () => ({}),
}) {
  const result = new Map();
  for (const row of rows) {
    const id = canonicalUuid(readOwn(row, "id"), `${name}_invalid`);
    const owner = canonicalUuid(
      readOwn(row, "canonical_owner_user_id"),
      `${name}_owner_not_canonical`,
    );
    if (owner !== targetOwnerUserId) fail(`${name}_owner_not_canonical`);
    if (result.has(id)) fail(`${name}_duplicate`);
    result.set(id, Object.freeze({ id, ...extra(row) }));
  }
  return result;
}

function resolveSingleActiveOwner({ appUsers, authIdentities }) {
  if (appUsers.length !== 1) fail("single_app_user_required");
  const appUser = appUsers[0];
  const ownerId = canonicalUuid(readOwn(appUser, "id"), "app_user_invalid");
  if (
    readOwn(appUser, "status") !== "active" ||
    !["user", "admin"].includes(readOwn(appUser, "role"))
  ) {
    fail("active_app_user_required");
  }
  const activeIdentities = authIdentities.filter(
    (identity) => readOwn(identity, "status") === "active",
  );
  if (activeIdentities.length !== 1) fail("single_active_identity_required");
  if (
    canonicalUuid(
      readOwn(activeIdentities[0], "app_user_id"),
      "auth_identity_invalid",
    ) !== ownerId
  ) {
    fail("active_identity_owner_mismatch");
  }
  return ownerId;
}

function assertAccountRelationship({
  account,
  accountId,
  accountById,
  code,
}) {
  const referenced = accountId === null ? null : accountById.get(accountId);
  if (!referenced || referenced.code !== account) fail(code);
}

function assertBase44Import(row, code) {
  if (readOwn(row, "source") !== "base44_import") fail(code);
}

function assertUniqueKeys(rows, selectKey, code) {
  const seen = new Set();
  for (const row of rows) {
    const key = selectKey(row).join("\0");
    if (seen.has(key)) fail(code);
    seen.add(key);
  }
}

function canonicalUuid(value, code) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) fail(code);
  return value.trim().toLowerCase();
}

function canonicalOptionalUuid(value, code) {
  if (value === null || value === undefined || value === "") return null;
  return canonicalUuid(value, code);
}

function canonicalLegacyId(value, code) {
  if (typeof value !== "string" || !LEGACY_ID_PATTERN.test(value.trim())) {
    fail(code);
  }
  return value.trim().toLowerCase();
}

function normalizedAccount(value, code) {
  if (typeof value !== "string" || value.trim().length === 0) fail(code);
  return value.trim().toLowerCase();
}

function normalizedOptionalAccount(value) {
  if (value === null || value === undefined || value === "") return null;
  return normalizedAccount(value, "event_account_invalid");
}

function normalizedDate(value, code) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())
  ) {
    fail(code);
  }
  return value.trim();
}

function assertArray(value, code) {
  if (!Array.isArray(value)) fail(code);
}

function camelToSnake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function compareManifestRows(left, right) {
  const table = compareAscii(left.table, right.table);
  return table === 0 ? compareAscii(left.id, right.id) : table;
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
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
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
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function fail(code) {
  throw new LegacyActiveEvidenceOwnerAssignmentError(code);
}
