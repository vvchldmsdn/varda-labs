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
  HistoryImportArgumentError,
  buildBase44HistoryCanonicalPlan,
  parseBase44HistoryArgs,
} from "./lib/base44-history-canonical-plan.mjs";
import { readBase44HistoryCanonicalState } from "./lib/base44-history-canonical-state.mjs";
import {
  HistoryShadowSourceError,
  normalizeBase44HistoryShadowSource,
} from "./lib/base44-history-shadow-source.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|api[_-]?key|created_by|user_id|owner_user_id)/i;
const UPSERT_BATCH_SIZE = 25;

async function runInBatches(items, handler) {
  for (let index = 0; index < items.length; index += UPSERT_BATCH_SIZE) {
    const batch = items.slice(index, index + UPSERT_BATCH_SIZE);
    await Promise.all(batch.map(handler));
  }
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

function normalizeFxRate(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "FxRate.id"),
    rateDate: validateDateString(record.date, "FxRate.date", true),
    usdKrw: optionalDecimal(record.usdkrw, "FxRate.usdkrw"),
    source: optionalString(record.source),
    status: optionalString(record.status),
    fetchedAt: optionalTimestamp(record.fetched_at, "FxRate.fetched_at"),
    isSample: optionalBoolean(record.is_sample),
    base44CreatedAt: optionalTimestamp(record.created_date, "FxRate.created_date"),
    base44UpdatedAt: optionalTimestamp(record.updated_date, "FxRate.updated_date"),
  };
}

function normalizeAccountBalance(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "AccountBalance.id"),
    balanceDate: validateDateString(record.date, "AccountBalance.date", true),
    cash: optionalDecimal(record.cash, "AccountBalance.cash"),
    brokerage: optionalDecimal(record.brokerage, "AccountBalance.brokerage"),
    isa: optionalDecimal(record.isa, "AccountBalance.isa"),
    irp: optionalDecimal(record.irp, "AccountBalance.irp"),
    isSample: optionalBoolean(record.is_sample),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "AccountBalance.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "AccountBalance.updated_date",
    ),
  };
}

function normalizePortfolioSnapshot(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "DailyPortfolioSnapshot.id"),
    snapshotDate: validateDateString(
      record.snapshot_date,
      "DailyPortfolioSnapshot.snapshot_date",
      true,
    ),
    account: requiredString(record.account, "DailyPortfolioSnapshot.account"),
    ruleVersion: optionalString(record.rule_version),
    description: optionalString(record.description),
    isSample: optionalBoolean(record.is_sample),
    cashValue: optionalDecimal(record.cash_value, "DailyPortfolioSnapshot.cash_value"),
    investedAmount: optionalDecimal(
      record.invested_amount,
      "DailyPortfolioSnapshot.invested_amount",
    ),
    totalCost: optionalDecimal(record.total_cost, "DailyPortfolioSnapshot.total_cost"),
    totalMarketValue: optionalDecimal(
      record.total_market_value,
      "DailyPortfolioSnapshot.total_market_value",
    ),
    totalPnl: optionalDecimal(record.total_pnl, "DailyPortfolioSnapshot.total_pnl"),
    totalReturnPct: optionalDecimal(
      record.total_return_pct,
      "DailyPortfolioSnapshot.total_return_pct",
    ),
    fxRate: optionalDecimal(record.fx_rate, "DailyPortfolioSnapshot.fx_rate"),
    usdKrw: optionalDecimal(record.usdkrw, "DailyPortfolioSnapshot.usdkrw"),
    krWeight: optionalDecimal(record.kr_weight, "DailyPortfolioSnapshot.kr_weight"),
    usWeight: optionalDecimal(record.us_weight, "DailyPortfolioSnapshot.us_weight"),
    usdExposurePct: optionalDecimal(
      record.usd_exposure_pct,
      "DailyPortfolioSnapshot.usd_exposure_pct",
    ),
    thematicWeight: optionalDecimal(
      record.thematic_weight,
      "DailyPortfolioSnapshot.thematic_weight",
    ),
    numAssets: optionalInteger(record.num_assets, "DailyPortfolioSnapshot.num_assets"),
    numGroups: optionalInteger(record.num_groups, "DailyPortfolioSnapshot.num_groups"),
    topHoldingName: optionalString(record.top_holding_name),
    topHoldingWeight: optionalDecimal(
      record.top_holding_weight,
      "DailyPortfolioSnapshot.top_holding_weight",
    ),
    benchmarkValue: optionalDecimal(
      record.benchmark_value,
      "DailyPortfolioSnapshot.benchmark_value",
    ),
    benchmarkIndexValue: optionalDecimal(
      record.benchmark_index_value,
      "DailyPortfolioSnapshot.benchmark_index_value",
    ),
    kodex200Value: optionalDecimal(
      record.kodex200_value,
      "DailyPortfolioSnapshot.kodex200_value",
    ),
    kospi200Value: optionalDecimal(
      record.kospi200_value,
      "DailyPortfolioSnapshot.kospi200_value",
    ),
    kospi200Index: optionalDecimal(
      record.kospi200_index,
      "DailyPortfolioSnapshot.kospi200_index",
    ),
    sp500Index: optionalDecimal(
      record.sp500_index,
      "DailyPortfolioSnapshot.sp500_index",
    ),
    vooValue: optionalDecimal(record.voo_value, "DailyPortfolioSnapshot.voo_value"),
    avgCorrelation: optionalDecimal(
      record.avg_correlation,
      "DailyPortfolioSnapshot.avg_correlation",
    ),
    enb: optionalDecimal(record.enb, "DailyPortfolioSnapshot.enb"),
    portfolioVolatility: optionalDecimal(
      record.portfolio_volatility,
      "DailyPortfolioSnapshot.portfolio_volatility",
    ),
    regimeLabel: optionalString(record.regime_label),
    regimeScore: optionalDecimal(
      record.regime_score,
      "DailyPortfolioSnapshot.regime_score",
    ),
    capturedAt: optionalTimestamp(
      record.captured_at,
      "DailyPortfolioSnapshot.captured_at",
    ),
    cycleStartAt: optionalTimestamp(
      record.cycle_start_at,
      "DailyPortfolioSnapshot.cycle_start_at",
    ),
    cycleEndAt: optionalTimestamp(
      record.cycle_end_at,
      "DailyPortfolioSnapshot.cycle_end_at",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "DailyPortfolioSnapshot.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "DailyPortfolioSnapshot.updated_date",
    ),
  };
}

function normalizePositionSnapshot(record) {
  return {
    legacyBase44Id: assertBase44Id(record.id, "DailyPositionSnapshot.id"),
    snapshotDate: validateDateString(
      record.snapshot_date,
      "DailyPositionSnapshot.snapshot_date",
      true,
    ),
    legacyAssetId: assertBase44Id(
      record.asset_id,
      "DailyPositionSnapshot.asset_id",
    ),
    ticker: optionalString(record.ticker),
    assetName: requiredString(
      record.asset_name,
      "DailyPositionSnapshot.asset_name",
    ),
    account: requiredString(record.account, "DailyPositionSnapshot.account"),
    market: optionalString(record.market),
    currency: optionalString(record.currency),
    assetStatus: optionalString(record.asset_status),
    assetType: optionalString(record.asset_type),
    category: optionalString(record.category),
    sector: optionalString(record.sector),
    sourceType: optionalString(record.source_type),
    exposureType: optionalString(record.exposure_type),
    legacyGroupId: optionalString(record.group_id),
    groupName: optionalString(record.group_name),
    priceSource: optionalString(record.price_source),
    priceBasis: optionalString(record.price_basis),
    description: optionalString(record.description),
    belowMa: optionalBoolean(record.below_ma),
    isSample: optionalBoolean(record.is_sample),
    quantity: optionalDecimal(record.quantity, "DailyPositionSnapshot.quantity"),
    totalQuantity: optionalDecimal(
      record.total_quantity,
      "DailyPositionSnapshot.total_quantity",
    ),
    estimatedFractionalQuantity: optionalDecimal(
      record.estimated_fractional_quantity,
      "DailyPositionSnapshot.estimated_fractional_quantity",
    ),
    avgCost: optionalDecimal(record.avg_cost, "DailyPositionSnapshot.avg_cost"),
    currentPrice: optionalDecimal(
      record.current_price,
      "DailyPositionSnapshot.current_price",
    ),
    closePrice: optionalDecimal(
      record.close_price,
      "DailyPositionSnapshot.close_price",
    ),
    unitPrice: optionalDecimal(record.unit_price, "DailyPositionSnapshot.unit_price"),
    unitValueKrw: optionalDecimal(
      record.unit_value_krw,
      "DailyPositionSnapshot.unit_value_krw",
    ),
    marketValueLocal: optionalDecimal(
      record.market_value_local,
      "DailyPositionSnapshot.market_value_local",
    ),
    marketValueKrw: optionalDecimal(
      record.market_value_krw,
      "DailyPositionSnapshot.market_value_krw",
    ),
    costKrw: optionalDecimal(record.cost_krw, "DailyPositionSnapshot.cost_krw"),
    pnlKrw: optionalDecimal(record.pnl_krw, "DailyPositionSnapshot.pnl_krw"),
    pnlPct: optionalDecimal(record.pnl_pct, "DailyPositionSnapshot.pnl_pct"),
    currentWeight: optionalDecimal(
      record.current_weight,
      "DailyPositionSnapshot.current_weight",
    ),
    targetWeight: optionalDecimal(
      record.target_weight,
      "DailyPositionSnapshot.target_weight",
    ),
    targetWeightRaw: optionalDecimal(
      record.target_weight_raw,
      "DailyPositionSnapshot.target_weight_raw",
    ),
    targetWeightEffective: optionalDecimal(
      record.target_weight_effective,
      "DailyPositionSnapshot.target_weight_effective",
    ),
    trimTargetWeight: optionalDecimal(
      record.trim_target_weight,
      "DailyPositionSnapshot.trim_target_weight",
    ),
    driftPct: optionalDecimal(record.drift_pct, "DailyPositionSnapshot.drift_pct"),
    fxRate: optionalDecimal(record.fx_rate, "DailyPositionSnapshot.fx_rate"),
    previousFxRate: optionalDecimal(
      record.previous_fx_rate,
      "DailyPositionSnapshot.previous_fx_rate",
    ),
    previousQuantity: optionalDecimal(
      record.previous_quantity,
      "DailyPositionSnapshot.previous_quantity",
    ),
    previousUnitPrice: optionalDecimal(
      record.previous_unit_price,
      "DailyPositionSnapshot.previous_unit_price",
    ),
    previousUnitValueKrw: optionalDecimal(
      record.previous_unit_value_krw,
      "DailyPositionSnapshot.previous_unit_value_krw",
    ),
    previousMarketValueKrw: optionalDecimal(
      record.previous_market_value_krw,
      "DailyPositionSnapshot.previous_market_value_krw",
    ),
    priceChangeKrw: optionalDecimal(
      record.price_change_krw,
      "DailyPositionSnapshot.price_change_krw",
    ),
    fxChangeKrw: optionalDecimal(
      record.fx_change_krw,
      "DailyPositionSnapshot.fx_change_krw",
    ),
    marketValueChangeKrw: optionalDecimal(
      record.market_value_change_krw,
      "DailyPositionSnapshot.market_value_change_krw",
    ),
    marketValueChangePct: optionalDecimal(
      record.market_value_change_pct,
      "DailyPositionSnapshot.market_value_change_pct",
    ),
    unitValueChangeKrw: optionalDecimal(
      record.unit_value_change_krw,
      "DailyPositionSnapshot.unit_value_change_krw",
    ),
    unitValueChangePct: optionalDecimal(
      record.unit_value_change_pct,
      "DailyPositionSnapshot.unit_value_change_pct",
    ),
    ma120: optionalDecimal(record.ma_120, "DailyPositionSnapshot.ma_120"),
    fractionalKrwValue: optionalDecimal(
      record.fractional_krw_value,
      "DailyPositionSnapshot.fractional_krw_value",
    ),
    fractionalAvgCost: optionalDecimal(
      record.fractional_avg_cost,
      "DailyPositionSnapshot.fractional_avg_cost",
    ),
    priceDate: validateDateString(
      record.price_date,
      "DailyPositionSnapshot.price_date",
    ),
    referenceDate: validateDateString(
      record.reference_date,
      "DailyPositionSnapshot.reference_date",
    ),
    fxReferenceDate: validateDateString(
      record.fx_reference_date,
      "DailyPositionSnapshot.fx_reference_date",
    ),
    previousReferenceDate: validateDateString(
      record.previous_reference_date,
      "DailyPositionSnapshot.previous_reference_date",
    ),
    previousSnapshotDate: validateDateString(
      record.previous_snapshot_date,
      "DailyPositionSnapshot.previous_snapshot_date",
    ),
    capturedAt: optionalTimestamp(
      record.captured_at,
      "DailyPositionSnapshot.captured_at",
    ),
    cycleStartAt: optionalTimestamp(
      record.cycle_start_at,
      "DailyPositionSnapshot.cycle_start_at",
    ),
    cycleEndAt: optionalTimestamp(
      record.cycle_end_at,
      "DailyPositionSnapshot.cycle_end_at",
    ),
    sourceCreatedAt: optionalTimestamp(
      record.created_at,
      "DailyPositionSnapshot.created_at",
    ),
    base44CreatedAt: optionalTimestamp(
      record.created_date,
      "DailyPositionSnapshot.created_date",
    ),
    base44UpdatedAt: optionalTimestamp(
      record.updated_date,
      "DailyPositionSnapshot.updated_date",
    ),
  };
}

function dateRange(rows, key) {
  const values = rows.map((row) => row[key]).filter(Boolean).sort();
  if (values.length === 0) return null;
  return { from: values[0], to: values[values.length - 1] };
}

function summarize({ balances, portfolios, positions, fxRates }) {
  const legacyAssetIds = new Set(positions.map((position) => position.legacyAssetId));
  const accountCodes = new Set([
    ...portfolios.map((portfolio) => portfolio.account),
    ...positions.map((position) => position.account),
  ]);

  return {
    accountBalances: balances.length,
    dailyPortfolioSnapshots: portfolios.length,
    dailyPositionSnapshots: positions.length,
    fxRates: fxRates.length,
    accountBalanceDateRange: dateRange(balances, "balanceDate"),
    portfolioDateRange: dateRange(portfolios, "snapshotDate"),
    positionDateRange: dateRange(positions, "snapshotDate"),
    fxRateDateRange: dateRange(fxRates, "rateDate"),
    positionLegacyAssetIds: legacyAssetIds.size,
    accountCodes: [...accountCodes].sort(),
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

async function upsertFxRates(sql, fxRates) {
  await runInBatches(fxRates, async (rate) => {
    await sql`
      insert into fx_rates (
        legacy_base44_id,
        date,
        usdkrw,
        source,
        status,
        fetched_at,
        is_sample,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${rate.legacyBase44Id},
        ${rate.rateDate},
        ${rate.usdKrw},
        ${rate.source},
        ${rate.status},
        ${rate.fetchedAt},
        ${rate.isSample},
        ${rate.base44CreatedAt},
        ${rate.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        usdkrw = excluded.usdkrw,
        source = excluded.source,
        status = excluded.status,
        fetched_at = excluded.fetched_at,
        is_sample = excluded.is_sample,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertAccountBalances(sql, balances) {
  await runInBatches(balances, async (balance) => {
    await sql`
      insert into account_balance_snapshots (
        legacy_base44_id,
        date,
        cash,
        brokerage,
        isa,
        irp,
        is_sample,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${balance.legacyBase44Id},
        ${balance.balanceDate},
        ${balance.cash},
        ${balance.brokerage},
        ${balance.isa},
        ${balance.irp},
        ${balance.isSample},
        ${balance.base44CreatedAt},
        ${balance.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        date = excluded.date,
        cash = excluded.cash,
        brokerage = excluded.brokerage,
        isa = excluded.isa,
        irp = excluded.irp,
        is_sample = excluded.is_sample,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertPortfolioSnapshots(sql, portfolios, accountMap) {
  await runInBatches(portfolios, async (portfolio) => {
    const accountId = accountMap.get(portfolio.account) ?? null;

    await sql`
      insert into daily_portfolio_snapshots (
        legacy_base44_id,
        snapshot_date,
        account,
        account_id,
        rule_version,
        description,
        is_sample,
        cash_value,
        invested_amount,
        total_cost,
        total_market_value,
        total_pnl,
        total_return_pct,
        fx_rate,
        usdkrw,
        kr_weight,
        us_weight,
        usd_exposure_pct,
        thematic_weight,
        num_assets,
        num_groups,
        top_holding_name,
        top_holding_weight,
        benchmark_value,
        benchmark_index_value,
        kodex200_value,
        kospi200_value,
        kospi200_index,
        sp500_index,
        voo_value,
        avg_correlation,
        enb,
        portfolio_volatility,
        regime_label,
        regime_score,
        captured_at,
        cycle_start_at,
        cycle_end_at,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${portfolio.legacyBase44Id},
        ${portfolio.snapshotDate},
        ${portfolio.account},
        ${accountId},
        ${portfolio.ruleVersion},
        ${portfolio.description},
        ${portfolio.isSample},
        ${portfolio.cashValue},
        ${portfolio.investedAmount},
        ${portfolio.totalCost},
        ${portfolio.totalMarketValue},
        ${portfolio.totalPnl},
        ${portfolio.totalReturnPct},
        ${portfolio.fxRate},
        ${portfolio.usdKrw},
        ${portfolio.krWeight},
        ${portfolio.usWeight},
        ${portfolio.usdExposurePct},
        ${portfolio.thematicWeight},
        ${portfolio.numAssets},
        ${portfolio.numGroups},
        ${portfolio.topHoldingName},
        ${portfolio.topHoldingWeight},
        ${portfolio.benchmarkValue},
        ${portfolio.benchmarkIndexValue},
        ${portfolio.kodex200Value},
        ${portfolio.kospi200Value},
        ${portfolio.kospi200Index},
        ${portfolio.sp500Index},
        ${portfolio.vooValue},
        ${portfolio.avgCorrelation},
        ${portfolio.enb},
        ${portfolio.portfolioVolatility},
        ${portfolio.regimeLabel},
        ${portfolio.regimeScore},
        ${portfolio.capturedAt},
        ${portfolio.cycleStartAt},
        ${portfolio.cycleEndAt},
        ${portfolio.base44CreatedAt},
        ${portfolio.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        snapshot_date = excluded.snapshot_date,
        account = excluded.account,
        account_id = excluded.account_id,
        rule_version = excluded.rule_version,
        description = excluded.description,
        is_sample = excluded.is_sample,
        cash_value = excluded.cash_value,
        invested_amount = excluded.invested_amount,
        total_cost = excluded.total_cost,
        total_market_value = excluded.total_market_value,
        total_pnl = excluded.total_pnl,
        total_return_pct = excluded.total_return_pct,
        fx_rate = excluded.fx_rate,
        usdkrw = excluded.usdkrw,
        kr_weight = excluded.kr_weight,
        us_weight = excluded.us_weight,
        usd_exposure_pct = excluded.usd_exposure_pct,
        thematic_weight = excluded.thematic_weight,
        num_assets = excluded.num_assets,
        num_groups = excluded.num_groups,
        top_holding_name = excluded.top_holding_name,
        top_holding_weight = excluded.top_holding_weight,
        benchmark_value = excluded.benchmark_value,
        benchmark_index_value = excluded.benchmark_index_value,
        kodex200_value = excluded.kodex200_value,
        kospi200_value = excluded.kospi200_value,
        kospi200_index = excluded.kospi200_index,
        sp500_index = excluded.sp500_index,
        voo_value = excluded.voo_value,
        avg_correlation = excluded.avg_correlation,
        enb = excluded.enb,
        portfolio_volatility = excluded.portfolio_volatility,
        regime_label = excluded.regime_label,
        regime_score = excluded.regime_score,
        captured_at = excluded.captured_at,
        cycle_start_at = excluded.cycle_start_at,
        cycle_end_at = excluded.cycle_end_at,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });
}

async function upsertPositionSnapshots(sql, positions, accountMap, assetMap) {
  const matchedAssets = positions.filter((position) =>
    assetMap.has(position.legacyAssetId),
  ).length;
  const unmatchedAssets = positions.length - matchedAssets;

  await runInBatches(positions, async (position) => {
    const accountId = accountMap.get(position.account) ?? null;
    const assetId = assetMap.get(position.legacyAssetId) ?? null;

    await sql`
      insert into daily_position_snapshots (
        legacy_base44_id,
        snapshot_date,
        asset_id,
        legacy_asset_id,
        ticker,
        asset_name,
        account,
        account_id,
        market,
        currency,
        asset_status,
        asset_type,
        category,
        sector,
        source_type,
        exposure_type,
        legacy_group_id,
        group_name,
        price_source,
        price_basis,
        description,
        below_ma,
        is_sample,
        quantity,
        total_quantity,
        estimated_fractional_quantity,
        avg_cost,
        current_price,
        close_price,
        unit_price,
        unit_value_krw,
        market_value_local,
        market_value_krw,
        cost_krw,
        pnl_krw,
        pnl_pct,
        current_weight,
        target_weight,
        target_weight_raw,
        target_weight_effective,
        trim_target_weight,
        drift_pct,
        fx_rate,
        previous_fx_rate,
        previous_quantity,
        previous_unit_price,
        previous_unit_value_krw,
        previous_market_value_krw,
        price_change_krw,
        fx_change_krw,
        market_value_change_krw,
        market_value_change_pct,
        unit_value_change_krw,
        unit_value_change_pct,
        ma_120,
        fractional_krw_value,
        fractional_avg_cost,
        price_date,
        reference_date,
        fx_reference_date,
        previous_reference_date,
        previous_snapshot_date,
        captured_at,
        cycle_start_at,
        cycle_end_at,
        source_created_at,
        base44_created_at,
        base44_updated_at
      )
      values (
        ${position.legacyBase44Id},
        ${position.snapshotDate},
        ${assetId},
        ${position.legacyAssetId},
        ${position.ticker},
        ${position.assetName},
        ${position.account},
        ${accountId},
        ${position.market},
        ${position.currency},
        ${position.assetStatus},
        ${position.assetType},
        ${position.category},
        ${position.sector},
        ${position.sourceType},
        ${position.exposureType},
        ${position.legacyGroupId},
        ${position.groupName},
        ${position.priceSource},
        ${position.priceBasis},
        ${position.description},
        ${position.belowMa},
        ${position.isSample},
        ${position.quantity},
        ${position.totalQuantity},
        ${position.estimatedFractionalQuantity},
        ${position.avgCost},
        ${position.currentPrice},
        ${position.closePrice},
        ${position.unitPrice},
        ${position.unitValueKrw},
        ${position.marketValueLocal},
        ${position.marketValueKrw},
        ${position.costKrw},
        ${position.pnlKrw},
        ${position.pnlPct},
        ${position.currentWeight},
        ${position.targetWeight},
        ${position.targetWeightRaw},
        ${position.targetWeightEffective},
        ${position.trimTargetWeight},
        ${position.driftPct},
        ${position.fxRate},
        ${position.previousFxRate},
        ${position.previousQuantity},
        ${position.previousUnitPrice},
        ${position.previousUnitValueKrw},
        ${position.previousMarketValueKrw},
        ${position.priceChangeKrw},
        ${position.fxChangeKrw},
        ${position.marketValueChangeKrw},
        ${position.marketValueChangePct},
        ${position.unitValueChangeKrw},
        ${position.unitValueChangePct},
        ${position.ma120},
        ${position.fractionalKrwValue},
        ${position.fractionalAvgCost},
        ${position.priceDate},
        ${position.referenceDate},
        ${position.fxReferenceDate},
        ${position.previousReferenceDate},
        ${position.previousSnapshotDate},
        ${position.capturedAt},
        ${position.cycleStartAt},
        ${position.cycleEndAt},
        ${position.sourceCreatedAt},
        ${position.base44CreatedAt},
        ${position.base44UpdatedAt}
      )
      on conflict (legacy_base44_id) do update set
        snapshot_date = excluded.snapshot_date,
        asset_id = excluded.asset_id,
        legacy_asset_id = excluded.legacy_asset_id,
        ticker = excluded.ticker,
        asset_name = excluded.asset_name,
        account = excluded.account,
        account_id = excluded.account_id,
        market = excluded.market,
        currency = excluded.currency,
        asset_status = excluded.asset_status,
        asset_type = excluded.asset_type,
        category = excluded.category,
        sector = excluded.sector,
        source_type = excluded.source_type,
        exposure_type = excluded.exposure_type,
        legacy_group_id = excluded.legacy_group_id,
        group_name = excluded.group_name,
        price_source = excluded.price_source,
        price_basis = excluded.price_basis,
        description = excluded.description,
        below_ma = excluded.below_ma,
        is_sample = excluded.is_sample,
        quantity = excluded.quantity,
        total_quantity = excluded.total_quantity,
        estimated_fractional_quantity = excluded.estimated_fractional_quantity,
        avg_cost = excluded.avg_cost,
        current_price = excluded.current_price,
        close_price = excluded.close_price,
        unit_price = excluded.unit_price,
        unit_value_krw = excluded.unit_value_krw,
        market_value_local = excluded.market_value_local,
        market_value_krw = excluded.market_value_krw,
        cost_krw = excluded.cost_krw,
        pnl_krw = excluded.pnl_krw,
        pnl_pct = excluded.pnl_pct,
        current_weight = excluded.current_weight,
        target_weight = excluded.target_weight,
        target_weight_raw = excluded.target_weight_raw,
        target_weight_effective = excluded.target_weight_effective,
        trim_target_weight = excluded.trim_target_weight,
        drift_pct = excluded.drift_pct,
        fx_rate = excluded.fx_rate,
        previous_fx_rate = excluded.previous_fx_rate,
        previous_quantity = excluded.previous_quantity,
        previous_unit_price = excluded.previous_unit_price,
        previous_unit_value_krw = excluded.previous_unit_value_krw,
        previous_market_value_krw = excluded.previous_market_value_krw,
        price_change_krw = excluded.price_change_krw,
        fx_change_krw = excluded.fx_change_krw,
        market_value_change_krw = excluded.market_value_change_krw,
        market_value_change_pct = excluded.market_value_change_pct,
        unit_value_change_krw = excluded.unit_value_change_krw,
        unit_value_change_pct = excluded.unit_value_change_pct,
        ma_120 = excluded.ma_120,
        fractional_krw_value = excluded.fractional_krw_value,
        fractional_avg_cost = excluded.fractional_avg_cost,
        price_date = excluded.price_date,
        reference_date = excluded.reference_date,
        fx_reference_date = excluded.fx_reference_date,
        previous_reference_date = excluded.previous_reference_date,
        previous_snapshot_date = excluded.previous_snapshot_date,
        captured_at = excluded.captured_at,
        cycle_start_at = excluded.cycle_start_at,
        cycle_end_at = excluded.cycle_end_at,
        source_created_at = excluded.source_created_at,
        base44_created_at = excluded.base44_created_at,
        base44_updated_at = excluded.base44_updated_at,
        updated_at = now()
    `;
  });

  return { matchedAssets, unmatchedAssets };
}

async function main() {
  const args = parseBase44HistoryArgs(process.argv.slice(2), {
    defaultDataDir:
      process.env.BASE44_MIGRATION_DATA_DIR ??
      path.resolve(process.cwd(), "..", "gyeol-fin", "migration-data"),
    legacyOwnerUserId: process.env.IMPORT_OWNER_USER_ID ?? "base44-import",
  });
  const files = {
    balances: "base44-account-balances.export.json",
    portfolios: "base44-daily-portfolio-snapshots.export.json",
    positions: "base44-daily-position-snapshots.export.json",
    fxRates: "base44-fx-rates.export.json",
  };

  const [balanceRecords, portfolioRecords, positionRecords, fxRateRecords] =
    await Promise.all([
      readJsonArray(path.join(args.dataDir, files.balances), files.balances),
      readJsonArray(path.join(args.dataDir, files.portfolios), files.portfolios),
      readJsonArray(path.join(args.dataDir, files.positions), files.positions),
      readJsonArray(path.join(args.dataDir, files.fxRates), files.fxRates),
    ]);

  if (args.canonicalOwnerId !== null) {
    const source = normalizeBase44HistoryShadowSource({
      balanceRecords,
      portfolioRecords,
      positionRecords,
      fxRateRecords,
    });
    const coreSource = await readBase44CoreShadowSource(args.dataDir);

    config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }

    const sql = neon(process.env.DATABASE_URL);
    const [historyState, coreState] = await Promise.all([
      readBase44HistoryCanonicalState(sql, {
        canonicalOwnerId: args.canonicalOwnerId,
        legacyOwnerUserId: args.ownerUserId,
        source,
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
    const canonicalOwnerPlan = buildBase44HistoryCanonicalPlan({
      canonicalOwnerId: args.canonicalOwnerId,
      approveProvisioningOwner: args.approveProvisioningOwner,
      legacyOwnerUserId: args.ownerUserId,
      appUser: historyState.appUser,
      source,
      state: historyState,
      coreProof: {
        result: corePlan.result,
        actualWriteAllowed: corePlan.actualWriteAllowed,
        canonicalOwnerWriteEnabled: corePlan.canonicalOwnerWriteEnabled,
        databaseSideEffects: corePlan.databaseSideEffects,
        accountCodes: coreSource.accountCodes,
        assetLegacyIds: coreSource.assets.map(
          ({ legacyBase44Id }) => legacyBase44Id,
        ),
      },
    });

    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          ownerMode: "canonical-shadow",
          selectCount: historyState.selectCount + coreState.selectCount,
          canonicalOwnerPlan,
        },
        null,
        2,
      ),
    );
    if (canonicalOwnerPlan.result === "blocked") {
      console.error("History canonical owner shadow plan is blocked");
      process.exitCode = 1;
    }
    return;
  }

  const balances = balanceRecords.map(normalizeAccountBalance);
  const portfolios = portfolioRecords.map(normalizePortfolioSnapshot);
  const positions = positionRecords.map(normalizePositionSnapshot);
  const fxRates = fxRateRecords.map(normalizeFxRate);
  const summary = summarize({ balances, portfolios, positions, fxRates });

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

  config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const sql = neon(process.env.DATABASE_URL);
  const accountMap = await loadAccountMap(sql, args.ownerUserId);
  const assetMap = await loadAssetMap(sql);

  await upsertFxRates(sql, fxRates);
  await upsertAccountBalances(sql, balances);
  await upsertPortfolioSnapshots(sql, portfolios, accountMap);
  const positionResult = await upsertPositionSnapshots(
    sql,
    positions,
    accountMap,
    assetMap,
  );

  console.log(
    JSON.stringify(
      {
        importedFxRates: fxRates.length,
        importedAccountBalances: balances.length,
        importedDailyPortfolioSnapshots: portfolios.length,
        importedDailyPositionSnapshots: positions.length,
        dailyPositionMatchedAssets: positionResult.matchedAssets,
        dailyPositionUnmatchedAssets: positionResult.unmatchedAssets,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      operation: "base44_history_import",
      result: "failed",
      error: safeErrorCode(error),
    }),
  );
  process.exitCode = 1;
});

function safeErrorCode(error) {
  if (error instanceof HistoryImportArgumentError) return error.code;
  if (error instanceof HistoryShadowSourceError) return error.code;
  if (error instanceof CoreImportArgumentError) return error.code;
  if (error instanceof CoreShadowSourceError) return error.code;
  if (error instanceof SyntaxError) return "invalid_json_export";
  if (error?.code === "ENOENT") return "migration_data_unavailable";
  return "history_import_failed";
}
