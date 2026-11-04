import { KIS_US_EXCHANGES, type KisUsExchange } from "./kis-fx";

const MAXIMUM_HINTS = 512;
const MAXIMUM_AGE_MS = 24 * 60 * 60_000;

/** A bounded warm-instance hint, never price evidence. Real and mock endpoints
 * are separate. Every use still fetches and validates a new provider response. */
export class KisExchangeHints {
  private hints = new Map<string, { exchange: KisUsExchange; checkedAt: number }>();

  order(endpoint: string, ticker: string, preferred?: KisUsExchange | null, now = Date.now()): KisUsExchange[] {
    const key = `${endpoint}:${ticker.trim().toUpperCase()}`;
    const hint = this.hints.get(key);
    const fresh = hint && now >= hint.checkedAt && now - hint.checkedAt < MAXIMUM_AGE_MS;
    if (!fresh) this.hints.delete(key);
    const first = preferred ?? (fresh ? hint.exchange : undefined);
    return first ? [first, ...KIS_US_EXCHANGES.filter(exchange => exchange !== first)] : [...KIS_US_EXCHANGES];
  }

  remember(endpoint: string, ticker: string, exchange: KisUsExchange, now = Date.now()) {
    const key = `${endpoint}:${ticker.trim().toUpperCase()}`;
    this.hints.delete(key);
    if (this.hints.size >= MAXIMUM_HINTS) this.hints.delete(this.hints.keys().next().value!);
    this.hints.set(key, { exchange, checkedAt: now });
  }
}
