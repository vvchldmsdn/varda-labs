import "server-only";
import { sqlClient } from "@/db/client";
import type { fxRates, livePriceQuotes } from "@/db/schema";
import type { FxRateCandidate } from "@/lib/market-data/fx-refresh";
import { fxObservationWrite } from "@/lib/market-data/fx-observation-write";

export type SnapshotCutoffQuote = typeof livePriceQuotes.$inferSelect & {
  observedAt: Date | null; timestampBasis: "collection" | "provider";
};
export type SnapshotCutoffFx = typeof fxRates.$inferSelect & {
  providerObservedAt: Date | null; timestampBasis: "collection" | "provider";
  providerRateKind: string | null;
};

/** Service-only shared evidence. No provider calls, tenant data or cache fallback.
 * Collection-derived adapter timestamps never claim an exchange observation. */
export async function readSnapshotCutoffObservations(snapshotDate: string): Promise<{ quotes: SnapshotCutoffQuote[]; fxRows: SnapshotCutoffFx[] }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(`${snapshotDate}T00:00:00Z`)) || new Date(`${snapshotDate}T00:00:00Z`).toISOString().slice(0, 10) !== snapshotDate) throw new Error("invalid_snapshot_date");
  const [prices, rates] = await Promise.all([
    sqlClient.query(`select id,ticker,market,currency,provider,source,quote_type,price,observed_at,fetched_at,stored_at,timestamp_basis
      from snapshot_cutoff_price_observations where snapshot_date=$1::date order by fetched_at desc,id`, [snapshotDate]),
    sqlClient.query(`select id,source,rate_date::text,usd_krw,observed_at,rate_kind,fetched_at,stored_at,timestamp_basis
      from snapshot_cutoff_fx_observations where snapshot_date=$1::date order by fetched_at desc,id`, [snapshotDate]),
  ]);
  return {
    quotes: prices.map(row => ({
      id: String(row.id), ticker: String(row.ticker), market: String(row.market), currency: String(row.currency),
      provider: String(row.provider), source: String(row.source), quoteType: String(row.quote_type), status: "ok", error: null,
      price: String(row.price), observedAt: dateOrNull(row.observed_at), fetchedAt: date(row.fetched_at),
      priceAsOf: dateOrNull(row.observed_at) ?? date(row.fetched_at),
      createdAt: date(row.stored_at), updatedAt: date(row.stored_at), timestampBasis: basis(row.timestamp_basis),
    })),
    fxRows: rates.map(row => ({
      id: String(row.id), legacyBase44Id: null, rateDate: String(row.rate_date), usdKrw: String(row.usd_krw),
      source: String(row.source), status: "ok", isSample: false,
      // Existing common spot admission consumes a valuation reference timestamp.
      // The original provider timestamp/kind remain explicit and nullable.
      observedAt: dateOrNull(row.observed_at) ?? date(row.fetched_at), rateKind: row.rate_kind == null ? "spot" : String(row.rate_kind),
      providerObservedAt: dateOrNull(row.observed_at), providerRateKind: row.rate_kind == null ? null : String(row.rate_kind),
      fetchedAt: date(row.fetched_at), timestampBasis: basis(row.timestamp_basis),
      base44CreatedAt: null, base44UpdatedAt: null, createdAt: date(row.stored_at), updatedAt: date(row.stored_at),
    })),
  };
}

/** An unchanged daily FX cache value is still a new receipt, never a new tick. */
export async function preserveUnchangedCutoffFx(candidate: FxRateCandidate) {
  const observation = fxObservationWrite(candidate);
  await sqlClient.query("select record_snapshot_cutoff_fx($1,$2::date,$3::numeric,$4::timestamptz,$5,$6::timestamptz)", [
    candidate.source, candidate.rateDate, candidate.usdKrw, observation.observedAt?.toISOString() ?? null,
    observation.rateKind, candidate.fetchedAt,
  ]);
}
function date(value: unknown) { return value instanceof Date ? new Date(value.getTime()) : new Date(String(value)); }
function dateOrNull(value: unknown) { return value == null ? null : date(value); }
function basis(value: unknown): "collection" | "provider" { return value === "provider" ? "provider" : "collection"; }
