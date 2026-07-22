import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [summary] = await sql.query(`
    with keyed as (
      select
        market,
        currency,
        ticker,
        date::text as price_date,
        count(*)::int as row_count,
        count(distinct coalesce(source, ''))::int as source_variants,
        count(distinct close_price::text)::int as close_price_variants,
        count(distinct coalesce(fx_rate::text, ''))::int as fx_rate_variants,
        count(distinct coalesce(close_price_krw::text, ''))::int as close_price_krw_variants
      from asset_price_snapshots
      group by market, currency, ticker, date
    )
    select
      (select count(*)::int from asset_price_snapshots) as total_rows,
      count(*)::int as instrument_date_groups,
      count(*) filter (where row_count > 1)::int as duplicate_groups,
      coalesce(sum(row_count) filter (where row_count > 1), 0)::int as duplicate_rows,
      coalesce(sum(row_count - 1) filter (where row_count > 1), 0)::int as excess_rows,
      count(*) filter (
        where row_count > 1
          and (
            close_price_variants > 1
            or fx_rate_variants > 1
            or close_price_krw_variants > 1
          )
      )::int as value_conflict_groups,
      count(*) filter (where row_count > 1 and source_variants > 1)::int as source_conflict_groups
    from keyed
  `);
  const [indexSummary] = await sql.query(`
    select
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'asset_price_snapshots'
          and indexname = 'asset_price_snapshots_instrument_date_unique'
      ) as instrument_date_unique_index_present,
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'asset_price_snapshots'
          and indexname = 'asset_price_snapshots_ticker_date_unique'
      ) as legacy_ticker_date_unique_index_present
  `);

  const [legacyCollisionSummary] = await sql.query(`
    with ticker_dates as (
      select
        ticker,
        date,
        count(distinct market || '|' || currency)::int as identity_count
      from asset_price_snapshots
      group by ticker, date
    )
    select count(*) filter (where identity_count > 1)::int as collision_groups
    from ticker_dates
  `);

  const sourceDistribution = await sql.query(`
    with duplicate_keys as (
      select market, currency, ticker, date
      from asset_price_snapshots
      group by market, currency, ticker, date
      having count(*) > 1
    )
    select
      coalesce(a.source, '(null)') as source,
      count(*)::int as rows,
      count(distinct a.market || '|' || a.currency || '|' || a.ticker || '|' || a.date::text)::int as groups
    from asset_price_snapshots a
    inner join duplicate_keys d
      on d.market = a.market
      and d.currency = a.currency
      and d.ticker = a.ticker
      and d.date = a.date
    group by coalesce(a.source, '(null)')
    order by rows desc, source asc
  `);

  const dateDistribution = await sql.query(`
    with duplicate_keys as (
      select market, currency, ticker, date
      from asset_price_snapshots
      group by market, currency, ticker, date
      having count(*) > 1
    )
    select
      a.date::text as price_date,
      count(*)::int as duplicate_rows,
      count(distinct a.market || '|' || a.currency || '|' || a.ticker)::int as instruments
    from asset_price_snapshots a
    inner join duplicate_keys d
      on d.market = a.market
      and d.currency = a.currency
      and d.ticker = a.ticker
      and d.date = a.date
    group by a.date
    order by duplicate_rows desc, a.date desc
    limit 30
  `);

  const samples = await sql.query(`
    select
      market,
      currency,
      ticker,
      date::text as price_date,
      count(*)::int as row_count,
      array_agg(distinct coalesce(source, '(null)') order by coalesce(source, '(null)')) as sources,
      count(distinct close_price::text)::int as close_price_variants,
      count(distinct coalesce(fx_rate::text, ''))::int as fx_rate_variants,
      count(distinct coalesce(close_price_krw::text, ''))::int as close_price_krw_variants,
      min(close_price)::text as min_close_price,
      max(close_price)::text as max_close_price,
      min(fx_rate)::text as min_fx_rate,
      max(fx_rate)::text as max_fx_rate,
      min(close_price_krw)::text as min_close_price_krw,
      max(close_price_krw)::text as max_close_price_krw
    from asset_price_snapshots
    group by market, currency, ticker, date
    having count(*) > 1
    order by row_count desc, date desc, market, currency, ticker
    limit 25
  `);

  const duplicateGroups = Number(summary.duplicate_groups ?? 0);
  const instrumentDateUniqueIndexPresent =
    indexSummary.instrument_date_unique_index_present === true;
  const legacyTickerDateUniqueIndexPresent =
    indexSummary.legacy_ticker_date_unique_index_present === true;
  const result = {
    table: "asset_price_snapshots",
    audit: "instrument_date_duplicates",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRows: Number(summary.total_rows ?? 0),
      instrumentDateGroups: Number(summary.instrument_date_groups ?? 0),
      duplicateGroups,
      duplicateRows: Number(summary.duplicate_rows ?? 0),
      excessRows: Number(summary.excess_rows ?? 0),
      valueConflictGroups: Number(summary.value_conflict_groups ?? 0),
      sourceConflictGroups: Number(summary.source_conflict_groups ?? 0),
      legacyTickerDateIdentityCollisionGroups: Number(
        legacyCollisionSummary.collision_groups ?? 0,
      ),
      instrumentDateUniqueIndexPresent,
      legacyTickerDateUniqueIndexPresent,
      uniqueIndexReady: duplicateGroups === 0,
    },
    sourceDistribution,
    topDuplicateDates: dateDistribution,
    sampleDuplicateGroups: samples,
    recommendation: buildRecommendation({
      duplicateGroups,
      instrumentDateUniqueIndexPresent,
      legacyTickerDateUniqueIndexPresent,
    }),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

function buildRecommendation({
  duplicateGroups,
  instrumentDateUniqueIndexPresent,
  legacyTickerDateUniqueIndexPresent,
}) {
  if (duplicateGroups > 0) {
    return "clean duplicates before relying on exact instrument/date uniqueness.";
  }
  if (instrumentDateUniqueIndexPresent && legacyTickerDateUniqueIndexPresent) {
    return "exact instrument/date uniqueness is ready; legacy ticker/date guard remains for expand/contract compatibility.";
  }
  if (instrumentDateUniqueIndexPresent) {
    return "exact instrument/date unique index is present and duplicate audit is clean.";
  }
  return "exact instrument/date unique index can be added after normal migration review.";
}
