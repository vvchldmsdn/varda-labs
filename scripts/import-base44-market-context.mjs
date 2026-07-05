import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 50;

const MARKET_REGIME_FIELDS = new Set([
  "id",
  "date",
  "account",
  "label",
  "description",
  "drivers_json",
  "macro_stress_score",
  "regime_score",
  "news_sentiment_score",
  "avg_correlation",
  "enb",
  "portfolio_volatility",
  "yield_curve",
  "rate_level",
  "stress_badge_count",
  "is_sample",
  "created_date",
  "updated_date",
]);

const GLOBAL_MARKET_FACTOR_FIELDS = new Set([
  "id",
  "date",
  "factor_key",
  "factor_family",
  "factor_name",
  "frequency",
  "source",
  "source_series_id",
  "benchmark_key",
  "country_code",
  "region",
  "related_currency",
  "tenor",
  "description",
  "derived_metrics_json",
  "is_preliminary",
  "is_sample",
  "value",
  "prev_value",
  "change_pct",
  "change_1m_pct",
  "change_3m_pct",
  "change_6m_pct",
  "change_speed_20d",
  "percentile_1y",
  "volatility_20d_pct",
  "volatility_60d_pct",
  "carry_spread_value",
  "period_end_date",
  "release_date",
  "observed_at",
  "created_date",
  "updated_date",
]);

async function runInBatches(items, handler) {
  for (let index = 0; index < items.length; index += UPSERT_BATCH_SIZE) {
    const batch = items.slice(index, index + UPSERT_BATCH_SIZE);
    await Promise.all(batch.map(handler));
  }
}

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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid timestamp`);
  }
  return date;
}

function requiredTimestamp(value, fieldName) {
  const normalized = optionalTimestamp(value, fieldName);
  if (normalized === null) throw new Error(`${fieldName} is required`);
  return normalized;
}

function requiredJson(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${fieldName} is required`);
  }

  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${error.message}`);
  }
}

function jsonForDb(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function normalizeMarketRegime(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "MarketRegimeDaily.id"),
    regimeDate: validateDateString(record.date, "MarketRegimeDaily.date", true),
    account: requiredString(record.account, "MarketRegimeDaily.account"),
    label: requiredString(record.label, "MarketRegimeDaily.label"),
    description: optionalString(record.description),
    driversJson: requiredJson(
      record.drivers_json,
      "MarketRegimeDaily.drivers_json",
    ),
    isSample: optionalBoolean(record.is_sample),
    macroStressScore: optionalDecimal(
      record.macro_stress_score,
      "MarketRegimeDaily.macro_stress_score",
    ),
    regimeScore: optionalDecimal(record.regime_score, "MarketRegimeDaily.regime_score"),
    newsSentimentScore: optionalDecimal(
      record.news_sentiment_score,
      "MarketRegimeDaily.news_sentiment_score",
    ),
    avgCorrelation: optionalDecimal(
      record.avg_correlation,
      "MarketRegimeDaily.avg_correlation",
    ),
    enb: optionalDecimal(record.enb, "MarketRegimeDaily.enb"),
    portfolioVolatility: optionalDecimal(
      record.portfolio_volatility,
      "MarketRegimeDaily.portfolio_volatility",
    ),
    yieldCurve: optionalDecimal(record.yield_curve, "MarketRegimeDaily.yield_curve"),
    rateLevel: optionalDecimal(record.rate_level, "MarketRegimeDaily.rate_level"),
    stressBadgeCount: optionalInteger(
      record.stress_badge_count,
      "MarketRegimeDaily.stress_badge_count",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "MarketRegimeDaily.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "MarketRegimeDaily.updated_date",
    ),
  };
}

function normalizeGlobalMarketFactor(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "GlobalMarketFactor.id"),
    factorDate: validateDateString(record.date, "GlobalMarketFactor.date", true),
    factorKey: requiredString(record.factor_key, "GlobalMarketFactor.factor_key"),
    factorFamily: requiredString(
      record.factor_family,
      "GlobalMarketFactor.factor_family",
    ),
    factorName: requiredString(record.factor_name, "GlobalMarketFactor.factor_name"),
    frequency: requiredString(record.frequency, "GlobalMarketFactor.frequency"),
    source: requiredString(record.source, "GlobalMarketFactor.source"),
    sourceSeriesId: requiredString(
      record.source_series_id,
      "GlobalMarketFactor.source_series_id",
    ),
    benchmarkKey: optionalString(record.benchmark_key),
    countryCode: requiredString(record.country_code, "GlobalMarketFactor.country_code"),
    region: requiredString(record.region, "GlobalMarketFactor.region"),
    relatedCurrency: requiredString(
      record.related_currency,
      "GlobalMarketFactor.related_currency",
    ),
    tenor: requiredString(record.tenor, "GlobalMarketFactor.tenor"),
    description: optionalString(record.description),
    derivedMetricsJson: requiredJson(
      record.derived_metrics_json,
      "GlobalMarketFactor.derived_metrics_json",
    ),
    isPreliminary: optionalBoolean(record.is_preliminary),
    isSample: optionalBoolean(record.is_sample),
    value: requiredDecimal(record.value, "GlobalMarketFactor.value"),
    prevValue: requiredDecimal(record.prev_value, "GlobalMarketFactor.prev_value"),
    changePct: optionalDecimal(record.change_pct, "GlobalMarketFactor.change_pct"),
    change1mPct: optionalDecimal(
      record.change_1m_pct,
      "GlobalMarketFactor.change_1m_pct",
    ),
    change3mPct: optionalDecimal(
      record.change_3m_pct,
      "GlobalMarketFactor.change_3m_pct",
    ),
    change6mPct: optionalDecimal(
      record.change_6m_pct,
      "GlobalMarketFactor.change_6m_pct",
    ),
    changeSpeed20d: optionalDecimal(
      record.change_speed_20d,
      "GlobalMarketFactor.change_speed_20d",
    ),
    percentile1y: requiredDecimal(
      record.percentile_1y,
      "GlobalMarketFactor.percentile_1y",
    ),
    volatility20dPct: requiredDecimal(
      record.volatility_20d_pct,
      "GlobalMarketFactor.volatility_20d_pct",
    ),
    volatility60dPct: requiredDecimal(
      record.volatility_60d_pct,
      "GlobalMarketFactor.volatility_60d_pct",
    ),
    carrySpreadValue: optionalDecimal(
      record.carry_spread_value,
      "GlobalMarketFactor.carry_spread_value",
    ),
    periodEndDate: validateDateString(
      record.period_end_date,
      "GlobalMarketFactor.period_end_date",
      true,
    ),
    releaseDate: validateDateString(
      record.release_date,
      "GlobalMarketFactor.release_date",
      true,
    ),
    observedAt: requiredTimestamp(
      record.observed_at,
      "GlobalMarketFactor.observed_at",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "GlobalMarketFactor.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "GlobalMarketFactor.updated_date",
    ),
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

function summarize(marketRegimes, globalFactors) {
  return {
    marketRegimeDaily: marketRegimes.length,
    globalMarketFactors: globalFactors.length,
    marketRegimeDateRange: dateRange(marketRegimes, "regimeDate"),
    globalMarketFactorDateRange: dateRange(globalFactors, "factorDate"),
    marketRegimeAccounts: distribution(marketRegimes, "account"),
    marketRegimeLabels: distribution(marketRegimes, "label"),
    factorFamilies: distribution(globalFactors, "factorFamily"),
    factorRegions: distribution(globalFactors, "region"),
    factorSources: distribution(globalFactors, "source"),
    factorFrequencies: distribution(globalFactors, "frequency"),
    factorKeys: new Set(globalFactors.map((factor) => factor.factorKey)).size,
    marketRegimeJsonRows: marketRegimes.filter((regime) => regime.driversJson).length,
    globalFactorJsonRows: globalFactors.filter((factor) => factor.derivedMetricsJson)
      .length,
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

async function upsertMarketRegimes(sql, marketRegimes, accountMap) {
  await runInBatches(marketRegimes, async (regime) => {
    const accountId = accountMap.get(regime.account) ?? null;

    await sql`
      insert into market_regime_daily (
        legacy_base44_id,
        date,
        account,
        account_id,
        label,
        description,
        drivers_json,
        is_sample,
        macro_stress_score,
        regime_score,
        news_sentiment_score,
        avg_correlation,
        enb,
        portfolio_volatility,
        yield_curve,
        rate_level,
        stress_badge_count,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${regime.legacyBase44Id},
        ${regime.regimeDate},
        ${regime.account},
        ${accountId},
        ${regime.label},
        ${regime.description},
        ${jsonForDb(regime.driversJson)}::jsonb,
        ${regime.isSample},
        ${regime.macroStressScore},
        ${regime.regimeScore},
        ${regime.newsSentimentScore},
        ${regime.avgCorrelation},
        ${regime.enb},
        ${regime.portfolioVolatility},
        ${regime.yieldCurve},
        ${regime.rateLevel},
        ${regime.stressBadgeCount},
        ${regime.base44CreatedAt},
        ${regime.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        account = excluded.account,
        account_id = excluded.account_id,
        label = excluded.label,
        description = excluded.description,
        drivers_json = excluded.drivers_json,
        is_sample = excluded.is_sample,
        macro_stress_score = excluded.macro_stress_score,
        regime_score = excluded.regime_score,
        news_sentiment_score = excluded.news_sentiment_score,
        avg_correlation = excluded.avg_correlation,
        enb = excluded.enb,
        portfolio_volatility = excluded.portfolio_volatility,
        yield_curve = excluded.yield_curve,
        rate_level = excluded.rate_level,
        stress_badge_count = excluded.stress_badge_count,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertGlobalFactors(sql, globalFactors) {
  await runInBatches(globalFactors, async (factor) => {
    await sql`
      insert into global_market_factors (
        legacy_base44_id,
        date,
        factor_key,
        factor_family,
        factor_name,
        frequency,
        source,
        source_series_id,
        benchmark_key,
        country_code,
        region,
        related_currency,
        tenor,
        description,
        derived_metrics_json,
        is_preliminary,
        is_sample,
        value,
        prev_value,
        change_pct,
        change_1m_pct,
        change_3m_pct,
        change_6m_pct,
        change_speed_20d,
        percentile_1y,
        volatility_20d_pct,
        volatility_60d_pct,
        carry_spread_value,
        period_end_date,
        release_date,
        observed_at,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${factor.legacyBase44Id},
        ${factor.factorDate},
        ${factor.factorKey},
        ${factor.factorFamily},
        ${factor.factorName},
        ${factor.frequency},
        ${factor.source},
        ${factor.sourceSeriesId},
        ${factor.benchmarkKey},
        ${factor.countryCode},
        ${factor.region},
        ${factor.relatedCurrency},
        ${factor.tenor},
        ${factor.description},
        ${jsonForDb(factor.derivedMetricsJson)}::jsonb,
        ${factor.isPreliminary},
        ${factor.isSample},
        ${factor.value},
        ${factor.prevValue},
        ${factor.changePct},
        ${factor.change1mPct},
        ${factor.change3mPct},
        ${factor.change6mPct},
        ${factor.changeSpeed20d},
        ${factor.percentile1y},
        ${factor.volatility20dPct},
        ${factor.volatility60dPct},
        ${factor.carrySpreadValue},
        ${factor.periodEndDate},
        ${factor.releaseDate},
        ${factor.observedAt},
        ${factor.base44CreatedAt},
        ${factor.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        factor_key = excluded.factor_key,
        factor_family = excluded.factor_family,
        factor_name = excluded.factor_name,
        frequency = excluded.frequency,
        source = excluded.source,
        source_series_id = excluded.source_series_id,
        benchmark_key = excluded.benchmark_key,
        country_code = excluded.country_code,
        region = excluded.region,
        related_currency = excluded.related_currency,
        tenor = excluded.tenor,
        description = excluded.description,
        derived_metrics_json = excluded.derived_metrics_json,
        is_preliminary = excluded.is_preliminary,
        is_sample = excluded.is_sample,
        value = excluded.value,
        prev_value = excluded.prev_value,
        change_pct = excluded.change_pct,
        change_1m_pct = excluded.change_1m_pct,
        change_3m_pct = excluded.change_3m_pct,
        change_6m_pct = excluded.change_6m_pct,
        change_speed_20d = excluded.change_speed_20d,
        percentile_1y = excluded.percentile_1y,
        volatility_20d_pct = excluded.volatility_20d_pct,
        volatility_60d_pct = excluded.volatility_60d_pct,
        carry_spread_value = excluded.carry_spread_value,
        period_end_date = excluded.period_end_date,
        release_date = excluded.release_date,
        observed_at = excluded.observed_at,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

function summarizeMatches(marketRegimes, accountMap) {
  return {
    matchedMarketRegimeAccountRows: marketRegimes.filter((regime) =>
      accountMap.has(regime.account),
    ).length,
    unmatchedMarketRegimeAccountRows: marketRegimes.filter(
      (regime) => !accountMap.has(regime.account),
    ).length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = {
    marketRegimes: "base44-market-regime-daily.export.json",
    globalFactors: "base44-global-market-factors.export.json",
  };

  const [marketRegimeRecords, globalFactorRecords] = await Promise.all([
    readJsonArray(
      path.join(args.dataDir, files.marketRegimes),
      files.marketRegimes,
      MARKET_REGIME_FIELDS,
    ),
    readJsonArray(
      path.join(args.dataDir, files.globalFactors),
      files.globalFactors,
      GLOBAL_MARKET_FACTOR_FIELDS,
    ),
  ]);

  const marketRegimes = marketRegimeRecords.map(normalizeMarketRegime);
  const globalFactors = globalFactorRecords.map(normalizeGlobalMarketFactor);
  const summary = summarize(marketRegimes, globalFactors);

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

  if (!args.write) {
    console.log("Dry run only. Re-run with --write to import into DATABASE_URL.");
    return;
  }

  config({ path: path.resolve(process.cwd(), ".env.local") });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const accountMap = await loadAccountMap(sql, args.ownerUserId);

  await upsertMarketRegimes(sql, marketRegimes, accountMap);
  await upsertGlobalFactors(sql, globalFactors);

  console.log(
    JSON.stringify(
      {
        importedMarketRegimeDaily: marketRegimes.length,
        importedGlobalMarketFactors: globalFactors.length,
        ...summarizeMatches(marketRegimes, accountMap),
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
