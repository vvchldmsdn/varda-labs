import type { TenantLivePriceTarget } from "./tenant-live-price-sync-policy";

/** A tab-scoped continuation hint, never an authorization credential. */
export type QuoteRefreshOperation = {
  ownerBinding: string;
  startedAt: string;
  targets: TenantLivePriceTarget[];
  fxTicker: string | null;
};
export const REFRESH_OPERATION_KEY = "cairn.quote-refresh.v1";
export const REFRESH_OPERATION_MAX_AGE = 30 * 60_000;
export const refreshTargetKey = (target: TenantLivePriceTarget) =>
  JSON.stringify([target.market.toLowerCase(), target.currency.toUpperCase(), target.ticker.toUpperCase()]);

export function parseRefreshOperation(value: unknown, now = Date.now()): QuoteRefreshOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["ownerBinding", "startedAt", "targets", "fxTicker"].includes(key)) ||
    typeof row.ownerBinding !== "string" || !/^[a-f0-9]{64}$/.test(row.ownerBinding) ||
    typeof row.startedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.startedAt) ||
    !Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) > now + 60_000 || now - Date.parse(row.startedAt) > REFRESH_OPERATION_MAX_AGE ||
    !Array.isArray(row.targets) || row.targets.length > 40) return null;
  const targets: TenantLivePriceTarget[] = [];
  const seen = new Set<string>();
  for (const target of row.targets) {
    if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).some(key => !["ticker", "market", "currency"].includes(key)) ||
      typeof target.ticker !== "string" || !/^[A-Z0-9.^_/-]{1,32}$/.test(target.ticker) ||
      typeof target.market !== "string" || !/^[a-z0-9_-]{1,24}$/.test(target.market) ||
      typeof target.currency !== "string" || !/^[A-Z]{3}$/.test(target.currency)) return null;
    const key = refreshTargetKey(target);
    if (seen.has(key)) return null;
    seen.add(key); targets.push({ ticker: target.ticker, market: target.market, currency: target.currency });
  }
  if (row.fxTicker !== null && (typeof row.fxTicker !== "string" || !targets.some(target => target.market === "us" && target.currency === "USD" && target.ticker === row.fxTicker))) return null;
  return { ownerBinding: row.ownerBinding, startedAt: row.startedAt, targets, fxTicker: row.fxTicker as string | null };
}

export function readRefreshOperation(storage: Pick<Storage, "getItem" | "removeItem">, now = Date.now()) {
  try {
    const raw = storage.getItem(REFRESH_OPERATION_KEY);
    const operation = raw && raw.length <= 8192 ? parseRefreshOperation(JSON.parse(raw), now) : null;
    if (!operation) storage.removeItem(REFRESH_OPERATION_KEY);
    return operation;
  } catch { return null; }
}

export function retainRefreshOperation(storage: Pick<Storage, "setItem" | "removeItem">, operation: QuoteRefreshOperation | null) {
  try {
    if (operation) storage.setItem(REFRESH_OPERATION_KEY, JSON.stringify(operation));
    else storage.removeItem(REFRESH_OPERATION_KEY);
  } catch { /* A storage restriction must not interrupt the active refresh. */ }
}
