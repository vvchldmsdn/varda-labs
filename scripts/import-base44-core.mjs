import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { isExcludedBase44AssetType } from "./lib/base44-asset-policy.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_KEY_PATTERN = /(token|secret|password|api[_-]?key|created_by)/i;

const ACCOUNT_DEFINITIONS = [
  { code: "cash", name: "Cash", accountType: "cash", currency: "KRW", sortOrder: 0 },
  {
    code: "brokerage",
    name: "Brokerage",
    accountType: "brokerage",
    currency: "KRW",
    sortOrder: 10,
  },
  { code: "isa", name: "ISA", accountType: "isa", currency: "KRW", sortOrder: 20 },
  { code: "irp", name: "IRP", accountType: "irp", currency: "KRW", sortOrder: 30 },
];

function parseArgs(argv) {
  const args = {
    dataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    write: false,
    ownerUserId: process.env.IMPORT_OWNER_USER_ID ?? "base44-import",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write") {
      args.write = true;
      continue;
    }

    if (arg === "--data-dir") {
      args.dataDir = path.resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (arg === "--owner-user-id") {
      args.ownerUserId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.ownerUserId.trim()) {
    throw new Error("--owner-user-id cannot be empty");
  }

  return args;
}

function assertNoSensitiveKeys(value, sourceName, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitiveKeys(item, sourceName, [...keyPath, String(index)]),
    );
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = [...keyPath, key];
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(
        `${sourceName} contains blocked key "${nextPath.join(".")}". ` +
          "Use a sanitized export before importing.",
      );
    }
    assertNoSensitiveKeys(nestedValue, sourceName, nextPath);
  }
}

async function readJsonArray(filePath, sourceName) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  assertNoSensitiveKeys(parsed, sourceName);

  return parsed;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

function assertBase44Id(value, fieldName) {
  const normalized = requiredString(value, fieldName);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new Error(`${fieldName} must be a 24-character hex Base44 id`);
  }
  return normalized;
}

function optionalDecimal(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  return String(value);
}

function requiredDecimal(value, fieldName) {
  const normalized = optionalDecimal(value, fieldName);
  if (normalized === null) throw new Error(`${fieldName} is required`);
  return normalized;
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return numberValue;
}

function optionalBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function normalizeAssetGroup(record, sortOrder) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "AssetGroup.id"),
    name: requiredString(record.name, "AssetGroup.name"),
    targetWeight: optionalDecimal(record.target_weight, "AssetGroup.target_weight"),
    description: optionalString(record.description),
    color: optionalString(record.color),
    isActive: optionalBoolean(record.is_active, true),
    sortOrder: optionalInteger(record.sort_order, "AssetGroup.sort_order") ?? sortOrder,
    fxExempt: optionalBoolean(record.fx_exempt, false),
    maExempt: optionalBoolean(record.ma_exempt, false),
    executionMode: optionalString(record.execution_mode) ?? "gap_first",
  };
}

function normalizeAsset(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "Asset.id"),
    name: requiredString(record.name, "Asset.name"),
    ticker: optionalString(record.ticker),
    assetType: optionalString(record.asset_type) ?? "etf",
    category: optionalString(record.category),
    market: requiredString(record.market, "Asset.market"),
    currency: requiredString(record.currency, "Asset.currency"),
    account: requiredString(record.account, "Asset.account"),
    quantity: requiredDecimal(record.quantity, "Asset.quantity"),
    currentPrice: requiredDecimal(record.current_price, "Asset.current_price"),
    averageCost: optionalDecimal(record.average_cost, "Asset.average_cost"),
    targetWeight: optionalDecimal(record.target_weight, "Asset.target_weight"),
    legacyGroupId: optionalString(record.group_id),
    memo: optionalString(record.memo),
    description: optionalString(record.description),
    maAssetClass: optionalString(record.ma_asset_class),
    maRuleEnabled: optionalBoolean(record.ma_rule_enabled, true),
    ma120: optionalDecimal(record.ma_120, "Asset.ma_120"),
    daysAboveMa: optionalInteger(record.days_above_ma, "Asset.days_above_ma"),
    fractionalKrwValue: optionalDecimal(
      record.fractional_krw_value,
      "Asset.fractional_krw_value",
    ),
    fractionalAvgCost: optionalDecimal(
      record.fractional_avg_cost,
      "Asset.fractional_avg_cost",
    ),
    monthlyContribution: optionalDecimal(
      record.monthly_contribution,
      "Asset.monthly_contribution",
    ),
    contributionDay: optionalInteger(record.contribution_day, "Asset.contribution_day"),
  };
}

function summarize(normalizedGroups, normalizedAssets, excludedAssets) {
  const accountCodes = new Set(normalizedAssets.map((asset) => asset.account));
  const groupIds = new Set(normalizedGroups.map((group) => group.legacyBase44Id));
  const groupedAssets = normalizedAssets.filter((asset) => asset.legacyGroupId);
  const unmatchedGroups = groupedAssets.filter(
    (asset) => !groupIds.has(asset.legacyGroupId),
  );

  return {
    assetGroups: normalizedGroups.length,
    assets: normalizedAssets.length,
    excludedAssets: excludedAssets.length,
    excludedAssetTypes: [
      ...new Set(excludedAssets.map((asset) => asset.assetType)),
    ].sort(),
    accountCodes: [...accountCodes].sort(),
    groupedAssets: groupedAssets.length,
    unmatchedGroupRefs: unmatchedGroups.map((asset) => ({
      legacyBase44Id: asset.legacyBase44Id,
      name: asset.name,
      legacyGroupId: asset.legacyGroupId,
    })),
  };
}

async function upsertAccounts(sql, ownerUserId, accountCodes) {
  const accountMap = new Map();
  const selectedDefinitions = ACCOUNT_DEFINITIONS.filter((account) =>
    accountCodes.has(account.code),
  );

  for (const account of selectedDefinitions) {
    const [row] = await sql`
      insert into accounts (
        owner_user_id,
        code,
        name,
        account_type,
        currency,
        sort_order
      )
      values (
        ${ownerUserId},
        ${account.code},
        ${account.name},
        ${account.accountType},
        ${account.currency},
        ${account.sortOrder}
      )
      on conflict (owner_user_id, code) do update set
        name = excluded.name,
        account_type = excluded.account_type,
        currency = excluded.currency,
        sort_order = excluded.sort_order,
        updated_at = now()
      returning id, code
    `;

    accountMap.set(row.code, row.id);
  }

  return accountMap;
}

async function upsertAssetGroups(sql, ownerUserId, groups) {
  const groupMap = new Map();

  for (const group of groups) {
    const [row] = await sql`
      insert into asset_groups (
        legacy_base44_id,
        owner_user_id,
        name,
        target_weight,
        description,
        color,
        is_active,
        sort_order,
        fx_exempt,
        ma_exempt,
        execution_mode
      )
      values (
        ${group.legacyBase44Id},
        ${ownerUserId},
        ${group.name},
        ${group.targetWeight},
        ${group.description},
        ${group.color},
        ${group.isActive},
        ${group.sortOrder},
        ${group.fxExempt},
        ${group.maExempt},
        ${group.executionMode}
      )
      on conflict (legacy_base44_id) do update set
        owner_user_id = excluded.owner_user_id,
        name = excluded.name,
        target_weight = excluded.target_weight,
        description = excluded.description,
        color = excluded.color,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order,
        fx_exempt = excluded.fx_exempt,
        ma_exempt = excluded.ma_exempt,
        execution_mode = excluded.execution_mode,
        updated_at = now()
      returning id, legacy_base44_id
    `;

    groupMap.set(row.legacy_base44_id, row.id);
  }

  return groupMap;
}

async function upsertAssets(sql, accountMap, groupMap, assets) {
  const assetMap = new Map();

  for (const asset of assets) {
    const accountId = accountMap.get(asset.account);
    if (!accountId) {
      throw new Error(`No account id found for account "${asset.account}"`);
    }

    const groupId = asset.legacyGroupId ? groupMap.get(asset.legacyGroupId) : null;

    if (asset.legacyGroupId && !groupId) {
      throw new Error(
        `No asset group id found for legacy group "${asset.legacyGroupId}"`,
      );
    }

    const [row] = await sql`
      insert into assets (
        legacy_base44_id,
        name,
        ticker,
        asset_type,
        category,
        market,
        currency,
        account,
        account_id,
        quantity,
        current_price,
        average_cost,
        target_weight,
        group_id,
        memo,
        description,
        ma_asset_class,
        ma_rule_enabled,
        ma_120,
        days_above_ma,
        fractional_krw_value,
        fractional_avg_cost,
        monthly_contribution,
        contribution_day
      )
      values (
        ${asset.legacyBase44Id},
        ${asset.name},
        ${asset.ticker},
        ${asset.assetType},
        ${asset.category},
        ${asset.market},
        ${asset.currency},
        ${asset.account},
        ${accountId},
        ${asset.quantity},
        ${asset.currentPrice},
        ${asset.averageCost},
        ${asset.targetWeight},
        ${groupId},
        ${asset.memo},
        ${asset.description},
        ${asset.maAssetClass},
        ${asset.maRuleEnabled},
        ${asset.ma120},
        ${asset.daysAboveMa},
        ${asset.fractionalKrwValue},
        ${asset.fractionalAvgCost},
        ${asset.monthlyContribution},
        ${asset.contributionDay}
      )
      on conflict (legacy_base44_id) do update set
        name = excluded.name,
        ticker = excluded.ticker,
        asset_type = excluded.asset_type,
        category = excluded.category,
        market = excluded.market,
        currency = excluded.currency,
        account = excluded.account,
        account_id = excluded.account_id,
        quantity = excluded.quantity,
        current_price = excluded.current_price,
        average_cost = excluded.average_cost,
        target_weight = excluded.target_weight,
        group_id = excluded.group_id,
        memo = excluded.memo,
        description = excluded.description,
        ma_asset_class = excluded.ma_asset_class,
        ma_rule_enabled = excluded.ma_rule_enabled,
        ma_120 = excluded.ma_120,
        days_above_ma = excluded.days_above_ma,
        fractional_krw_value = excluded.fractional_krw_value,
        fractional_avg_cost = excluded.fractional_avg_cost,
        monthly_contribution = excluded.monthly_contribution,
        contribution_day = excluded.contribution_day,
        updated_at = now()
      returning id, legacy_base44_id
    `;

    assetMap.set(row.legacy_base44_id, row.id);
  }

  return assetMap;
}

async function upsertAssetGroupMembers(sql, ownerUserId, assets, assetMap, groupMap) {
  let count = 0;

  for (const asset of assets) {
    if (!asset.legacyGroupId) continue;

    const assetId = assetMap.get(asset.legacyBase44Id);
    const groupId = groupMap.get(asset.legacyGroupId);

    if (!assetId || !groupId) continue;

    await sql`
      insert into asset_group_members (
        owner_user_id,
        group_id,
        asset_id,
        sort_order,
        is_active
      )
      values (${ownerUserId}, ${groupId}, ${assetId}, ${count}, true)
      on conflict (group_id, asset_id) do update set
        owner_user_id = excluded.owner_user_id,
        sort_order = excluded.sort_order,
        is_active = excluded.is_active,
        updated_at = now()
    `;

    count += 1;
  }

  return count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const assetsPath = path.join(args.dataDir, "base44-assets.export.json");
  const assetGroupsPath = path.join(
    args.dataDir,
    "base44-asset-groups.export.json",
  );

  const [assetGroupRecords, assetRecords] = await Promise.all([
    readJsonArray(assetGroupsPath, "base44-asset-groups.export.json"),
    readJsonArray(assetsPath, "base44-assets.export.json"),
  ]);

  const groups = assetGroupRecords.map((record, index) =>
    normalizeAssetGroup(record, index),
  );
  const normalizedAssets = assetRecords.map(normalizeAsset);
  const excludedAssets = normalizedAssets.filter((asset) =>
    isExcludedBase44AssetType(asset.assetType),
  );
  const assets = normalizedAssets.filter(
    (asset) => !isExcludedBase44AssetType(asset.assetType),
  );
  const summary = summarize(groups, assets, excludedAssets);

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        dataDir: args.dataDir,
        ownerUserId: args.ownerUserId,
        ...summary,
      },
      null,
      2,
    ),
  );

  if (summary.unmatchedGroupRefs.length > 0) {
    throw new Error("Cannot import assets with unmatched Base44 group references");
  }

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to import into DATABASE_URL.");
    return;
  }

  config({ path: path.resolve(process.cwd(), ".env.local") });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const accountCodes = new Set([
    "cash",
    ...ACCOUNT_DEFINITIONS.map((account) => account.code).filter((code) =>
      summary.accountCodes.includes(code),
    ),
  ]);

  const accountMap = await upsertAccounts(sql, args.ownerUserId, accountCodes);
  const groupMap = await upsertAssetGroups(sql, args.ownerUserId, groups);
  const assetMap = await upsertAssets(sql, accountMap, groupMap, assets);
  const memberCount = await upsertAssetGroupMembers(
    sql,
    args.ownerUserId,
    assets,
    assetMap,
    groupMap,
  );

  console.log(
    JSON.stringify(
      {
        importedAccounts: accountMap.size,
        importedAssetGroups: groupMap.size,
        importedAssets: assetMap.size,
        importedAssetGroupMembers: memberCount,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
