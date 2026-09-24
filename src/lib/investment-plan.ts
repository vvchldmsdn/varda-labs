import { allocateAdditionalContribution, ADDITIONAL_CONTRIBUTION_POLICY } from "./additional-contribution-allocator.ts";
import { isCurrency, moneyMinor, moneyFromMinor, type Currency } from "./money.ts";

export const PLAN_VERSION = 1;
export const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
export const PLAN_STORAGE_KEY = "varda.investment-plan.v1";
export type PlanInput = { currency: Currency; amount: number; rows: { name: string; value: number; targetBps: number }[]; version?: 2; asOf?: string };
export const CURRENCY_PLAN_VERSION = "deficit_proportional_currency_v2";
export const planEngineVersion = (input: PlanInput) => input.version === 2 ? CURRENCY_PLAN_VERSION : ADDITIONAL_CONTRIBUTION_POLICY.version;
export type PlanDraft = { version: 1; id: string; expiresAt: number; input: PlanInput };
export const SAMPLE_PLAN: PlanInput = { currency: "KRW", amount: 500000, rows: [
  { name: "샘플 ETF A", value: 3000000, targetBps: 5000 },
  { name: "샘플 ETF B", value: 1000000, targetBps: 3000 },
  { name: "샘플 ETF C", value: 1000000, targetBps: 2000 },
] };
export function validatePlan(value: unknown): { ok: true; input: PlanInput } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "입력 내용을 확인해 주세요." };
  const v = value as PlanInput;
  if (!isCurrency(v.currency) || (v.currency !== "KRW" && v.version !== 2) || (v.version !== undefined && v.version !== 2) || (v.version === 2 && (!v.asOf || !Number.isFinite(Date.parse(v.asOf)) || Date.parse(v.asOf) > Date.now() + 60000))) return { ok: false, error: "계산 통화와 기준 시각을 확인해 주세요." };
  const money = (n: number) => { try { return typeof n === "number" && n >= 0 && moneyMinor(n, v.currency) <= 1_000_000_000_000; } catch { return false; } };
  if (!money(v.amount) || v.amount === 0) return { ok: false, error: "추가 투자금은 1원 이상, 1조 원 이하의 정수로 입력해 주세요." };
  if (!Array.isArray(v.rows) || v.rows.length < 1 || v.rows.length > 12) return { ok: false, error: "계산 대상 자산을 1~12개 입력해 주세요." };
  const names = new Set<string>();
  for (const row of v.rows) {
    if (!row || typeof row.name !== "string" || !row.name.trim() || row.name.trim().length > 60) return { ok: false, error: "각 자산에 1~60자의 구분할 이름을 입력해 주세요." };
    const key = row.name.trim().normalize("NFKC").toLowerCase();
    if (names.has(key)) return { ok: false, error: "같은 이름의 자산은 합치거나 서로 구분해 주세요." };
    names.add(key);
    if (!money(row.value)) return { ok: false, error: "현재 평가금액은 0원 이상, 1조 원 이하의 정수로 입력해 주세요." };
    if (!Number.isInteger(row.targetBps) || row.targetBps < 0 || row.targetBps > 10000) return { ok: false, error: "목표 비중은 0~100%, 소수 둘째 자리까지 입력해 주세요." };
  }
  if (v.rows.reduce((sum, row) => sum + row.targetBps, 0) !== 10000) return { ok: false, error: "입력한 자산의 목표 비중 합계가 100%여야 합니다." };
  return { ok: true, input: { currency: v.currency, amount: v.amount, rows: v.rows.map(row => ({ name: row.name.trim(), value: row.value, targetBps: row.targetBps })), ...(v.version === 2 ? { version: 2, asOf: v.asOf } : {}) } };
}
export function calculatePlan(input: PlanInput) {
  const parsed = validatePlan(input);
  if (!parsed.ok) return parsed;
  // Opaque row keys are only allocator identities, never real instruments or stored holdings.
  const result = allocateAdditionalContribution({ account: "brokerage", targetPolicyVersion: ADDITIONAL_CONTRIBUTION_POLICY.version,
    cashAmountKrw: moneyMinor(parsed.input.amount, parsed.input.currency), holdings: parsed.input.rows.map((row, i) => ({ market: "plan", currency: "KRW", ticker: `ROW${String(i).padStart(2, "0")}`, currentValueKrw: moneyMinor(row.value, parsed.input.currency), targetWeightBps: row.targetBps, buyability: "buyable" })) });
  if (result.status !== "ready") return { ok: false as const, error: "현재 입력으로 배분을 계산할 수 없습니다." };
  // The legacy allocator's *Krw fields are internal minor units here. Public results use currency-aware amounts.
  const fromUnits = (value: number) => moneyFromMinor(value, parsed.input.currency);
  return { ok: true as const, result, currency: parsed.input.currency, totalAllocated: fromUnits(result.totalAllocatedKrw), residualCash: fromUnits(result.residualCashKrw),
    rows: result.allocations.map((row, i) => ({ name: parsed.input.rows[i].name, value: fromUnits(row.currentValueKrw), allocation: fromUnits(row.allocationKrw),
    beforePct: result.currentPortfolioTotalKrw > 0 ? row.currentValueKrw / result.currentPortfolioTotalKrw * 100 : null,
    afterPct: (row.currentValueKrw + row.allocationKrw) / result.postTopupTotalKrw * 100, targetPct: row.targetWeightBps / 100 })) };
}
export function parseDraft(raw: string | null, now = Date.now()): PlanDraft | null {
  try { const d = JSON.parse(raw ?? "null");
    if (!d || d.version !== PLAN_VERSION || !isPlanId(d.id) || !Number.isFinite(d.expiresAt) || d.expiresAt <= now || d.expiresAt > now + PLAN_TTL_MS || !validatePlan(d.input).ok) return null;
    return { version: 1, id: d.id, expiresAt: d.expiresAt, input: d.input };
  } catch { return null; }
}
export function isPlanId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
/** Called on explicit calculation/reuse actions, never during rendering. */
export function createPlanDraft(input: PlanInput, previous: PlanDraft | null = null): PlanDraft {
  if (previous && previous.expiresAt > Date.now() && JSON.stringify(previous.input) === JSON.stringify(input)) return previous;
  return { version: 1, id: crypto.randomUUID(), expiresAt: Date.now() + PLAN_TTL_MS, input };
}
