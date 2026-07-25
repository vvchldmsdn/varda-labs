import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  admitAdjustedHistoricalPriceRows,
  admitRawHistoricalPriceRows,
} from "../src/lib/market-data/asset-price-consumer-admission.ts";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const catalogRows = await sql.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = current_schema()
      and (
        (table_name = 'asset_price_snapshots' and column_name = 'is_sample')
        or (table_name = 'assets' and column_name = 'is_sample')
      )
  `);
  const hasPriceIsSample = catalogRows.some(
    (row) =>
      row.table_name === "asset_price_snapshots" &&
      row.column_name === "is_sample",
  );
  const hasAssetIsSample = catalogRows.some(
    (row) => row.table_name === "assets" && row.column_name === "is_sample",
  );
  const rows = await sql.query(`
    select
      lower(trim(market)) as market,
      upper(trim(currency)) as currency,
      upper(trim(ticker)) as ticker,
      date as "priceDate",
      close_price as "closePrice",
      adjusted_close_price as "adjustedClosePrice",
      adjusted_close_basis as "adjustedCloseBasis",
      adjusted_close_provider as "adjustedCloseProvider",
      adjusted_close_source as "adjustedCloseSource",
      adjusted_close_fetched_at as "adjustedCloseFetchedAt",
      provider_symbol as "providerSymbol",
      provider_exchange as "providerExchange",
      fetched_at as "fetchedAt",
      source,
      ${hasPriceIsSample ? 'is_sample' : 'false'} as "isSample"
    from asset_price_snapshots
    ${hasPriceIsSample ? "where is_sample = false" : ""}
    order by market, currency, ticker, date
  `);
  const currentHoldingInstruments = await sql.query(`
    select distinct
      lower(trim(market)) as market,
      upper(trim(currency)) as currency,
      upper(trim(ticker)) as ticker
    from assets
    where ${hasAssetIsSample ? "is_sample = false and" : ""}
      lower(trim(account)) in ('brokerage', 'isa', 'irp')
      and nullif(trim(ticker), '') is not null
      and coalesce(quantity, 0) > 0
  `);

  const adjustedAdmission = admitAdjustedHistoricalPriceRows(rows);
  const rawAdmission = admitRawHistoricalPriceRows(rows);
  const admittedIdentityKeys = new Set(
    adjustedAdmission.rows.map(instrumentKey).filter(Boolean),
  );
  const holdingIdentityKeys = new Set(
    currentHoldingInstruments.map(instrumentKey).filter(Boolean),
  );

  console.log(
    JSON.stringify(
      {
        audit: "asset_price_snapshot_consumer_admission_v2",
        readOnly: true,
        providerCalls: false,
        databaseWrites: false,
        generatedAt: new Date().toISOString(),
        catalog: {
          assetPriceSnapshotsIsSample: hasPriceIsSample,
          assetsIsSample: hasAssetIsSample,
        },
        rows: {
          total: rows.length,
          rawClose: rows.filter((row) => positive(row.closePrice)).length,
          adjustedClose: rows.filter((row) =>
            positive(row.adjustedClosePrice),
          ).length,
          legacyUnverifiedAdjusted: rows.filter(
            (row) =>
              positive(row.adjustedClosePrice) &&
              row.adjustedCloseBasis === "legacy_unverified",
          ).length,
          providerAdjustedBasis: rows.filter(
            (row) =>
              positive(row.adjustedClosePrice) &&
              row.adjustedCloseBasis === "provider_adjusted_close_v1",
          ).length,
          kisRaw: rows.filter(
            (row) =>
              typeof row.source === "string" &&
              row.source.toLowerCase().startsWith("kis_"),
          ).length,
          admittedHistoricalReturn:
            adjustedAdmission.summary.admittedRowCount,
          excludedHistoricalReturn:
            adjustedAdmission.summary.excludedRowCount,
          admittedRawPriceReturn: rawAdmission.summary.admittedRowCount,
          excludedRawPriceReturn: rawAdmission.summary.excludedRowCount,
        },
        instruments: {
          stored: new Set(rows.map(instrumentKey).filter(Boolean)).size,
          admittedHistoricalReturn:
            adjustedAdmission.summary.admittedInstrumentCount,
          admittedRawPriceReturn:
            rawAdmission.summary.admittedInstrumentCount,
          currentHoldings: holdingIdentityKeys.size,
          currentHoldingsWithAdmittedHistory: [...holdingIdentityKeys].filter(
            (key) => admittedIdentityKeys.has(key),
          ).length,
        },
        issues: {
          adjustedHistoricalReturn: adjustedAdmission.issues,
          rawHistoricalReturn: rawAdmission.issues,
        },
        nextBoundary:
          adjustedAdmission.summary.admittedRowCount > 0
            ? "Only admitted provider-adjusted rows may reach historical return consumers."
            : "Historical return consumers remain unavailable until admitted adjusted history exists.",
      },
      null,
      2,
    ),
  );
}

function instrumentKey(row) {
  const market = normalizeText(row.market)?.toLowerCase();
  const currency = normalizeText(row.currency)?.toUpperCase();
  const ticker = normalizeText(row.ticker)?.toUpperCase();
  return market && currency && ticker
    ? `${market}|${currency}|${ticker}`
    : null;
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizeText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
