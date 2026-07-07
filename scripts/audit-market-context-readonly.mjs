import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const SAMPLE_LIMIT = 10;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [benchmarkSnapshots, marketRegimeDaily, globalMarketFactors] =
    await Promise.all([
      getBenchmarkSnapshotAudit(),
      getMarketRegimeAudit(),
      getGlobalMarketFactorAudit(),
    ]);

  const result = {
    audit: "market_context_readonly",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    benchmarkSnapshots,
    marketRegimeDaily,
    globalMarketFactors,
    displayPlan: {
      routeCandidate: "/market",
      routeCandidateReason:
        "Keep market context separate from the portfolio dashboard until the display rules are proven.",
      benchmarkDefaultCandidates: ["069500", "VOO"],
      marketRegimeSelectOne:
        "For a given account/date, prefer the row with latest base44_updated_at, then updated_at, then created_at, then legacy_base44_id for deterministic read-only display.",
      globalFactorGrouping:
        "Group by factor_family, then show the latest row per factor_key with value, change_pct, percentile_1y, and volatility metrics.",
    },
  };

  console.log(JSON.stringify(result, null, 2));
}

async function getBenchmarkSnapshotAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      min(date)::text as min_date,
      max(date)::text as max_date,
      count(distinct benchmark_ticker)::int as benchmark_tickers,
      count(distinct currency)::int as currencies,
      count(distinct source)::int as sources,
      count(*) filter (where fx_rate is null)::int as null_fx_rate_rows,
      count(*) filter (where is_sample)::int as sample_rows
    from benchmark_snapshots
  `);

  const tickerDistribution = await sql.query(`
    select
      benchmark_ticker,
      max(benchmark_name) as benchmark_name,
      max(currency) as currency,
      count(*)::int as rows,
      min(date)::text as min_date,
      max(date)::text as max_date
    from benchmark_snapshots
    group by benchmark_ticker
    order by rows desc, benchmark_ticker asc
    limit ${SAMPLE_LIMIT}
  `);

  const currencyDistribution = await distribution(
    "benchmark_snapshots",
    "currency",
  );
  const sourceDistribution = await distribution("benchmark_snapshots", "source");

  const duplicateTickerDateGroups = await sql.query(`
    select benchmark_ticker, date::text as benchmark_date, count(*)::int as rows
    from benchmark_snapshots
    group by benchmark_ticker, date
    having count(*) > 1
    order by benchmark_date desc, rows desc, benchmark_ticker asc
    limit ${SAMPLE_LIMIT}
  `);

  const latestDefaultCandidates = await sql.query(`
    select *
    from (
      select
        benchmark_ticker,
        benchmark_name,
        date::text as benchmark_date,
        currency,
        close_price,
        normalized_index_value,
        fx_rate,
        source,
        row_number() over (
          partition by benchmark_ticker
          order by date desc, base44_updated_at desc nulls last, updated_at desc, legacy_base44_id desc nulls last
        ) as row_rank
      from benchmark_snapshots
      where benchmark_ticker in ('069500', 'VOO')
    ) ranked
    where row_rank = 1
    order by benchmark_ticker asc
  `);

  return {
    summary: normalizeSummary(summary),
    tickerDistribution,
    currencyDistribution,
    sourceDistribution,
    duplicateTickerDateGroups,
    latestDefaultCandidates,
  };
}

async function getMarketRegimeAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      min(date)::text as min_date,
      max(date)::text as max_date,
      count(distinct date)::int as dates,
      count(distinct account)::int as accounts,
      count(distinct label)::int as labels,
      count(*) filter (where account_id is null)::int as null_account_id_rows,
      count(*) filter (where description is null or trim(description) = '')::int as blank_description_rows,
      count(*) filter (where macro_stress_score is null)::int as null_macro_stress_score_rows,
      count(*) filter (where regime_score is null)::int as null_regime_score_rows,
      count(*) filter (where news_sentiment_score is null)::int as null_news_sentiment_score_rows,
      count(*) filter (where avg_correlation is null)::int as null_avg_correlation_rows,
      count(*) filter (where enb is null)::int as null_enb_rows,
      count(*) filter (where portfolio_volatility is null)::int as null_portfolio_volatility_rows,
      count(*) filter (where drivers_json is null)::int as null_drivers_json_rows,
      count(*) filter (where is_sample)::int as sample_rows
    from market_regime_daily
  `);

  const accountDistribution = await distribution(
    "market_regime_daily",
    "account",
  );
  const labelDistribution = await distribution("market_regime_daily", "label");

  const duplicateDateAccountGroups = await sql.query(`
    select date::text as regime_date, account, count(*)::int as rows
    from market_regime_daily
    group by date, account
    having count(*) > 1
    order by regime_date desc, rows desc, account asc
    limit ${SAMPLE_LIMIT}
  `);

  const duplicateDateAccountSamples = await sql.query(`
    select
      date::text as regime_date,
      account,
      label,
      regime_score,
      macro_stress_score,
      base44_updated_at,
      updated_at,
      legacy_base44_id
    from market_regime_daily
    where (date, account) in (
      select date, account
      from market_regime_daily
      group by date, account
      having count(*) > 1
    )
    order by date desc, account asc, base44_updated_at desc nulls last, updated_at desc, legacy_base44_id desc nulls last
    limit ${SAMPLE_LIMIT * 2}
  `);

  const latestByAccount = await sql.query(`
    select *
    from (
      select
        date::text as regime_date,
        account,
        label,
        regime_score,
        macro_stress_score,
        news_sentiment_score,
        avg_correlation,
        enb,
        portfolio_volatility,
        stress_badge_count,
        row_number() over (
          partition by account
          order by date desc, base44_updated_at desc nulls last, updated_at desc, created_at desc, legacy_base44_id desc nulls last
        ) as row_rank
      from market_regime_daily
    ) ranked
    where row_rank = 1
    order by account asc
  `);

  const driverKeySample = await sql.query(`
    select
      key,
      jsonb_typeof(driver.value) as value_type,
      count(*)::int as rows
    from market_regime_daily,
      lateral jsonb_each(drivers_json) as driver(key, value)
    where jsonb_typeof(drivers_json) = 'object'
    group by key, jsonb_typeof(driver.value)
    order by rows desc, key asc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    summary: normalizeSummary(summary),
    accountDistribution,
    labelDistribution,
    duplicateDateAccountGroups,
    duplicateDateAccountSamples,
    latestByAccount,
    driverKeySample,
  };
}

async function getGlobalMarketFactorAudit() {
  const [summary] = await sql.query(`
    select
      count(*)::int as total,
      count(*) filter (where legacy_base44_id is not null)::int as legacy_id_rows,
      min(date)::text as min_date,
      max(date)::text as max_date,
      count(distinct factor_key)::int as factor_keys,
      count(distinct factor_family)::int as factor_families,
      count(distinct source)::int as sources,
      count(distinct frequency)::int as frequencies,
      count(distinct benchmark_key)::int as benchmark_keys,
      count(distinct source_series_id)::int as source_series_ids,
      count(*) filter (where benchmark_key is null)::int as null_benchmark_key_rows,
      count(*) filter (where description is null or trim(description) = '')::int as blank_description_rows,
      count(*) filter (where change_pct is null)::int as null_change_pct_rows,
      count(*) filter (where change_1m_pct is null)::int as null_change_1m_pct_rows,
      count(*) filter (where change_3m_pct is null)::int as null_change_3m_pct_rows,
      count(*) filter (where change_6m_pct is null)::int as null_change_6m_pct_rows,
      count(*) filter (where carry_spread_value is null)::int as null_carry_spread_value_rows,
      count(*) filter (where is_preliminary)::int as preliminary_rows,
      count(*) filter (where is_sample)::int as sample_rows
    from global_market_factors
  `);

  const familyDistribution = await distribution(
    "global_market_factors",
    "factor_family",
  );
  const sourceDistribution = await distribution("global_market_factors", "source");
  const frequencyDistribution = await distribution(
    "global_market_factors",
    "frequency",
  );
  const benchmarkKeyDistribution = await distribution(
    "global_market_factors",
    "benchmark_key",
  );
  const regionDistribution = await distribution("global_market_factors", "region");

  const duplicateFactorDateGroups = await sql.query(`
    select factor_key, date::text as factor_date, count(*)::int as rows
    from global_market_factors
    group by factor_key, date
    having count(*) > 1
    order by factor_date desc, rows desc, factor_key asc
    limit ${SAMPLE_LIMIT}
  `);

  const latestByFamily = await sql.query(`
    select *
    from (
      select
        factor_family,
        factor_key,
        factor_name,
        date::text as factor_date,
        value,
        change_pct,
        percentile_1y,
        volatility_20d_pct,
        volatility_60d_pct,
        source,
        frequency,
        row_number() over (
          partition by factor_family
          order by date desc, factor_key asc, base44_updated_at desc nulls last, updated_at desc
        ) as row_rank
      from global_market_factors
    ) ranked
    where row_rank <= 3
    order by factor_family asc, row_rank asc
  `);

  const latestByFactorSample = await sql.query(`
    select *
    from (
      select
        factor_key,
        factor_family,
        factor_name,
        date::text as factor_date,
        value,
        change_pct,
        change_1m_pct,
        change_3m_pct,
        percentile_1y,
        volatility_20d_pct,
        source,
        frequency,
        row_number() over (
          partition by factor_key
          order by date desc, base44_updated_at desc nulls last, updated_at desc, legacy_base44_id desc nulls last
        ) as row_rank
      from global_market_factors
    ) ranked
    where row_rank = 1
    order by factor_family asc, factor_key asc
    limit ${SAMPLE_LIMIT}
  `);

  const derivedMetricKeySample = await sql.query(`
    select
      key,
      jsonb_typeof(metric.value) as value_type,
      count(*)::int as rows
    from global_market_factors,
      lateral jsonb_each(derived_metrics_json) as metric(key, value)
    where jsonb_typeof(derived_metrics_json) = 'object'
    group by key, jsonb_typeof(metric.value)
    order by rows desc, key asc
    limit ${SAMPLE_LIMIT}
  `);

  return {
    summary: normalizeSummary(summary),
    familyDistribution,
    sourceDistribution,
    frequencyDistribution,
    benchmarkKeyDistribution,
    regionDistribution,
    duplicateFactorDateGroups,
    latestByFamily,
    latestByFactorSample,
    derivedMetricKeySample,
  };
}

async function distribution(tableName, columnName) {
  return sql.query(`
    select coalesce(${columnName}::text, '(null)') as value, count(*)::int as rows
    from ${tableName}
    group by coalesce(${columnName}::text, '(null)')
    order by rows desc, value asc
    limit ${SAMPLE_LIMIT}
  `);
}

function normalizeSummary(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
