import { isPlanId, PLAN_TTL_MS } from "./investment-plan.ts";
import { Decimal, isCurrency, moneyMinor, type Currency } from "./money.ts";
import { convertMoney, type FxEvidence } from "./currency-valuation.ts";

export const QUICK_STORAGE_KEY = "varda.quick-portfolio.v1";
export const QUICK_VERSION = "amount_composition_v1";
export const QUICK_CURRENCY_VERSION = "amount_composition_currency_v2";
export const quickEngineVersion = (input: QuickInput) => input.version === 2 ? QUICK_CURRENCY_VERSION : QUICK_VERSION;
// Deliberately finite, versioned identity catalogue. No market data or guessed matches.
export const QUICK_INSTRUMENTS = [
  { id: "kr-069500", name: "KODEX 200", ticker: "069500", market: "KRX", currency: "KRW", assetClass: "주식 ETF" },
  { id: "kr-005930", name: "삼성전자", ticker: "005930", market: "KRX", currency: "KRW", assetClass: "개별 주식" },
  { id: "us-voo", name: "VOO", ticker: "VOO", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-qqq", name: "QQQ", ticker: "QQQ", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-schd", name: "SCHD", ticker: "SCHD", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-tlt", name: "TLT", ticker: "TLT", market: "US", currency: "USD", assetClass: "채권 ETF" },
  { id: "us-gld", name: "GLD", ticker: "GLD", market: "US", currency: "USD", assetClass: "금 ETF" },
  { id: "us-aapl-xnas", name: "AAPL", ticker: "AAPL", market: "US", currency: "USD", assetClass: "개별 주식", mic: "XNAS" },
  { id: "us-msft-xnas", name: "MSFT", ticker: "MSFT", market: "US", currency: "USD", assetClass: "개별 주식", mic: "XNAS" },
] as const;
export type QuickInput = {
  currency: Currency;
  rows: { name: string; value: number; instrumentId: string | null; inputCurrency?: Currency }[];
  version?: 2; asOf?: string; timeZone?: string; locale?: "ko" | "en"; source?: "manual"; fx?: FxEvidence[];
};
export function isTimeZone(value: unknown): value is string { try { if (typeof value !== "string" || value.length > 80) return false; new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }
export type QuickDraft = { version: 1; id: string; expiresAt: number; input: QuickInput };
export function validateQuickPortfolio(value: unknown): { ok: true; input: QuickInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "자산 이름과 금액을 확인해 주세요." };
  const input = value as QuickInput;
  const v2 = input.version === 2;
  if (!isCurrency(input.currency) || (!v2 && input.currency !== "KRW") || (input.version !== undefined && !v2)) return { ok: false, error: "KRW 또는 USD를 선택해 주세요." };
  if (v2 && (input.source !== "manual" || typeof input.asOf !== "string" || !/^\d{4}-\d\d-\d\dT/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf)) || Date.parse(input.asOf) > Date.now() + 60_000 || !isTimeZone(input.timeZone) || !["ko", "en"].includes(input.locale ?? ""))) return { ok: false, error: "입력 기준 시각과 표시 설정을 확인해 주세요." };
  if (input.fx !== undefined && (!v2 || !Array.isArray(input.fx) || input.fx.length > 1 || input.fx.some(row => {
    try { return row.base !== "USD" || row.quote !== "KRW" || row.kind !== "user_input" || row.source !== "manual" || row.observedAt !== input.asOf || row.fetchedAt !== input.asOf || Decimal.from(row.rate).compare(0) <= 0 || Decimal.from(row.rate).compare(1_000_000) > 0; } catch { return true; }
  }))) return { ok: false, error: "환산 기준을 확인해 주세요." };
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 12) return { ok: false, error: "자산을 1~12개 입력해 주세요." };
  const names = new Set<string>();
  for (const row of input.rows) {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 60) return { ok: false, error: "각 자산의 이름을 1~60자로 입력해 주세요." };
    const name = row.name.trim().normalize("NFKC").toLowerCase();
    if (names.has(name)) return { ok: false, error: "같은 자산은 금액을 합치거나 이름을 구분해 주세요." };
    names.add(name);
    const currency = v2 ? row.inputCurrency : "KRW";
    try {
      if (!isCurrency(currency) || typeof row.value !== "number" || row.value < 0 || moneyMinor(row.value, currency) > 1_000_000_000_000) throw new Error();
    } catch { return { ok: false, error: "금액과 소수 자릿수를 확인해 주세요. KRW는 정수, USD는 소수 둘째 자리까지입니다." }; }
    const instrument = QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId);
    if (row.instrumentId !== null && (!instrument || instrument.name !== row.name.trim())) return { ok: false, error: "선택한 종목과 이름이 일치하지 않습니다. 종목을 다시 선택해 주세요." };
  }
  if (input.rows.reduce((sum, row) => sum + row.value, 0) <= 0) return { ok: false, error: "최소 한 자산의 금액을 0보다 크게 입력해 주세요." };
  const normalized: QuickInput = { currency: input.currency, rows: input.rows.map(row => ({ name: row.name.trim(), value: row.value, instrumentId: row.instrumentId, ...(v2 ? { inputCurrency: row.inputCurrency } : {}) })) };
  if (v2) Object.assign(normalized, { version: 2, source: "manual", asOf: input.asOf, timeZone: input.timeZone, locale: input.locale, ...(input.fx?.length ? { fx: input.fx.map(row => ({ base: row.base, quote: row.quote, rate: row.rate, observedAt: row.observedAt, fetchedAt: row.fetchedAt, source: row.source, kind: row.kind })) } : {}) });
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > 3800) return { ok: false, error: "입력 내용을 줄여 주세요." };
  return { ok: true, input: normalized };
}
export function analyzeQuickPortfolio(input: QuickInput) {
  const valid = validateQuickPortfolio(input);
  if (!valid.ok) throw new Error("invalid_quick_portfolio");
  const projected = valid.input.rows.map(row => convertMoney(row.value, row.inputCurrency ?? "KRW", input.currency, input.asOf ?? "1970-01-01T00:00:00Z", input.fx ?? [], PLAN_TTL_MS));
  const complete = projected.every(row => row.ok);
  const totalExact = complete ? projected.reduce((sum, row) => row.ok ? sum.add(row.value) : sum, Decimal.from(0)) : null;
  const total = totalExact?.toNumber() ?? null;
  const rows = valid.input.rows.map((row, index) => ({ ...row, key: String(index), inputCurrency: row.inputCurrency ?? "KRW" as Currency,
    reportingValue: projected[index].ok ? projected[index].value.toNumber() : null,
    weightPct: totalExact && projected[index].ok ? projected[index].value.div(totalExact).mul(100).toNumber() : null,
    instrument: QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId) ?? null }));
  const group = (kind: "currency" | "assetClass") => {
    const sums = new Map<string, number>();
    if (total === null) return [];
    for (const row of rows) { const name = row.instrument?.[kind] ?? "미확인"; sums.set(name, (sums.get(name) ?? 0) + row.reportingValue!); }
    return [...sums].map(([name, value]) => ({ name, value, weightPct: value / total * 100 }));
  };
  const currencyTotals = (["KRW", "USD"] as const).map(currency => ({ currency, value: rows.filter(row => row.inputCurrency === currency).reduce((sum, row) => sum.add(row.value), Decimal.from(0)).toNumber() })).filter(row => rows.some(item => item.inputCurrency === row.currency));
  return { total, rows, complete, excluded: rows.filter(row => row.reportingValue === null).map(row => row.key), currencyTotals,
    largest: complete ? rows.reduce((a, b) => a.reportingValue! >= b.reportingValue! ? a : b) : null,
    currencies: group("currency"), assetClasses: group("assetClass") };
}
export function parseQuickDraft(raw: string | null, now = Date.now()): QuickDraft | null {
  try { const value = JSON.parse(raw ?? "null"); const parsed = validateQuickPortfolio(value?.input);
    return value?.version === 1 && isPlanId(value.id) && Number.isFinite(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + PLAN_TTL_MS && parsed.ok
      ? { version: 1, id: value.id, expiresAt: value.expiresAt, input: parsed.input } : null;
  } catch { return null; }
}
export function createQuickDraft(input: QuickInput, previous: QuickDraft | null = null): QuickDraft {
  const parsed = validateQuickPortfolio(input); if (!parsed.ok) throw new Error("invalid_quick_portfolio");
  if (previous && previous.expiresAt > Date.now() && JSON.stringify(previous.input) === JSON.stringify(parsed.input)) return previous;
  return { version: 1, id: crypto.randomUUID(), expiresAt: Date.now() + PLAN_TTL_MS, input: parsed.input };
}
