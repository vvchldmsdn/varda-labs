import "server-only";
import { twelveDataConfigAllows, type TwelveDataServiceConfig } from "./twelve-data-config";
import { resolveTwelveDataListing } from "./providers/twelve-data-contract";
import type { PriceLookupTarget } from "./providers/types";

export type TwelveDataTargetResolution = { status: "resolved"; target: PriceLookupTarget } | { status: "disabled" | "unsupported" | "ambiguous" };

/** The caller supplies an owned instrument tuple, never an invented provider key. */
export function resolveTwelveDataTarget(input: { ticker?: string | null; market?: string; currency?: string }, config?: TwelveDataServiceConfig): TwelveDataTargetResolution {
  if (!config || !(["us_quote", "us_daily_raw"] as const).some(dataset => twelveDataConfigAllows(config, dataset))) return { status: "disabled" };
  const ticker = input.ticker?.trim().toUpperCase(), market = input.market?.trim().toLowerCase(), currency = input.currency?.trim().toUpperCase();
  if (market !== "us" || currency !== "USD" || !ticker || !/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(ticker)) return { status: "unsupported" };
  const candidates = config.provider.listings.filter(row => row.ticker === ticker && row.currency === currency);
  if (candidates.length !== 1) return { status: candidates.length ? "ambiguous" : "unsupported" };
  const target: PriceLookupTarget = { key: candidates[0].instrumentKey, ticker, market, currency, authority: "explicit_instrument", accounts: [], assetIds: [], assetNames: [] };
  try { resolveTwelveDataListing(target, config.provider.listings); return { status: "resolved", target }; }
  catch { return { status: "unsupported" }; }
}

/** Provider daily bars must end before the current New York calendar day. */
export function getTwelveDataCompletedHistoryWindow(asOf: string, calendarDays = 365) {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at) || at > Date.now() || !Number.isSafeInteger(calendarDays) || calendarDays < 1 || calendarDays > 366) throw new Error("twelve_data_history_window_invalid");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const end = Date.parse(`${today}T00:00:00Z`) - 86_400_000;
  return { startDate: new Date(end - (calendarDays - 1) * 86_400_000).toISOString().slice(0, 10), endDate: new Date(end).toISOString().slice(0, 10) };
}
