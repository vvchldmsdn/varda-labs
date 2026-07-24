import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { buildProviderInstrumentEvidenceMatrix } from "../src/lib/market-data/provider-instrument-evidence-matrix.ts";
import { planSimulationPeriodPreflightScan } from "../src/lib/simulation-period-preflight-plan.ts";
import { resolveSimulationPeriodRequest } from "../src/lib/simulation-period-request-resolver.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
const REQUEST = Object.freeze({
  reviewPurpose: "research_cross_market",
  candidates: Object.freeze([
    Object.freeze({ market: "korea", currency: "KRW", ticker: "069500" }),
    Object.freeze({ market: "us", currency: "USD", ticker: "QQQ" }),
  ]),
  endServiceDate: "2026-07-09",
  returnStepCount: 90,
});

async function main() {
  const plan = planSimulationPeriodPreflightScan(REQUEST);
  if (plan.status !== "queryable" || !plan.queryRange) {
    throw new Error("Fixed research preflight request is not queryable");
  }

  const [catalogRows, priceRows, fxRows] = await Promise.all([
    sql.query(`
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
    `),
    sql`
      select
        lower(trim(market)) as market,
        upper(trim(currency)) as currency,
        upper(trim(ticker)) as ticker,
        to_char(date, 'YYYY-MM-DD') as price_date,
        adjusted_close_price
      from asset_price_snapshots
      where is_sample = false
        and date >= ${plan.queryRange.sourceDateFrom}
        and date <= ${plan.queryRange.sourceDateTo}
        and (
          (
            lower(trim(market)) = 'korea'
            and upper(trim(currency)) = 'KRW'
            and upper(trim(ticker)) = '069500'
          )
          or (
            lower(trim(market)) = 'us'
            and upper(trim(currency)) = 'USD'
            and upper(trim(ticker)) = 'QQQ'
          )
        )
      order by date, market, currency, ticker
    `,
    sql`
      select
        to_char(date, 'YYYY-MM-DD') as date,
        usdkrw,
        lower(trim(status)) as status,
        lower(trim(source)) as source
      from fx_rates
      where is_sample = false
        and date >= ${plan.queryRange.sourceDateFrom}
        and date <= ${plan.queryRange.sourceDateTo}
      order by date, source
    `,
  ]);
  const catalog = catalogRows[0] ?? {};
  const schema = {
    provenanceColumnsReady:
      Number(catalog.provenance_column_count ?? 0) === 7,
    exactInstrumentDateUnique:
      catalog.exact_instrument_date_unique === true,
    legacyTickerDateUnique: catalog.legacy_ticker_date_unique === true,
  };
  const normalizedPriceRows = priceRows.map((row) => ({
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    priceDate: row.price_date,
    adjustedClosePrice: row.adjusted_close_price,
  }));
  const normalizedFxRows = fxRows.map((row) => ({
    rateDate: row.date,
    usdKrw: row.usdkrw,
    status: row.status,
    source: row.source,
  }));
  const axis = resolveSimulationPeriodRequest({
    candidates: REQUEST.candidates,
    endServiceDate: REQUEST.endServiceDate,
    returnStepCount: REQUEST.returnStepCount,
    priceRows: normalizedPriceRows,
    fxRows: normalizedFxRows,
  });
  const requestedRange = Object.freeze({
    from: plan.queryRange.sourceDateFrom,
    to: plan.queryRange.sourceDateTo,
  });
  const commonEvidence = {
    entitlements: {
      fetch: "unproven",
      store: "unproven",
      display: "unproven",
      multiUser: "unproven",
    },
    historicalPagination: "unproven",
    corporateActionParity: "unproven",
    correctionPolicy: "unproven",
    duplicatePolicy: "unproven",
    requestedSourceDateRange: requestedRange,
    requiredServiceDates: axis.resolvedServiceDates,
    maxFxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays,
    fxRows: normalizedFxRows,
  };
  const matrix = buildProviderInstrumentEvidenceMatrix({
    schema,
    candidates: [
      {
        instrument: REQUEST.candidates[0],
        provider: {
          id: "kis",
          symbol: "069500",
          exchange: "KRX",
          bindingStatus: "unproven",
          effectiveFrom: requestedRange.from,
          effectiveTo: requestedRange.to,
        },
        endpoint: {
          id: "FHKST03010100.output2",
          priceField: "stck_clpr",
          priceBasis: "unverified",
        },
        ...commonEvidence,
      },
      {
        instrument: REQUEST.candidates[1],
        provider: {
          id: "kis",
          symbol: "QQQ",
          exchange: "NAS",
          bindingStatus: "unproven",
          effectiveFrom: requestedRange.from,
          effectiveTo: requestedRange.to,
        },
        endpoint: {
          id: "HHDFS76240000.output2",
          priceField: "clos",
          priceBasis: "unverified",
        },
        ...commonEvidence,
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        audit: "provider_instrument_evidence_matrix_v1",
        readOnly: true,
        providerCalls: false,
        databaseWrites: false,
        generatedAt: new Date().toISOString(),
        request: {
          reviewPurpose: REQUEST.reviewPurpose,
          endServiceDate: REQUEST.endServiceDate,
          returnStepCount: REQUEST.returnStepCount,
          candidates: REQUEST.candidates,
          requestedSourceDateRange: requestedRange,
        },
        axis: {
          status: axis.status,
          axisStatus: axis.axisStatus,
          resolvedServiceDateCount: axis.resolvedServiceDates.length,
          firstResolvedServiceDate: axis.resolvedServiceDates[0] ?? null,
          lastResolvedServiceDate:
            axis.resolvedServiceDates.at(-1) ?? null,
          issues: axis.issues.map((issue) => ({
            severity: issue.severity,
            reason: issue.reason,
            instrumentKey: issue.instrumentKey,
            dateCount: issue.dates.length,
          })),
        },
        databaseEvidence: {
          schema: {
            ...schema,
            provenanceColumnCount: Number(
              catalog.provenance_column_count ?? 0,
            ),
          },
          storedPriceRowCount: normalizedPriceRows.length,
          storedFxRowCount: normalizedFxRows.length,
        },
        matrix,
        nextBoundary:
          "No provider call, shared-cache write, or backfill is admitted by this SELECT-only audit.",
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
