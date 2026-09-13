import { isPlanId, PLAN_TTL_MS } from "./investment-plan.ts";

export const QUICK_STORAGE_KEY = "varda.quick-portfolio.v1";
export const QUICK_VERSION = "amount_composition_v1";
// Deliberately finite, versioned identity catalogue. No market data or guessed matches.
export const QUICK_INSTRUMENTS = [
  { id: "kr-069500", name: "KODEX 200", ticker: "069500", market: "KRX", currency: "KRW", assetClass: "주식 ETF" },
  { id: "kr-005930", name: "삼성전자", ticker: "005930", market: "KRX", currency: "KRW", assetClass: "개별 주식" },
  { id: "us-voo", name: "VOO", ticker: "VOO", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-qqq", name: "QQQ", ticker: "QQQ", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-schd", name: "SCHD", ticker: "SCHD", market: "US", currency: "USD", assetClass: "주식 ETF" },
  { id: "us-tlt", name: "TLT", ticker: "TLT", market: "US", currency: "USD", assetClass: "채권 ETF" },
  { id: "us-gld", name: "GLD", ticker: "GLD", market: "US", currency: "USD", assetClass: "금 ETF" },
] as const;
export type QuickInput = { currency: "KRW"; rows: { name: string; value: number; instrumentId: string | null }[] };
export type QuickDraft = { version: 1; id: string; expiresAt: number; input: QuickInput };
export function validateQuickPortfolio(value: unknown): { ok: true; input: QuickInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "자산 이름과 금액을 확인해 주세요." };
  const input = value as QuickInput;
  if (input.currency !== "KRW") return { ok: false, error: "모든 금액은 원화(KRW)로 환산해 입력해 주세요." };
  if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 12) return { ok: false, error: "자산을 1~12개 입력해 주세요." };
  const names = new Set<string>();
  for (const row of input.rows) {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 60) return { ok: false, error: "각 자산의 이름을 1~60자로 입력해 주세요." };
    const name = row.name.trim().normalize("NFKC").toLowerCase();
    if (names.has(name)) return { ok: false, error: "같은 자산은 금액을 합치거나 이름을 구분해 주세요." };
    names.add(name);
    if (!Number.isSafeInteger(row.value) || row.value < 0 || row.value > 1_000_000_000_000) return { ok: false, error: "금액은 0원 이상, 1조 원 이하의 정수로 입력해 주세요." };
    const instrument = QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId);
    if (row.instrumentId !== null && (!instrument || instrument.name !== row.name.trim())) return { ok: false, error: "선택한 종목과 이름이 일치하지 않습니다. 종목을 다시 선택해 주세요." };
  }
  if (input.rows.reduce((sum, row) => sum + row.value, 0) <= 0) return { ok: false, error: "최소 한 자산의 금액을 1원 이상 입력해 주세요." };
  return { ok: true, input: { currency: "KRW", rows: input.rows.map(row => ({ name: row.name.trim(), value: row.value, instrumentId: row.instrumentId })) } };
}
export function analyzeQuickPortfolio(input: QuickInput) {
  const valid = validateQuickPortfolio(input);
  if (!valid.ok) throw new Error("invalid_quick_portfolio");
  const total = valid.input.rows.reduce((sum, row) => sum + row.value, 0);
  const rows = valid.input.rows.map((row, index) => ({ ...row, key: String(index), weightPct: row.value / total * 100, instrument: QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId) ?? null }));
  const group = (kind: "currency" | "assetClass") => {
    const sums = new Map<string, number>();
    for (const row of rows) { const name = row.instrument?.[kind] ?? "미확인"; sums.set(name, (sums.get(name) ?? 0) + row.value); }
    return [...sums].map(([name, value]) => ({ name, value, weightPct: value / total * 100 }));
  };
  return { total, rows, largest: rows.reduce((a, b) => a.value >= b.value ? a : b), currencies: group("currency"), assetClasses: group("assetClass") };
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
