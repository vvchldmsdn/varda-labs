import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 50;

const ASSET_PRICE_FIELDS = new Set([
  "id",
  "date",
  "ticker",
  "market",
  "currency",
  "close_price",
  "adjusted_close_price",
  "close_price_krw",
  "fx_rate",
  "source",
  "is_sample",
  "created_date",
  "updated_date",
]);

const BENCHMARK_FIELDS = new Set([
  "id",
  "date",
  "benchmark_ticker",
  "benchmark_name",
  "currency",
  "close_price",
  "normalized_index_value",
  "fx_rate",
  "source",
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

function parseArgs(argv) {
  const args = {
    dataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    write: false,
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

    throw new Error(`Unknown argument: ${arg}`);
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
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`${sourceName} must be a JSON array`);
  }

  assertNoSensitiveKeys(parsed, sourceName);
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

function normalizeAssetPrice(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "AssetPriceSnapshot.id"),
    priceDate: validateDateString(record.date, "AssetPriceSnapshot.date", true),
    ticker: requiredString(record.ticker, "AssetPriceSnapshot.ticker"),
    market: requiredString(record.market, "AssetPriceSnapshot.market"),
    currency: requiredString(record.currency, "AssetPriceSnapshot.currency"),
    closePrice: requiredDecimal(
      record.close_price,
      "AssetPriceSnapshot.close_price",
    ),
    adjustedClosePrice: requiredDecimal(
      record.adjusted_close_price,
      "AssetPriceSnapshot.adjusted_close_price",
    ),
    closePriceKrw: optionalDecimal(
      record.close_price_krw,
      "AssetPriceSnapshot.close_price_krw",
    ),
    fxRate: optionalDecimal(record.fx_rate, "AssetPriceSnapshot.fx_rate"),
    source: optionalString(record.source),
    isSample: optionalBoolean(record.is_sample),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "AssetPriceSnapshot.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "AssetPriceSnapshot.updated_date",
    ),
  };
}

function normalizeBenchmark(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "BenchmarkSnapshot.id"),
    benchmarkDate: validateDateString(record.date, "BenchmarkSnapshot.date", true),
    benchmarkTicker: requiredString(
      record.benchmark_ticker,
      "BenchmarkSnapshot.benchmark_ticker",
    ),
    benchmarkName: requiredString(
      record.benchmark_name,
      "BenchmarkSnapshot.benchmark_name",
    ),
    currency: requiredString(record.currency, "BenchmarkSnapshot.currency"),
    closePrice: requiredDecimal(
      record.close_price,
      "BenchmarkSnapshot.close_price",
    ),
    normalizedIndexValue: requiredDecimal(
      record.normalized_index_value,
      "BenchmarkSnapshot.normalized_index_value",
    ),
    fxRate: optionalDecimal(record.fx_rate, "BenchmarkSnapshot.fx_rate"),
    source: optionalString(record.source),
    isSample: optionalBoolean(record.is_sample),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "BenchmarkSnapshot.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "BenchmarkSnapshot.updated_date",
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

function summarize(assetPrices, benchmarks) {
  const assetPriceNulls = {
    closePriceKrw: assetPrices.filter((row) => row.closePriceKrw === null).length,
    fxRate: assetPrices.filter((row) => row.fxRate === null).length,
  };
  const benchmarkNulls = {
    fxRate: benchmarks.filter((row) => row.fxRate === null).length,
  };

  return {
    assetPriceSnapshots: assetPrices.length,
    benchmarkSnapshots: benchmarks.length,
    assetPriceDateRange: dateRange(assetPrices, "priceDate"),
    benchmarkDateRange: dateRange(benchmarks, "benchmarkDate"),
    assetPriceTickers: Object.keys(distribution(assetPrices, "ticker")).length,
    benchmarkTickers: Object.keys(distribution(benchmarks, "benchmarkTicker")).length,
    assetPriceMarkets: distribution(assetPrices, "market"),
    assetPriceCurrencies: distribution(assetPrices, "currency"),
    assetPriceSources: distribution(assetPrices, "source"),
    benchmarkCurrencies: distribution(benchmarks, "currency"),
    benchmarkSources: distribution(benchmarks, "source"),
    assetPriceNulls,
    benchmarkNulls,
  };
}

async function loadAssetTickerMap(sql) {
  const rows = await sql`
    select
      ticker,
      array_agg(id::text order by id::text) as ids,
      count(*)::int as asset_count
    from assets
    where ticker is not null and ticker <> ''
    group by ticker
  `;

  const tickerMap = new Map();
  const ambiguousTickers = new Set();

  for (const row of rows) {
    const count = Number(row.asset_count);
    if (count === 1) {
      tickerMap.set(row.ticker, row.ids[0]);
    } else {
      ambiguousTickers.add(row.ticker);
    }
  }

  return { tickerMap, ambiguousTickers };
}

async function upsertAssetPrices(sql, assetPrices, tickerMap) {
  await runInBatches(assetPrices, async (assetPrice) => {
    const assetId = tickerMap.get(assetPrice.ticker) ?? null;

    await sql`
      insert into asset_price_snapshots (
        legacy_base44_id,
        date,
        ticker,
        asset_id,
        market,
        currency,
        close_price,
        adjusted_close_price,
        close_price_krw,
        fx_rate,
        source,
        is_sample,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${assetPrice.legacyBase44Id},
        ${assetPrice.priceDate},
        ${assetPrice.ticker},
        ${assetId},
        ${assetPrice.market},
        ${assetPrice.currency},
        ${assetPrice.closePrice},
        ${assetPrice.adjustedClosePrice},
        ${assetPrice.closePriceKrw},
        ${assetPrice.fxRate},
        ${assetPrice.source},
        ${assetPrice.isSample},
        ${assetPrice.base44CreatedAt},
        ${assetPrice.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        ticker = excluded.ticker,
        asset_id = excluded.asset_id,
        market = excluded.market,
        currency = excluded.currency,
        close_price = excluded.close_price,
        adjusted_close_price = excluded.adjusted_close_price,
        close_price_krw = excluded.close_price_krw,
        fx_rate = excluded.fx_rate,
        source = excluded.source,
        is_sample = excluded.is_sample,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertBenchmarks(sql, benchmarks) {
  await runInBatches(benchmarks, async (benchmark) => {
    await sql`
      insert into benchmark_snapshots (
        legacy_base44_id,
        date,
        benchmark_ticker,
        benchmark_name,
        currency,
        close_price,
        normalized_index_value,
        fx_rate,
        source,
        is_sample,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${benchmark.legacyBase44Id},
        ${benchmark.benchmarkDate},
        ${benchmark.benchmarkTicker},
        ${benchmark.benchmarkName},
        ${benchmark.currency},
        ${benchmark.closePrice},
        ${benchmark.normalizedIndexValue},
        ${benchmark.fxRate},
        ${benchmark.source},
        ${benchmark.isSample},
        ${benchmark.base44CreatedAt},
        ${benchmark.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        benchmark_ticker = excluded.benchmark_ticker,
        benchmark_name = excluded.benchmark_name,
        currency = excluded.currency,
        close_price = excluded.close_price,
        normalized_index_value = excluded.normalized_index_value,
        fx_rate = excluded.fx_rate,
        source = excluded.source,
        is_sample = excluded.is_sample,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

function summarizeAssetMatches(assetPrices, tickerMap, ambiguousTickers) {
  const matched = assetPrices.filter((row) => tickerMap.has(row.ticker)).length;
  const ambiguous = assetPrices.filter((row) =>
    ambiguousTickers.has(row.ticker),
  ).length;

  return {
    matchedAssetPriceRows: matched,
    ambiguousAssetPriceRows: ambiguous,
    unmatchedAssetPriceRows: assetPrices.length - matched - ambiguous,
    matchedTickers: tickerMap.size,
    ambiguousTickers: [...ambiguousTickers].sort(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = {
    assetPrices: "base44-asset-price-snapshots.export.json",
    benchmarks: "base44-benchmark-snapshots.export.json",
  };

  const [assetPriceRecords, benchmarkRecords] = await Promise.all([
    readJsonArray(
      path.join(args.dataDir, files.assetPrices),
      files.assetPrices,
      ASSET_PRICE_FIELDS,
    ),
    readJsonArray(
      path.join(args.dataDir, files.benchmarks),
      files.benchmarks,
      BENCHMARK_FIELDS,
    ),
  ]);

  const assetPrices = assetPriceRecords.map(normalizeAssetPrice);
  const benchmarks = benchmarkRecords.map(normalizeBenchmark);
  const summary = summarize(assetPrices, benchmarks);

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        dataDir: args.dataDir,
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
  const { tickerMap, ambiguousTickers } = await loadAssetTickerMap(sql);

  await upsertAssetPrices(sql, assetPrices, tickerMap);
  await upsertBenchmarks(sql, benchmarks);

  console.log(
    JSON.stringify(
      {
        importedAssetPriceSnapshots: assetPrices.length,
        importedBenchmarkSnapshots: benchmarks.length,
        ...summarizeAssetMatches(assetPrices, tickerMap, ambiguousTickers),
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
