import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  SettingsImportArgumentError,
  buildBase44SettingsCanonicalPlan,
  parseBase44SettingsArgs,
} from "./lib/base44-settings-canonical-plan.mjs";
import { readBase44SettingsCanonicalState } from "./lib/base44-settings-canonical-state.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;

const ALLOWED_FIELDS = new Set([
  "id",
  "created_date",
  "updated_date",
  "annual_income_growth",
  "housing_goal",
  "housing_goal_date",
  "housing_contract_signed",
  "income_cash_pct",
  "income_isa_pct",
  "income_securities_pct",
  "isa_contributed_this_year",
  "isa_yearly_limit",
  "min_execution_ratio_pct",
  "post_goal_cash_cap",
  "post_goal_cash_ratio",
  "post_goal_etf_ratio",
  "pre_goal_cash_cap",
  "pre_goal_cash_ratio",
  "pre_goal_etf_ratio",
  "trim_drift_threshold",
  "usd_krw_rate",
  "use_trend_filter",
  "is_sample",
  "description",
]);

async function readJsonArray(filePath, sourceName) {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  return parsed;
}

function assertAllowedKeys(record, sourceName) {
  const blockedKeys = Object.keys(record).filter((key) => !ALLOWED_FIELDS.has(key));
  if (blockedKeys.length > 0) {
    throw new Error(
      `${sourceName} contains non-allowlisted keys: ${blockedKeys.join(", ")}`,
    );
  }
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

function optionalBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return Boolean(value);
}

function validateDateString(value, fieldName) {
  const normalized = optionalString(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return normalized;
}

function optionalTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return date;
}

function normalizeSettings(record, sourceName) {
  assertAllowedKeys(record, sourceName);

  return {
    legacyBase44Id: assertBase44Id(record.id, "Settings.id"),
    annualIncomeGrowth: optionalDecimal(
      record.annual_income_growth,
      "Settings.annual_income_growth",
    ),
    housingGoal: optionalDecimal(record.housing_goal, "Settings.housing_goal"),
    housingGoalDate: validateDateString(
      record.housing_goal_date,
      "Settings.housing_goal_date",
    ),
    housingContractSigned: optionalBoolean(record.housing_contract_signed),
    incomeCashPct: optionalDecimal(
      record.income_cash_pct,
      "Settings.income_cash_pct",
    ),
    incomeIsaPct: optionalDecimal(record.income_isa_pct, "Settings.income_isa_pct"),
    incomeSecuritiesPct: optionalDecimal(
      record.income_securities_pct,
      "Settings.income_securities_pct",
    ),
    isaContributedThisYear: optionalDecimal(
      record.isa_contributed_this_year,
      "Settings.isa_contributed_this_year",
    ),
    isaYearlyLimit: optionalDecimal(
      record.isa_yearly_limit,
      "Settings.isa_yearly_limit",
    ),
    minExecutionRatioPct: optionalDecimal(
      record.min_execution_ratio_pct,
      "Settings.min_execution_ratio_pct",
    ),
    postGoalCashCap: optionalDecimal(
      record.post_goal_cash_cap,
      "Settings.post_goal_cash_cap",
    ),
    postGoalCashRatio: optionalDecimal(
      record.post_goal_cash_ratio,
      "Settings.post_goal_cash_ratio",
    ),
    postGoalEtfRatio: optionalDecimal(
      record.post_goal_etf_ratio,
      "Settings.post_goal_etf_ratio",
    ),
    preGoalCashCap: optionalDecimal(
      record.pre_goal_cash_cap,
      "Settings.pre_goal_cash_cap",
    ),
    preGoalCashRatio: optionalDecimal(
      record.pre_goal_cash_ratio,
      "Settings.pre_goal_cash_ratio",
    ),
    preGoalEtfRatio: optionalDecimal(
      record.pre_goal_etf_ratio,
      "Settings.pre_goal_etf_ratio",
    ),
    trimDriftThreshold: optionalDecimal(
      record.trim_drift_threshold,
      "Settings.trim_drift_threshold",
    ),
    usdKrwRate: optionalDecimal(record.usd_krw_rate, "Settings.usd_krw_rate"),
    useTrendFilter: optionalBoolean(record.use_trend_filter),
    isSample: optionalBoolean(record.is_sample),
    description: optionalString(record.description),
    base44CreatedAt: optionalTimestamp(record.created_date, "Settings.created_date"),
    base44UpdatedAt: optionalTimestamp(record.updated_date, "Settings.updated_date"),
  };
}

function summarize(rows) {
  return {
    settingsRows: rows.length,
    populatedFieldCount: Object.values(rows[0] ?? {}).filter(
      (value) => value !== null && value !== undefined,
    ).length,
  };
}

async function upsertSettings(sql, rows) {
  for (const row of rows) {
    await sql`
      insert into settings (
        legacy_base44_id,
        annual_income_growth,
        housing_goal,
        housing_goal_date,
        housing_contract_signed,
        income_cash_pct,
        income_isa_pct,
        income_securities_pct,
        isa_contributed_this_year,
        isa_yearly_limit,
        min_execution_ratio_pct,
        post_goal_cash_cap,
        post_goal_cash_ratio,
        post_goal_etf_ratio,
        pre_goal_cash_cap,
        pre_goal_cash_ratio,
        pre_goal_etf_ratio,
        trim_drift_threshold,
        usd_krw_rate,
        use_trend_filter,
        is_sample,
        description,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${row.legacyBase44Id},
        ${row.annualIncomeGrowth},
        ${row.housingGoal},
        ${row.housingGoalDate},
        ${row.housingContractSigned},
        ${row.incomeCashPct},
        ${row.incomeIsaPct},
        ${row.incomeSecuritiesPct},
        ${row.isaContributedThisYear},
        ${row.isaYearlyLimit},
        ${row.minExecutionRatioPct},
        ${row.postGoalCashCap},
        ${row.postGoalCashRatio},
        ${row.postGoalEtfRatio},
        ${row.preGoalCashCap},
        ${row.preGoalCashRatio},
        ${row.preGoalEtfRatio},
        ${row.trimDriftThreshold},
        ${row.usdKrwRate},
        ${row.useTrendFilter},
        ${row.isSample},
        ${row.description},
        ${row.base44CreatedAt},
        ${row.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        annual_income_growth = excluded.annual_income_growth,
        housing_goal = excluded.housing_goal,
        housing_goal_date = excluded.housing_goal_date,
        housing_contract_signed = excluded.housing_contract_signed,
        income_cash_pct = excluded.income_cash_pct,
        income_isa_pct = excluded.income_isa_pct,
        income_securities_pct = excluded.income_securities_pct,
        isa_contributed_this_year = excluded.isa_contributed_this_year,
        isa_yearly_limit = excluded.isa_yearly_limit,
        min_execution_ratio_pct = excluded.min_execution_ratio_pct,
        post_goal_cash_cap = excluded.post_goal_cash_cap,
        post_goal_cash_ratio = excluded.post_goal_cash_ratio,
        post_goal_etf_ratio = excluded.post_goal_etf_ratio,
        pre_goal_cash_cap = excluded.pre_goal_cash_cap,
        pre_goal_cash_ratio = excluded.pre_goal_cash_ratio,
        pre_goal_etf_ratio = excluded.pre_goal_etf_ratio,
        trim_drift_threshold = excluded.trim_drift_threshold,
        usd_krw_rate = excluded.usd_krw_rate,
        use_trend_filter = excluded.use_trend_filter,
        is_sample = excluded.is_sample,
        description = excluded.description,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  }
}

async function main() {
  const args = parseBase44SettingsArgs(process.argv.slice(2), {
    defaultDataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
  });
  const fileName = "base44-settings.export.json";
  const filePath = path.join(args.dataDir, fileName);
  const records = await readJsonArray(filePath, fileName);
  const rows = records.map((record) => normalizeSettings(record, fileName));
  const summary = summarize(rows);
  const baseOutput = {
    mode: args.write ? "write" : "dry-run",
    ownerMode:
      args.canonicalOwnerId === null ? "legacy-evidence" : "canonical-shadow",
    ...summary,
  };

  if (args.canonicalOwnerId !== null) {
    config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }

    const sql = neon(process.env.DATABASE_URL);
    const state = await readBase44SettingsCanonicalState(sql, {
      canonicalOwnerId: args.canonicalOwnerId,
    });
    const canonicalOwnerPlan = buildBase44SettingsCanonicalPlan({
      canonicalOwnerId: args.canonicalOwnerId,
      approveProvisioningOwner: args.approveProvisioningOwner,
      appUser: state.appUser,
      sourceRows: rows,
      databaseRows: state.databaseRows,
    });

    console.log(
      JSON.stringify(
        {
          ...baseOutput,
          selectCount: state.selectCount,
          canonicalOwnerPlan,
        },
        null,
        2,
      ),
    );

    if (canonicalOwnerPlan.result === "blocked") {
      console.error("Settings canonical owner shadow plan is blocked");
      process.exitCode = 1;
    }
    return;
  }

  console.log(JSON.stringify(baseOutput, null, 2));

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to import into DATABASE_URL.");
    return;
  }

  config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  await upsertSettings(sql, rows);

  console.log(
    JSON.stringify(
      {
        importedSettings: rows.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      operation: "base44_settings_import",
      result: "failed",
      error: safeErrorCode(error),
    }),
  );
  process.exitCode = 1;
});

function safeErrorCode(error) {
  if (error instanceof SettingsImportArgumentError) return error.code;
  if (error instanceof SyntaxError) return "invalid_json_export";
  if (error?.code === "ENOENT") return "migration_data_unavailable";
  return "settings_import_failed";
}
