import { Decimal, isCurrency, moneyFromMinor, parseMoneyInput, type Currency } from './money.ts';
import type { ContributionComparisonBasis } from './contribution-comparison.ts';
import { validatePlan, type PlanInput } from './investment-plan.ts';

/** Current values and the budget limit are expressed in baseCurrency, never an
 * implicit KRW alias. A cross-currency funding amount requires evidenced FX. */
export type UserAllocationBasis = {
  baseCurrency: Currency; maximumBudget: number; usdKrw: number | null;
  rows: { allocationKey: string; currentValue: number; targetWeightBps: number; buyable: boolean;
    metadata: { manualValuation?: boolean; name: string; currency: Currency; market?: string; ticker?: string } }[];
};

export function nativeUserAllocationBasis(basis: ContributionComparisonBasis): UserAllocationBasis {
  return { baseCurrency: 'KRW', maximumBudget: 100_000_000_000, usdKrw: basis.usdKrw,
    rows: basis.rows.map(row => ({ allocationKey: row.allocationKey, currentValue: row.currentValueKrw,
      targetWeightBps: row.targetWeightBps, buyable: row.buyable, metadata: row.metadata })) };
}

/** Public plan values are user-entered totals in one currency, not live quotes,
 * quantities, cost basis or authenticated holdings. No exchange rate is invented. */
export function publicUserAllocationBasis(input: PlanInput): UserAllocationBasis | null {
  const parsed = validatePlan(input);
  if (!parsed.ok) return null;
  return { baseCurrency: parsed.input.currency, maximumBudget: moneyFromMinor(1_000_000_000_000, parsed.input.currency), usdKrw: null,
    rows: parsed.input.rows.map(row => ({ allocationKey: `plan:${row.name.normalize('NFKC').toLowerCase()}`,
      currentValue: row.value, targetWeightBps: row.targetBps, buyable: true, metadata: { name: row.name, currency: parsed.input.currency } })) };
}

/** Separate public namespace: never reuse account-bound workspace hints. The
 * validated input identity also works before a PlanDraft id exists. */
export function publicUserAllocationIdentity(input: PlanInput): string | null {
  const parsed = validatePlan(input);
  return parsed.ok ? JSON.stringify([parsed.input.currency, parsed.input.amount,
    parsed.input.rows.map(row => [row.name.normalize('NFKC').toLowerCase(), row.value, row.targetBps]), parsed.input.asOf ?? null]) : null;
}

export type UserAllocationAmounts = Record<string, string>;
export type UserAllocationResult = {
  status: 'ready'; budget: number; allocated: number; remaining: number;
  rows: { key: string; amount: number; currentPct: number | null; afterPct: number | null; targetPct: number; gapPp: number | null }[];
} | { status: 'blocked'; reason: 'invalid_amount' | 'fx_missing' | 'invalid_basis' | 'invalid_allocation' | 'over_budget' | 'not_buyable'; key?: string };

/** Immediate composition only. Both plans use the same current values and FX.
 * Unallocated new money is shown separately, never smuggled into investment weights.
 * This projection neither recommends amounts nor creates trades/cost/return evidence. */
export function compareUserAllocation(basis: UserAllocationBasis, amount: string, currency: Currency, amounts: UserAllocationAmounts): UserAllocationResult {
  try {
    if (!isCurrency(basis.baseCurrency) || !isCurrency(currency) || !Number.isFinite(basis.maximumBudget) || basis.maximumBudget <= 0) return { status: 'blocked', reason: 'invalid_basis' };
    const budget = parseMoneyInput(amount, currency);
    if (budget === null || budget <= 0) return { status: 'blocked', reason: 'invalid_amount' };
    const conversionNeeded = currency !== basis.baseCurrency;
    if (conversionNeeded && (!basis.usdKrw || !Number.isFinite(basis.usdKrw) || basis.usdKrw <= 0)) return { status: 'blocked', reason: 'fx_missing' };
    const fx = !conversionNeeded ? Decimal.from(1) : currency === 'USD' ? Decimal.from(basis.usdKrw!) : Decimal.from(1).div(basis.usdKrw!);
    if (Decimal.from(budget).mul(fx).compare(basis.maximumBudget) > 0) return { status: 'blocked', reason: 'invalid_amount' };
    const keys = new Set(basis.rows.map(row => row.allocationKey));
    if (!basis.rows.length || keys.size !== basis.rows.length || Object.keys(amounts).some(key => !keys.has(key)) ||
      basis.rows.some(row => !Number.isFinite(row.currentValue) || row.currentValue < 0 || !Number.isInteger(row.targetWeightBps) || row.targetWeightBps < 0) ||
      basis.rows.reduce((sum, row) => sum + row.targetWeightBps, 0) !== 10_000) return { status: 'blocked', reason: 'invalid_basis' };
    let allocated = Decimal.from(0), current = Decimal.from(0);
    const parsed: Record<string, number> = Object.create(null);
    for (const row of basis.rows) {
      const text = amounts[row.allocationKey] ?? '';
      const value = text.trim() === '' ? 0 : parseMoneyInput(text, currency);
      if (value === null || value < 0) return { status: 'blocked', reason: 'invalid_allocation', key: row.allocationKey };
      if (value > 0 && !row.buyable) return { status: 'blocked', reason: 'not_buyable', key: row.allocationKey };
      parsed[row.allocationKey] = value;
      allocated = allocated.add(value);
      current = current.add(row.currentValue);
    }
    if (allocated.compare(budget) > 0) return { status: 'blocked', reason: 'over_budget' };
    const after = current.add(allocated.mul(fx));
    return { status: 'ready', budget, allocated: allocated.toNumber(), remaining: Decimal.from(budget).sub(allocated).toNumber(),
      rows: basis.rows.map(row => {
        const afterPct = after.compare(0) > 0 ? Decimal.from(row.currentValue).add(Decimal.from(parsed[row.allocationKey]).mul(fx)).div(after).mul(100).toNumber() : null;
        return { key: row.allocationKey, amount: parsed[row.allocationKey], currentPct: current.compare(0) > 0 ? Decimal.from(row.currentValue).div(current).mul(100).toNumber() : null,
          afterPct, targetPct: row.targetWeightBps / 100, gapPp: afterPct === null ? null : afterPct - row.targetWeightBps / 100 };
      }) };
  } catch { return { status: 'blocked', reason: 'invalid_basis' }; }
}

export type UserAllocationWorkspace = { savedAt: number; a: UserAllocationAmounts; b: UserAllocationAmounts };
export const USER_ALLOCATION_WORKSPACE_TTL = 24 * 60 * 60_000;
export const PUBLIC_ALLOCATION_WORKSPACE_PREFIX = 'cairn:public-user-allocation:';
/** Explicit guest-input deletion never touches owner-bound workspaces. Snapshot
 * keys first so removal cannot shift the remaining storage indices. */
export function clearPublicUserAllocationWorkspaces(storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>): boolean {
  try {
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1_000) return false;
    const keys: string[] = [];
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(PUBLIC_ALLOCATION_WORKSPACE_PREFIX)) keys.push(key);
    }
    let cleared = true;
    for (const key of keys) {
      try { storage.removeItem(key); if (storage.getItem(key) !== null) cleared = false; }
      catch { cleared = false; }
    }
    return cleared;
  } catch { return false; }
}
export function updateUserAllocationWorkspace(draft: UserAllocationWorkspace, plan: 'a' | 'b', key: string, value: string, now = Date.now()): UserAllocationWorkspace {
  return { ...draft, savedAt: now, [plan]: { ...draft[plan], [key]: value } };
}
export function userAllocationRetentionRemaining(savedAt: number, now = Date.now()) {
  return Math.max(0, savedAt + USER_ALLOCATION_WORKSPACE_TTL - now);
}
export function expireUserAllocationWorkspace(storage: Pick<Storage, 'getItem' | 'removeItem'>, key: string, savedAt: number, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (raw && JSON.parse(raw)?.savedAt === savedAt && userAllocationRetentionRemaining(savedAt, now) === 0) storage.removeItem(key);
  } catch { /* Local retention cleanup cannot interrupt the visible draft. */ }
}
/** Owner, account, currency and instrument-set form the caller's storage key. */
export function readUserAllocationWorkspace(raw: string | null, keys: readonly string[], now = Date.now()): UserAllocationWorkspace | null {
  try {
    if (!raw || raw.length > 32_000) return null;
    const value = JSON.parse(raw) as UserAllocationWorkspace;
    if (!Number.isFinite(value.savedAt) || value.savedAt > now + 60_000 || now - value.savedAt >= USER_ALLOCATION_WORKSPACE_TTL) return null;
    for (const plan of [value.a, value.b]) {
      if (!plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).some(key => !keys.includes(key))) return null;
      if (Object.values(plan).some(amount => typeof amount !== 'string' || amount.length > 40)) return null;
    }
    return { savedAt: value.savedAt, a: { ...value.a }, b: { ...value.b } };
  } catch { return null; }
}
