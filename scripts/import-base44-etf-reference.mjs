import { readFile } from "node:fs/promises";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 50;

const ETF_MASTER_FIELDS = new Set([
  "account_suitability_json",
  "asset_class",
  "aum",
  "average_volume",
  "benchmark_name",
  "category_label",
  "constituent_count",
  "cost_score",
  "created_date",
  "currency",
  "currency_exposure",
  "currency_exposure_json",
  "data_source",
  "distribution_frequency",
  "dividend_yield",
  "etf_strategy",
  "exchange",
  "expense_ratio",
  "exposure_as_of_date",
  "id",
  "inception_date",
  "is_active",
  "is_currency_hedged",
  "is_inverse",
  "is_leveraged",
  "is_sample",
  "is_universe_pick",
  "isin",
  "issuer",
  "last_synced_at",
  "leverage_factor",
  "leverage_type",
  "liquidity_score",
  "listing_country",
  "market",
  "name",
  "notes",
  "official_url",
  "overlap_group",
  "rate_sensitivity",
  "region_exposure_json",
  "region_focus",
  "region_tags_json",
  "risk_level",
  "sector_exposure_json",
  "sector_tags_json",
  "style_tags_json",
  "substitutes_json",
  "theme_tags_json",
  "ticker",
  "top10_holdings_json",
  "universe_priority",
  "updated_date",
]);

const ETF_HOLDING_FIELDS = new Set([
  "as_of_date",
  "created_date",
  "currency",
  "etf_id",
  "etf_name",
  "etf_ticker",
  "holding_country",
  "holding_market",
  "holding_name",
  "holding_symbol",
  "id",
  "industry",
  "is_sample",
  "is_top10",
  "last_synced_at",
  "market_value",
  "notes",
  "rank",
  "sector",
  "security_type",
  "shares",
  "source",
  "source_url",
  "updated_date",
  "weight_pct",
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

function optionalJson(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
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

function normalizeEtfMaster(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "EtfMaster.id"),
    ticker: requiredString(record.ticker, "EtfMaster.ticker"),
    name: requiredString(record.name, "EtfMaster.name"),
    market: requiredString(record.market, "EtfMaster.market"),
    exchange: optionalString(record.exchange),
    currency: requiredString(record.currency, "EtfMaster.currency"),
    issuer: optionalString(record.issuer),
    isin: optionalString(record.isin),
    assetClass: optionalString(record.asset_class),
    categoryLabel: optionalString(record.category_label),
    benchmarkName: optionalString(record.benchmark_name),
    overlapGroup: optionalString(record.overlap_group),
    riskLevel: optionalString(record.risk_level),
    regionFocus: optionalString(record.region_focus),
    currencyExposure: optionalString(record.currency_exposure),
    distributionFrequency: optionalString(record.distribution_frequency),
    etfStrategy: optionalString(record.etf_strategy),
    listingCountry: optionalString(record.listing_country),
    leverageType: optionalString(record.leverage_type),
    dataSource: optionalString(record.data_source),
    officialUrl: optionalString(record.official_url),
    notes: optionalString(record.notes),
    isActive: optionalBoolean(record.is_active, true),
    isUniversePick: optionalBoolean(record.is_universe_pick, null),
    isCurrencyHedged: optionalBoolean(record.is_currency_hedged),
    isInverse: optionalBoolean(record.is_inverse),
    isLeveraged: optionalBoolean(record.is_leveraged),
    isSample: optionalBoolean(record.is_sample),
    constituentCount: optionalInteger(
      record.constituent_count,
      "EtfMaster.constituent_count",
    ),
    universePriority: optionalInteger(
      record.universe_priority,
      "EtfMaster.universe_priority",
    ),
    aum: optionalDecimal(record.aum, "EtfMaster.aum"),
    averageVolume: optionalDecimal(
      record.average_volume,
      "EtfMaster.average_volume",
    ),
    expenseRatio: optionalDecimal(record.expense_ratio, "EtfMaster.expense_ratio"),
    dividendYield: optionalDecimal(
      record.dividend_yield,
      "EtfMaster.dividend_yield",
    ),
    costScore: optionalDecimal(record.cost_score, "EtfMaster.cost_score"),
    liquidityScore: optionalDecimal(
      record.liquidity_score,
      "EtfMaster.liquidity_score",
    ),
    leverageFactor: optionalDecimal(
      record.leverage_factor,
      "EtfMaster.leverage_factor",
    ),
    rateSensitivity: optionalDecimal(
      record.rate_sensitivity,
      "EtfMaster.rate_sensitivity",
    ),
    accountSuitabilityJson: optionalJson(
      record.account_suitability_json,
      "EtfMaster.account_suitability_json",
    ),
    currencyExposureJson: optionalJson(
      record.currency_exposure_json,
      "EtfMaster.currency_exposure_json",
    ),
    regionExposureJson: optionalJson(
      record.region_exposure_json,
      "EtfMaster.region_exposure_json",
    ),
    sectorExposureJson: optionalJson(
      record.sector_exposure_json,
      "EtfMaster.sector_exposure_json",
    ),
    regionTagsJson: optionalJson(
      record.region_tags_json,
      "EtfMaster.region_tags_json",
    ),
    sectorTagsJson: optionalJson(
      record.sector_tags_json,
      "EtfMaster.sector_tags_json",
    ),
    styleTagsJson: optionalJson(
      record.style_tags_json,
      "EtfMaster.style_tags_json",
    ),
    themeTagsJson: optionalJson(
      record.theme_tags_json,
      "EtfMaster.theme_tags_json",
    ),
    substitutesJson: optionalJson(
      record.substitutes_json,
      "EtfMaster.substitutes_json",
    ),
    top10HoldingsJson: optionalJson(
      record.top10_holdings_json,
      "EtfMaster.top10_holdings_json",
    ),
    inceptionDate: validateDateString(
      record.inception_date,
      "EtfMaster.inception_date",
    ),
    exposureAsOfDate: validateDateString(
      record.exposure_as_of_date,
      "EtfMaster.exposure_as_of_date",
    ),
    lastSyncedAt: optionalTimestamp(
      record.last_synced_at,
      "EtfMaster.last_synced_at",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "EtfMaster.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "EtfMaster.updated_date",
    ),
  };
}

function normalizeEtfHolding(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "EtfHolding.id"),
    legacyEtfId: optionalBase44Id(record.etf_id, "EtfHolding.etf_id"),
    etfTicker: requiredString(record.etf_ticker, "EtfHolding.etf_ticker"),
    etfName: requiredString(record.etf_name, "EtfHolding.etf_name"),
    asOfDate: validateDateString(record.as_of_date, "EtfHolding.as_of_date", true),
    holdingSymbol: optionalString(record.holding_symbol),
    holdingName: requiredString(record.holding_name, "EtfHolding.holding_name"),
    holdingMarket: optionalString(record.holding_market),
    holdingCountry: optionalString(record.holding_country),
    currency: optionalString(record.currency),
    sector: optionalString(record.sector),
    industry: optionalString(record.industry),
    securityType: optionalString(record.security_type),
    source: optionalString(record.source),
    sourceUrl: optionalString(record.source_url),
    notes: optionalString(record.notes),
    isTop10: optionalBoolean(record.is_top10),
    isSample: optionalBoolean(record.is_sample),
    rank: optionalInteger(record.rank, "EtfHolding.rank"),
    weightPct: optionalDecimal(record.weight_pct, "EtfHolding.weight_pct"),
    shares: optionalDecimal(record.shares, "EtfHolding.shares"),
    marketValue: optionalDecimal(record.market_value, "EtfHolding.market_value"),
    lastSyncedAt: optionalTimestamp(
      record.last_synced_at,
      "EtfHolding.last_synced_at",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "EtfHolding.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "EtfHolding.updated_date",
    ),
  };
}

function dateRange(rows, key) {
  const values = rows
    .map((row) => row[key])
    .filter(Boolean)
    .map((value) => (value instanceof Date ? value.toISOString() : String(value)))
    .sort();
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

function topDistribution(rows, key, limit = 12) {
  const entries = Object.entries(distribution(rows, key)).sort(
    ([aKey, aValue], [bKey, bValue]) => bValue - aValue || aKey.localeCompare(bKey),
  );
  return Object.fromEntries(entries.slice(0, limit));
}

function summarize(masters, holdings) {
  const holdingLegacyEtfIds = new Set(
    holdings.map((holding) => holding.legacyEtfId).filter(Boolean),
  );
  const masterLegacyIds = new Set(masters.map((master) => master.legacyBase44Id));
  const unmatchedLegacyEtfIds = [...holdingLegacyEtfIds].filter(
    (legacyEtfId) => !masterLegacyIds.has(legacyEtfId),
  );

  return {
    etfMasters: masters.length,
    etfHoldings: holdings.length,
    etfMasterCreatedDateRange: dateRange(masters, "base44CreatedAt"),
    etfHoldingDateRange: dateRange(holdings, "asOfDate"),
    etfMasterTickers: new Set(masters.map((master) => master.ticker)).size,
    etfHoldingTickers: new Set(holdings.map((holding) => holding.etfTicker)).size,
    etfMasterMarkets: distribution(masters, "market"),
    etfMasterCurrencies: distribution(masters, "currency"),
    etfHoldingSources: distribution(holdings, "source"),
    etfHoldingSecurityTypes: distribution(holdings, "securityType"),
    holdingsWithoutLegacyEtfId: holdings.filter((holding) => !holding.legacyEtfId)
      .length,
    unmatchedHoldingLegacyEtfIds: unmatchedLegacyEtfIds.length,
  };
}

async function upsertEtfMasters(sql, masters) {
  const legacyIdMap = new Map();
  const tickerMap = new Map();

  await runInBatches(masters, async (master) => {
    const [row] = await sql`
      insert into etf_masters (
        legacy_base44_id,
        ticker,
        name,
        market,
        exchange,
        currency,
        issuer,
        isin,
        asset_class,
        category_label,
        benchmark_name,
        overlap_group,
        risk_level,
        region_focus,
        currency_exposure,
        distribution_frequency,
        etf_strategy,
        listing_country,
        leverage_type,
        data_source,
        official_url,
        notes,
        is_active,
        is_universe_pick,
        is_currency_hedged,
        is_inverse,
        is_leveraged,
        is_sample,
        constituent_count,
        universe_priority,
        aum,
        average_volume,
        expense_ratio,
        dividend_yield,
        cost_score,
        liquidity_score,
        leverage_factor,
        rate_sensitivity,
        account_suitability_json,
        currency_exposure_json,
        region_exposure_json,
        sector_exposure_json,
        region_tags_json,
        sector_tags_json,
        style_tags_json,
        theme_tags_json,
        substitutes_json,
        top10_holdings_json,
        inception_date,
        exposure_as_of_date,
        last_synced_at,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${master.legacyBase44Id},
        ${master.ticker},
        ${master.name},
        ${master.market},
        ${master.exchange},
        ${master.currency},
        ${master.issuer},
        ${master.isin},
        ${master.assetClass},
        ${master.categoryLabel},
        ${master.benchmarkName},
        ${master.overlapGroup},
        ${master.riskLevel},
        ${master.regionFocus},
        ${master.currencyExposure},
        ${master.distributionFrequency},
        ${master.etfStrategy},
        ${master.listingCountry},
        ${master.leverageType},
        ${master.dataSource},
        ${master.officialUrl},
        ${master.notes},
        ${master.isActive},
        ${master.isUniversePick},
        ${master.isCurrencyHedged},
        ${master.isInverse},
        ${master.isLeveraged},
        ${master.isSample},
        ${master.constituentCount},
        ${master.universePriority},
        ${master.aum},
        ${master.averageVolume},
        ${master.expenseRatio},
        ${master.dividendYield},
        ${master.costScore},
        ${master.liquidityScore},
        ${master.leverageFactor},
        ${master.rateSensitivity},
        ${jsonForDb(master.accountSuitabilityJson)}::jsonb,
        ${jsonForDb(master.currencyExposureJson)}::jsonb,
        ${jsonForDb(master.regionExposureJson)}::jsonb,
        ${jsonForDb(master.sectorExposureJson)}::jsonb,
        ${jsonForDb(master.regionTagsJson)}::jsonb,
        ${jsonForDb(master.sectorTagsJson)}::jsonb,
        ${jsonForDb(master.styleTagsJson)}::jsonb,
        ${jsonForDb(master.themeTagsJson)}::jsonb,
        ${jsonForDb(master.substitutesJson)}::jsonb,
        ${jsonForDb(master.top10HoldingsJson)}::jsonb,
        ${master.inceptionDate},
        ${master.exposureAsOfDate},
        ${master.lastSyncedAt},
        ${master.base44CreatedAt},
        ${master.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        ticker = excluded.ticker,
        name = excluded.name,
        market = excluded.market,
        exchange = excluded.exchange,
        currency = excluded.currency,
        issuer = excluded.issuer,
        isin = excluded.isin,
        asset_class = excluded.asset_class,
        category_label = excluded.category_label,
        benchmark_name = excluded.benchmark_name,
        overlap_group = excluded.overlap_group,
        risk_level = excluded.risk_level,
        region_focus = excluded.region_focus,
        currency_exposure = excluded.currency_exposure,
        distribution_frequency = excluded.distribution_frequency,
        etf_strategy = excluded.etf_strategy,
        listing_country = excluded.listing_country,
        leverage_type = excluded.leverage_type,
        data_source = excluded.data_source,
        official_url = excluded.official_url,
        notes = excluded.notes,
        is_active = excluded.is_active,
        is_universe_pick = excluded.is_universe_pick,
        is_currency_hedged = excluded.is_currency_hedged,
        is_inverse = excluded.is_inverse,
        is_leveraged = excluded.is_leveraged,
        is_sample = excluded.is_sample,
        constituent_count = excluded.constituent_count,
        universe_priority = excluded.universe_priority,
        aum = excluded.aum,
        average_volume = excluded.average_volume,
        expense_ratio = excluded.expense_ratio,
        dividend_yield = excluded.dividend_yield,
        cost_score = excluded.cost_score,
        liquidity_score = excluded.liquidity_score,
        leverage_factor = excluded.leverage_factor,
        rate_sensitivity = excluded.rate_sensitivity,
        account_suitability_json = excluded.account_suitability_json,
        currency_exposure_json = excluded.currency_exposure_json,
        region_exposure_json = excluded.region_exposure_json,
        sector_exposure_json = excluded.sector_exposure_json,
        region_tags_json = excluded.region_tags_json,
        sector_tags_json = excluded.sector_tags_json,
        style_tags_json = excluded.style_tags_json,
        theme_tags_json = excluded.theme_tags_json,
        substitutes_json = excluded.substitutes_json,
        top10_holdings_json = excluded.top10_holdings_json,
        inception_date = excluded.inception_date,
        exposure_as_of_date = excluded.exposure_as_of_date,
        last_synced_at = excluded.last_synced_at,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
      returning id, legacy_base44_id, ticker
    `;

    legacyIdMap.set(row.legacy_base44_id, row.id);
    tickerMap.set(row.ticker, row.id);
  });

  return { legacyIdMap, tickerMap };
}

function resolveEtfMasterId(holding, legacyIdMap, tickerMap) {
  if (holding.legacyEtfId && legacyIdMap.has(holding.legacyEtfId)) {
    return { etfMasterId: legacyIdMap.get(holding.legacyEtfId), matchType: "legacy" };
  }

  if (tickerMap.has(holding.etfTicker)) {
    return { etfMasterId: tickerMap.get(holding.etfTicker), matchType: "ticker" };
  }

  return { etfMasterId: null, matchType: "unmatched" };
}

async function upsertEtfHoldings(sql, holdings, legacyIdMap, tickerMap) {
  const matchSummary = {
    matchedByLegacyEtfId: 0,
    matchedByTicker: 0,
    unmatched: 0,
  };

  await runInBatches(holdings, async (holding) => {
    const { etfMasterId, matchType } = resolveEtfMasterId(
      holding,
      legacyIdMap,
      tickerMap,
    );

    if (matchType === "legacy") matchSummary.matchedByLegacyEtfId += 1;
    if (matchType === "ticker") matchSummary.matchedByTicker += 1;
    if (matchType === "unmatched") matchSummary.unmatched += 1;

    await sql`
      insert into etf_holdings (
        legacy_base44_id,
        etf_master_id,
        legacy_etf_id,
        etf_ticker,
        etf_name,
        as_of_date,
        holding_symbol,
        holding_name,
        holding_market,
        holding_country,
        currency,
        sector,
        industry,
        security_type,
        source,
        source_url,
        notes,
        is_top10,
        is_sample,
        rank,
        weight_pct,
        shares,
        market_value,
        last_synced_at,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${holding.legacyBase44Id},
        ${etfMasterId},
        ${holding.legacyEtfId},
        ${holding.etfTicker},
        ${holding.etfName},
        ${holding.asOfDate},
        ${holding.holdingSymbol},
        ${holding.holdingName},
        ${holding.holdingMarket},
        ${holding.holdingCountry},
        ${holding.currency},
        ${holding.sector},
        ${holding.industry},
        ${holding.securityType},
        ${holding.source},
        ${holding.sourceUrl},
        ${holding.notes},
        ${holding.isTop10},
        ${holding.isSample},
        ${holding.rank},
        ${holding.weightPct},
        ${holding.shares},
        ${holding.marketValue},
        ${holding.lastSyncedAt},
        ${holding.base44CreatedAt},
        ${holding.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        etf_master_id = excluded.etf_master_id,
        legacy_etf_id = excluded.legacy_etf_id,
        etf_ticker = excluded.etf_ticker,
        etf_name = excluded.etf_name,
        as_of_date = excluded.as_of_date,
        holding_symbol = excluded.holding_symbol,
        holding_name = excluded.holding_name,
        holding_market = excluded.holding_market,
        holding_country = excluded.holding_country,
        currency = excluded.currency,
        sector = excluded.sector,
        industry = excluded.industry,
        security_type = excluded.security_type,
        source = excluded.source,
        source_url = excluded.source_url,
        notes = excluded.notes,
        is_top10 = excluded.is_top10,
        is_sample = excluded.is_sample,
        rank = excluded.rank,
        weight_pct = excluded.weight_pct,
        shares = excluded.shares,
        market_value = excluded.market_value,
        last_synced_at = excluded.last_synced_at,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });

  return matchSummary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = {
    masters: "base44-etf-masters.export.json",
    holdings: "base44-etf-holdings.export.json",
  };

  const [masterRecords, holdingRecords] = await Promise.all([
    readJsonArray(path.join(args.dataDir, files.masters), files.masters, ETF_MASTER_FIELDS),
    readJsonArray(
      path.join(args.dataDir, files.holdings),
      files.holdings,
      ETF_HOLDING_FIELDS,
    ),
  ]);

  const masters = masterRecords.map(normalizeEtfMaster);
  const holdings = holdingRecords.map(normalizeEtfHolding);
  const summary = summarize(masters, holdings);

  console.log(
    JSON.stringify(
      {
        mode: args.write ? "write" : "dry-run",
        dataDir: args.dataDir,
        ...summary,
        topEtfHoldingSources: topDistribution(holdings, "source"),
        topEtfHoldingSecurityTypes: topDistribution(holdings, "securityType"),
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
  const { legacyIdMap, tickerMap } = await upsertEtfMasters(sql, masters);
  const holdingMatchSummary = await upsertEtfHoldings(
    sql,
    holdings,
    legacyIdMap,
    tickerMap,
  );

  console.log(
    JSON.stringify(
      {
        importedEtfMasters: masters.length,
        importedEtfHoldings: holdings.length,
        ...holdingMatchSummary,
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
