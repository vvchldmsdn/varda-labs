import { createHash } from "node:crypto";
import { normalizeTenantLivePriceTarget } from "./tenant-live-price-sync-policy";

type Target = { market: string; ticker: string; currency: string };
type Quote = Target & { provider: string; status: string; price: string | number; fetchedAt: Date | string | null };
type Fx = { usdKrw: string | number; status: string | null; fetchedAt: Date | string | null };

/** Opaque receipt for the owned instruments' current shared evidence. Counts alone
 * miss price/FX changes while another instrument remains queued. No owner IDs,
 * credentials or holdings are returned, and observation timestamps stay intact. */
export function livePriceReadVersion(targets: readonly Target[], quotes: readonly Quote[], fx: Fx | null) {
  const key = (row: Target) => {
    const normalized = normalizeTenantLivePriceTarget(row);
    return normalized ? JSON.stringify([normalized.market, normalized.ticker, normalized.currency]) : null;
  };
  const selected = new Set(targets.map(key).filter(value => value !== null));
  const time = (value: Date | string | null) => value instanceof Date ? value.toISOString() : value;
  const evidence = quotes.filter(row => { const normalizedKey = key(row); return normalizedKey !== null && selected.has(normalizedKey); })
    .map(row => JSON.stringify([key(row), row.provider, row.status, String(row.price), time(row.fetchedAt)]))
    .sort();
  const fxEvidence = targets.some(row => normalizeTenantLivePriceTarget(row)?.currency === "usd") && fx
    ? [String(fx.usdKrw), fx.status, time(fx.fetchedAt)] : null;
  return createHash("sha256").update(JSON.stringify([[...selected].sort(), evidence, fxEvidence])).digest("hex");
}
