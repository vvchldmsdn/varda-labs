export type OnboardingInstrument = Readonly<{
  id: string;
  name: string;
  ticker: string;
  market: "korea" | "us";
  currency: "KRW" | "USD";
  assetType: "etf" | "stock";
  source: "etf_master" | "etf_constituent";
}>;

export type OnboardingInstrumentSearchResult = Readonly<{
  status: "ready" | "invalid" | "unauthorized" | "unavailable";
  instruments: readonly OnboardingInstrument[];
}>;

export const ONBOARDING_INSTRUMENT_SEARCH_LIMIT = 12;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOnboardingInstrumentSearch(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const query = value.trim();
  return query.length > 0 ? query : null;
}

export function parseOnboardingInstrumentId(value: string) {
  const parts = value.split(":");
  const [kind, id] = parts;
  return parts.length === 2 && (kind === "etf" || kind === "stock") && id && UUID.test(id)
    ? { kind, id: id.toLowerCase() } as const : null;
}

/** Search terms are literal text, never caller-controlled SQL wildcards. */
export function instrumentSearchLikePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}

export function canonicalOnboardingInstrument(row: {
  id: string; name: string; ticker: string | null; market: string | null; currency: string | null;
}, assetType: "etf" | "stock"): OnboardingInstrument | null {
  const marketText = row.market?.trim().toLowerCase();
  const market = ["korea", "kr", "krx"].includes(marketText ?? "") ? "korea"
    : ["us", "usa", "united states"].includes(marketText ?? "") ? "us" : null;
  const currency = row.currency?.trim().toUpperCase();
  const ticker = row.ticker?.trim().toUpperCase();
  const name = row.name.trim();
  if (!UUID.test(row.id) || !market || currency !== (market === "korea" ? "KRW" : "USD") || !name || name.length > 255 || !ticker) return null;
  // Exchange-local symbols only: do not guess an exchange from a country or an ISIN.
  if (market === "korea" ? !/^[0-9A-Z]{6}$/.test(ticker) : !/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) return null;
  return Object.freeze({ id: `${assetType}:${row.id.toLowerCase()}`, name, ticker, market, currency: currency as "KRW" | "USD", assetType, source: assetType === "etf" ? "etf_master" : "etf_constituent" });
}

export function rankOnboardingInstruments(rows: readonly OnboardingInstrument[], query: string) {
  const needle = query.toLocaleLowerCase("en-US");
  const score = (row: OnboardingInstrument) => row.ticker.toLowerCase() === needle ? 0
    : row.name.toLocaleLowerCase("en-US") === needle ? 1
    : row.ticker.toLowerCase().startsWith(needle) ? 2 : 3;
  const sorted = [...rows].sort((left, right) => score(left) - score(right) || left.ticker.localeCompare(right.ticker) || left.name.localeCompare(right.name));
  const seen = new Set<string>();
  return sorted.filter(row => {
    const key = `${row.market}:${row.currency}:${row.ticker}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, ONBOARDING_INSTRUMENT_SEARCH_LIMIT);
}
