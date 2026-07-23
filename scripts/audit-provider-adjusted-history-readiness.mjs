import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { evaluateProviderAdjustedHistoryReadiness } from "../src/lib/market-data/provider-adjusted-history-readiness.ts";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [catalog] = await sql.query(`
    select
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'asset_price_snapshots'
          and indexname = 'asset_price_snapshots_instrument_date_unique'
      ) as exact_instrument_date_unique,
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'asset_price_snapshots'
          and indexname = 'asset_price_snapshots_ticker_date_unique'
      ) as legacy_ticker_date_unique,
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'asset_price_snapshots'
          and column_name in (
            'adjusted_close_basis',
            'adjusted_close_provider',
            'adjusted_close_source',
            'adjusted_close_fetched_at',
            'provider_symbol',
            'provider_exchange',
            'fetched_at'
          )
      ) as provenance_column_count
  `);
  const [fx] = await sql.query(`
    with dates as (
      select
        date,
        count(*)::int as row_count,
        count(distinct usdkrw)::int as value_count
      from fx_rates
      group by date
    )
    select
      count(*) filter (where row_count > 1)::int as duplicate_dates,
      count(*) filter (where value_count > 1)::int as conflicting_value_dates
    from dates
  `);

  const schema = {
    provenanceColumnsReady:
      Number(catalog.provenance_column_count ?? 0) === 7,
    exactInstrumentDateUnique:
      catalog.exact_instrument_date_unique === true,
    legacyTickerDateUnique: catalog.legacy_ticker_date_unique === true,
  };
  const fxCoverage =
    Number(fx.duplicate_dates ?? 0) === 0 &&
    Number(fx.conflicting_value_dates ?? 0) === 0
      ? "complete"
      : "incomplete";
  const candidates = [
    evaluateProviderAdjustedHistoryReadiness({
      provider: "kis_domestic_history_candidate",
      market: "korea",
      currency: "KRW",
      schema,
      dataUsageEntitlement: "unproven",
      instrumentBinding: "unproven",
      historicalPagination: "unproven",
      priceBasis: "unverified",
      corporateActionParity: "unproven",
      correctionPolicy: "unproven",
      duplicatePolicy: "unproven",
      fxCoverage: "not_applicable",
    }),
    evaluateProviderAdjustedHistoryReadiness({
      provider: "kis_overseas_history_candidate",
      market: "us",
      currency: "USD",
      schema,
      dataUsageEntitlement: "unproven",
      instrumentBinding: "unproven",
      historicalPagination: "unproven",
      priceBasis: "unverified",
      corporateActionParity: "unproven",
      correctionPolicy: "unproven",
      duplicatePolicy: "unproven",
      fxCoverage,
    }),
  ];

  console.log(
    JSON.stringify(
      {
        audit: "provider_adjusted_history_readiness_v1",
        readOnly: true,
        providerCalls: false,
        databaseWrites: false,
        generatedAt: new Date().toISOString(),
        catalog: {
          ...schema,
          provenanceColumnCount: Number(
            catalog.provenance_column_count ?? 0,
          ),
        },
        fx: {
          duplicateDates: Number(fx.duplicate_dates ?? 0),
          conflictingValueDates: Number(fx.conflicting_value_dates ?? 0),
          coverageStatus: fxCoverage,
        },
        candidates,
        nextBoundary:
          "No historical provider write is admitted until every candidate check passes.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
