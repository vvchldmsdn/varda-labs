import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  CoreImportArgumentError,
  buildBase44CoreCanonicalPlan,
} from "./lib/base44-core-canonical-plan.mjs";
import { readBase44CoreCanonicalState } from "./lib/base44-core-canonical-state.mjs";
import {
  CoreShadowSourceError,
  readBase44CoreShadowSource,
} from "./lib/base44-core-shadow-source.mjs";
import {
  EventImportArgumentError,
  buildBase44EventCanonicalPlan,
  normalizeBase44EventShadowSource,
  parseBase44EventArgs,
} from "./lib/base44-event-canonical-plan.mjs";
import { readBase44EventCanonicalState } from "./lib/base44-event-canonical-state.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 25;

const EVENT_LEDGER_FIELDS = new Set([
  "id",
  "event_date",
  "event_type",
  "source",
  "recorded_at",
  "rule_version",
  "account",
  "asset_id",
  "asset_name",
  "ticker",
  "group_id",
  "group_name",
  "corrects_event_id",
  "amount_krw",
  "quantity_delta",
  "price",
  "fx_rate",
  "before_value",
  "after_value",
  "memo",
  "description",
  "is_sample",
  "created_date",
  "updated_date",
]);

async function runInBatches(items, handler) {
  for (let index = 0; index < items.length; index += UPSERT_BATCH_SIZE) {
    const batch = items.slice(index, index + UPSERT_BATCH_SIZE);
    await Promise.all(batch.map(handler));
  }
}

function assertNoSensitiveContent(value, sourceName, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitiveContent(item, sourceName, [...keyPath, String(index)]),
    );
    return;
  }

  if (typeof value === "string") {
    if (SENSITIVE_PATTERN.test(value)) {
      throw new Error(
        `${sourceName} contains blocked sensitive text at "${keyPath.join(".")}". ` +
          "Use a sanitized export before importing.",
      );
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = [...keyPath, key];
    if (SENSITIVE_PATTERN.test(key)) {
      throw new Error(
        `${sourceName} contains blocked key "${nextPath.join(".")}". ` +
          "Use a sanitized export before importing.",
      );
    }
    assertNoSensitiveContent(nestedValue, sourceName, nextPath);
  }
}

function assertAllowedKeys(record, allowedFields, sourceName) {
  const blockedKeys = Object.keys(record).filter((key) => !allowedFields.has(key));
  if (blockedKeys.length > 0) {
    throw new Error(
      `${sourceName} contains non-allowlisted keys: ${blockedKeys.join(", ")}`,
    );
  }
}

async function readJsonArray(filePath, sourceName, allowedFields) {
  const raw = await readFile(filePath, "utf8");
  if (SENSITIVE_PATTERN.test(raw)) {
    throw new Error(`${sourceName} contains blocked sensitive text`);
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  assertNoSensitiveContent(parsed, sourceName);
  parsed.forEach((record) => assertAllowedKeys(record, allowedFields, sourceName));

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

function optionalBase44Id(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) return null;
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

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function validateDateString(value, fieldName, required = false) {
  const normalized = optionalString(value);
  if (!normalized) {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return normalized;
}

function optionalTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const normalized =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return date;
}

function requiredRawValue(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${fieldName} is required`);
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function normalizeEvent(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "EventLedger.id"),
    eventDate: validateDateString(record.event_date, "EventLedger.event_date", true),
    eventType: requiredString(record.event_type, "EventLedger.event_type"),
    source: optionalString(record.source),
    recordedAt: optionalTimestamp(record.recorded_at, "EventLedger.recorded_at"),
    ruleVersion: optionalString(record.rule_version),
    account: optionalString(record.account),
    legacyAssetId: assertBase44Id(record.asset_id, "EventLedger.asset_id"),
    assetName: requiredString(record.asset_name, "EventLedger.asset_name"),
    ticker: optionalString(record.ticker),
    legacyGroupId: optionalBase44Id(record.group_id, "EventLedger.group_id"),
    groupName: optionalString(record.group_name),
    legacyCorrectsEventId: optionalBase44Id(
      record.corrects_event_id,
      "EventLedger.corrects_event_id",
    ),
    amountKrw: optionalDecimal(record.amount_krw, "EventLedger.amount_krw"),
    quantityDelta: optionalDecimal(
      record.quantity_delta,
      "EventLedger.quantity_delta",
    ),
    price: optionalDecimal(record.price, "EventLedger.price"),
    fxRate: optionalDecimal(record.fx_rate, "EventLedger.fx_rate"),
    beforeValue: requiredRawValue(record.before_value, "EventLedger.before_value"),
    afterValue: requiredRawValue(record.after_value, "EventLedger.after_value"),
    memo: optionalString(record.memo),
    description: optionalString(record.description),
    isSample: optionalBoolean(record.is_sample),
    base44CreatedAt: optionalTimestamp(record.created_date, "EventLedger.created_date"),
    base44UpdatedAt: optionalTimestamp(record.updated_date, "EventLedger.updated_date"),
  };
}

function dateRange(rows, key) {
  const values = rows.map((row) => row[key]).filter(Boolean).sort();
  if (values.length === 0) return null;
  return { from: values[0], to: values[values.length - 1] };
}

function distribution(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] ?? "(null)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function summarize(events) {
  const legacyAssetIds = new Set(events.map((event) => event.legacyAssetId));
  const legacyGroupIds = new Set(
    events.map((event) => event.legacyGroupId).filter(Boolean),
  );
  const legacyCorrectsEventIds = new Set(
    events.map((event) => event.legacyCorrectsEventId).filter(Boolean),
  );

  return {
    eventLedgerEntries: events.length,
    eventDateRange: dateRange(events, "eventDate"),
    eventTypes: distribution(events, "eventType"),
    sources: distribution(events, "source"),
    accounts: distribution(events, "account"),
    legacyAssetIds: legacyAssetIds.size,
    legacyGroupIds: legacyGroupIds.size,
    legacyCorrectsEventIds: legacyCorrectsEventIds.size,
    missingAccountRows: events.filter((event) => !event.account).length,
    missingTickerRows: events.filter((event) => !event.ticker).length,
    rowsWithGroupId: events.filter((event) => event.legacyGroupId).length,
    rowsWithFxRate: events.filter((event) => event.fxRate !== null).length,
  };
}

async function loadAccountMap(sql, ownerUserId) {
  const rows = await sql`
    select code, id
    from accounts
    where owner_user_id = ${ownerUserId}
  `;

  return new Map(rows.map((row) => [row.code, row.id]));
}

async function loadAssetMap(sql) {
  const rows = await sql`
    select legacy_base44_id, id
    from assets
    where legacy_base44_id is not null
  `;

  return new Map(rows.map((row) => [row.legacy_base44_id, row.id]));
}

async function loadAssetGroupMap(sql) {
  const rows = await sql`
    select legacy_base44_id, id
    from asset_groups
    where legacy_base44_id is not null
  `;

  return new Map(rows.map((row) => [row.legacy_base44_id, row.id]));
}

async function loadEventMap(sql) {
  const rows = await sql`
    select legacy_base44_id, id
    from event_ledger_entries
    where legacy_base44_id is not null
  `;

  return new Map(rows.map((row) => [row.legacy_base44_id, row.id]));
}

async function upsertEvents(sql, events, accountMap, assetMap, assetGroupMap) {
  const eventMap = await loadEventMap(sql);

  await runInBatches(events, async (event) => {
    const accountId = event.account ? (accountMap.get(event.account) ?? null) : null;
    const assetId = assetMap.get(event.legacyAssetId) ?? null;
    const groupId = event.legacyGroupId
      ? (assetGroupMap.get(event.legacyGroupId) ?? null)
      : null;
    const correctsEventId = event.legacyCorrectsEventId
      ? (eventMap.get(event.legacyCorrectsEventId) ?? null)
      : null;

    await sql`
      insert into event_ledger_entries (
        legacy_base44_id,
        event_date,
        event_type,
        source,
        recorded_at,
        rule_version,
        account,
        account_id,
        asset_id,
        legacy_asset_id,
        ticker,
        asset_name,
        group_id,
        legacy_group_id,
        group_name,
        corrects_event_id,
        legacy_corrects_event_id,
        amount_krw,
        quantity_delta,
        price,
        fx_rate,
        before_value,
        after_value,
        memo,
        description,
        is_sample,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${event.legacyBase44Id},
        ${event.eventDate},
        ${event.eventType},
        ${event.source},
        ${event.recordedAt},
        ${event.ruleVersion},
        ${event.account},
        ${accountId},
        ${assetId},
        ${event.legacyAssetId},
        ${event.ticker},
        ${event.assetName},
        ${groupId},
        ${event.legacyGroupId},
        ${event.groupName},
        ${correctsEventId},
        ${event.legacyCorrectsEventId},
        ${event.amountKrw},
        ${event.quantityDelta},
        ${event.price},
        ${event.fxRate},
        ${event.beforeValue},
        ${event.afterValue},
        ${event.memo},
        ${event.description},
        ${event.isSample},
        ${event.base44CreatedAt},
        ${event.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        event_date = excluded.event_date,
        event_type = excluded.event_type,
        source = excluded.source,
        recorded_at = excluded.recorded_at,
        rule_version = excluded.rule_version,
        account = excluded.account,
        account_id = excluded.account_id,
        asset_id = excluded.asset_id,
        legacy_asset_id = excluded.legacy_asset_id,
        ticker = excluded.ticker,
        asset_name = excluded.asset_name,
        group_id = excluded.group_id,
        legacy_group_id = excluded.legacy_group_id,
        group_name = excluded.group_name,
        corrects_event_id = excluded.corrects_event_id,
        legacy_corrects_event_id = excluded.legacy_corrects_event_id,
        amount_krw = excluded.amount_krw,
        quantity_delta = excluded.quantity_delta,
        price = excluded.price,
        fx_rate = excluded.fx_rate,
        before_value = excluded.before_value,
        after_value = excluded.after_value,
        memo = excluded.memo,
        description = excluded.description,
        is_sample = excluded.is_sample,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });

  await sql`
    update event_ledger_entries event
    set corrects_event_id = corrected.id
    from event_ledger_entries corrected
    where event.legacy_corrects_event_id = corrected.legacy_base44_id
      and event.legacy_corrects_event_id is not null
  `;
}

function summarizeMatches(events, accountMap, assetMap, assetGroupMap) {
  const rowsWithAccount = events.filter((event) => event.account);
  const rowsWithGroup = events.filter((event) => event.legacyGroupId);
  const rowsWithCorrection = events.filter((event) => event.legacyCorrectsEventId);

  return {
    matchedAssetRows: events.filter((event) => assetMap.has(event.legacyAssetId))
      .length,
    unmatchedAssetRows: events.filter((event) => !assetMap.has(event.legacyAssetId))
      .length,
    matchedAccountRows: rowsWithAccount.filter((event) =>
      accountMap.has(event.account),
    ).length,
    unmatchedAccountRows: rowsWithAccount.filter(
      (event) => !accountMap.has(event.account),
    ).length,
    missingAccountRows: events.length - rowsWithAccount.length,
    matchedGroupRows: rowsWithGroup.filter((event) =>
      assetGroupMap.has(event.legacyGroupId),
    ).length,
    unmatchedGroupRows: rowsWithGroup.filter(
      (event) => !assetGroupMap.has(event.legacyGroupId),
    ).length,
    rowsWithCorrection: rowsWithCorrection.length,
  };
}

async function main() {
  const args = parseBase44EventArgs(process.argv.slice(2), {
    defaultDataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    legacyOwnerUserId: process.env.IMPORT_OWNER_USER_ID ?? "base44-import",
  });
  const fileName = "base44-event-ledger.export.json";
  const records = await readJsonArray(
    path.join(args.dataDir, fileName),
    fileName,
    EVENT_LEDGER_FIELDS,
  );

  if (args.canonicalOwnerId !== null) {
    const sourceEvents = records.map(normalizeBase44EventShadowSource);
    const coreSource = await readBase44CoreShadowSource(args.dataDir);

    config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }

    const sql = neon(process.env.DATABASE_URL);
    const [eventState, coreState] = await Promise.all([
      readBase44EventCanonicalState(sql, {
        canonicalOwnerId: args.canonicalOwnerId,
        legacyOwnerUserId: args.ownerUserId,
        sourceEvents,
      }),
      readBase44CoreCanonicalState(sql, {
        canonicalOwnerId: args.canonicalOwnerId,
        legacyOwnerUserId: args.ownerUserId,
        accountCodes: coreSource.accountCodes,
        groups: coreSource.groups,
        assets: coreSource.assets,
      }),
    ]);
    const corePlan = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: args.canonicalOwnerId,
      approveProvisioningOwner: args.approveProvisioningOwner,
      legacyOwnerUserId: args.ownerUserId,
      appUser: coreState.appUser,
      tables: coreState.tables,
    });
    const canonicalOwnerPlan = buildBase44EventCanonicalPlan({
      canonicalOwnerId: args.canonicalOwnerId,
      approveProvisioningOwner: args.approveProvisioningOwner,
      legacyOwnerUserId: args.ownerUserId,
      appUser: eventState.appUser,
      sourceEvents,
      state: eventState,
      coreProof: {
        result: corePlan.result,
        actualWriteAllowed: corePlan.actualWriteAllowed,
        canonicalOwnerWriteEnabled: corePlan.canonicalOwnerWriteEnabled,
        databaseSideEffects: corePlan.databaseSideEffects,
        accountCodes: coreSource.accountCodes,
        assetLegacyIds: coreSource.assets.map(
          ({ legacyBase44Id }) => legacyBase44Id,
        ),
        groupLegacyIds: coreSource.groups.map(
          ({ legacyBase44Id }) => legacyBase44Id,
        ),
      },
    });

    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          ownerMode: "canonical-shadow",
          eventLedgerEntries: sourceEvents.length,
          selectCount: eventState.selectCount + coreState.selectCount,
          canonicalOwnerPlan,
        },
        null,
        2,
      ),
    );
    if (canonicalOwnerPlan.result === "blocked") {
      console.error("Event canonical owner shadow plan is blocked");
      process.exitCode = 1;
    }
    return;
  }

  const events = records.map(normalizeEvent);
  const summary = summarize(events);

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        ownerMode: "legacy-evidence",
        ...summary,
      },
      null,
      2,
    ),
  );

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to import into DATABASE_URL.");
    return;
  }

  config({ path: path.resolve(process.cwd(), ".env.local") });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const [accountMap, assetMap, assetGroupMap] = await Promise.all([
    loadAccountMap(sql, args.ownerUserId),
    loadAssetMap(sql),
    loadAssetGroupMap(sql),
  ]);

  await upsertEvents(sql, events, accountMap, assetMap, assetGroupMap);

  console.log(
    JSON.stringify(
      {
        importedEventLedgerEntries: events.length,
        ...summarizeMatches(events, accountMap, assetMap, assetGroupMap),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      operation: "base44_event_import",
      result: "failed",
      error: safeErrorCode(error),
    }),
  );
  process.exitCode = 1;
});

function safeErrorCode(error) {
  if (error instanceof EventImportArgumentError) return error.code;
  if (error instanceof CoreImportArgumentError) return error.code;
  if (error instanceof CoreShadowSourceError) return error.code;
  if (error instanceof SyntaxError) return "invalid_json_export";
  if (error?.code === "ENOENT") return "migration_data_unavailable";
  return "event_import_failed";
}
