import { readFile } from "node:fs/promises";
import path from "node:path";

import { isExcludedBase44AssetType } from "./base44-asset-policy.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const CORE_ACCOUNT_CODES = new Set(["cash", "brokerage", "isa", "irp"]);

export class CoreShadowSourceError extends Error {
  constructor(code) {
    super("Base44 core shadow source is invalid");
    this.name = "CoreShadowSourceError";
    this.code = code;
  }
}

export async function readBase44CoreShadowSource(dataDir) {
  const [groupRecords, assetRecords] = await Promise.all([
    readJsonArray(path.join(dataDir, "base44-asset-groups.export.json")),
    readJsonArray(path.join(dataDir, "base44-assets.export.json")),
  ]);
  const groups = groupRecords.map((record) =>
    Object.freeze({
      legacyBase44Id: requiredBase44Id(record.id),
    }),
  );
  const normalizedAssets = assetRecords.map((record) =>
    Object.freeze({
      legacyBase44Id: requiredBase44Id(record.id),
      account: requiredString(record.account),
      legacyGroupId: optionalBase44Id(record.group_id),
      assetType: optionalString(record.asset_type) ?? "etf",
    }),
  );
  const assets = normalizedAssets.filter(
    ({ assetType }) => !isExcludedBase44AssetType(assetType),
  );

  assertUnique(groups.map(({ legacyBase44Id }) => legacyBase44Id));
  assertUnique(assets.map(({ legacyBase44Id }) => legacyBase44Id));

  const groupIds = new Set(groups.map(({ legacyBase44Id }) => legacyBase44Id));
  if (
    assets.some(
      ({ legacyGroupId }) =>
        legacyGroupId !== null && !groupIds.has(legacyGroupId),
    )
  ) {
    throw new CoreShadowSourceError("unmatched_core_group_reference");
  }

  const sourceAccountCodes = new Set(assets.map(({ account }) => account));
  if ([...sourceAccountCodes].some((code) => !CORE_ACCOUNT_CODES.has(code))) {
    throw new CoreShadowSourceError("unsupported_core_account_code");
  }
  const accountCodes = [
    "cash",
    ...["brokerage", "isa", "irp"].filter((code) =>
      sourceAccountCodes.has(code),
    ),
  ];

  return Object.freeze({
    accountCodes: Object.freeze(accountCodes),
    groups: Object.freeze(groups),
    assets: Object.freeze(
      assets.map(({ legacyBase44Id, account, legacyGroupId }) =>
        Object.freeze({ legacyBase44Id, account, legacyGroupId }),
      ),
    ),
    summary: Object.freeze({
      accounts: accountCodes.length,
      assetGroups: groups.length,
      assets: assets.length,
      excludedAssets: normalizedAssets.length - assets.length,
    }),
  });
}

async function readJsonArray(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new CoreShadowSourceError("invalid_core_source_array");
  }
  assertNoSensitiveKeys(parsed);
  return parsed;
}

function assertNoSensitiveKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoSensitiveKeys);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new CoreShadowSourceError("blocked_core_source_key");
    }
    assertNoSensitiveKeys(nestedValue);
  }
}

function assertUnique(values) {
  if (new Set(values).size !== values.length) {
    throw new CoreShadowSourceError("duplicate_core_source_identity");
  }
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredString(value) {
  const normalized = optionalString(value);
  if (normalized === null) {
    throw new CoreShadowSourceError("missing_core_source_field");
  }
  return normalized;
}

function requiredBase44Id(value) {
  const normalized = requiredString(value);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new CoreShadowSourceError("invalid_core_source_identity");
  }
  return normalized.toLowerCase();
}

function optionalBase44Id(value) {
  const normalized = optionalString(value);
  if (normalized === null) return null;
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new CoreShadowSourceError("invalid_core_source_reference");
  }
  return normalized.toLowerCase();
}
