import { calculateExplainableAdditionalContribution, type AdditionalContributionPolicyRow } from './additional-contribution-policy-engine.ts';
import { resolveContributionMultipliers, unavailableContributionModifiers, type ContributionModifiers } from './additional-contribution-modifiers.ts';
import { convertMoney } from './currency-valuation.ts';
import { Decimal, parseMoneyInput, type Currency } from './money.ts';
import type { NativeContributionContextResult } from './native-contribution-plan.ts';

export type ComparisonRow = AdditionalContributionPolicyRow<{ name: string; currency: Currency }>;
export type ContributionComparisonBasis = {
  status: 'ready'; scopeLabel: string; asOf: string; policyRevision: number;
  rows: ComparisonRow[]; modifiers: ContributionModifiers;
  usdKrw: number | null;
  evidenceVersion?: string;
};
export type ComparisonBasisResult = ContributionComparisonBasis | { status: 'blocked'; reason: string; unavailableHoldings?: string[] };
export type ComparisonPlan = { amounts: Record<string, number>; cash: number };
export type ContributionComparison = {
  status: 'ready'; budget: number; funding: Currency; basis: ContributionComparisonBasis;
  ratio: ComparisonPlan; aligned: ComparisonPlan; adjusted: ComparisonPlan;
  evidence: { key: string; ma: number; maReason: string; fx: number; fxStatus: string }[];
};

/** Owner-scoped read -> small serializable research input. No ledger or cost records reach the client. */
export function prepareContributionComparison(context: NativeContributionContextResult): ComparisonBasisResult {
  if (context.status !== 'ready') return context;
  try {
    const input = context.input;
    const accounts = input.rows.map(row => (row.metadata as { accountId?: string } | null)?.accountId);
    if (accounts.some(id => !id) || new Set(accounts).size !== 1) return { status: 'blocked', reason: 'choose_one_account' };
    const rows: ComparisonRow[] = [];
    for (const row of input.rows) {
      if (!row.value.source || row.value.at !== input.asOf) return { status: 'blocked', reason: 'valuation_time_mismatch' };
      const converted = convertMoney(row.value.amount, row.value.currency, 'KRW', input.asOf, input.fx, input.maxFxAgeMs);
      if (!converted.ok) return { status: 'blocked', reason: converted.reason };
      const maValid = row.maBasis && row.maBasis.priceCurrency === row.maBasis.averageCurrency && row.maBasis.priceBasis === row.maBasis.averageBasis;
      rows.push({ allocationKey: row.allocationKey, assetType: row.assetType, buyable: row.buyable,
        currentValueKrw: converted.value.toNumber(), costBasisKrw: null, targetWeightBps: row.targetWeightBps,
        maAssetClass: row.maAssetClass, maRuleEnabled: row.maRuleEnabled,
        ma120Evidence: maValid ? row.ma120Evidence : { status: 'unavailable', distanceFromMaPct: null },
        fxExposureType: row.fxExposureType, metadata: { name: context.names[row.allocationKey] ?? row.allocationKey, currency: row.value.currency } });
    }
    const fx = convertMoney('1', 'USD', 'KRW', input.asOf, input.fx, input.maxFxAgeMs);
    return { status: 'ready', scopeLabel: context.scopeLabel, asOf: input.asOf, policyRevision: context.policy.revision,
      rows, modifiers: input.modifiers ?? unavailableContributionModifiers(), usdKrw: fx.ok ? fx.value.toNumber() : null, evidenceVersion: context.evidenceVersion };
  } catch { return { status: 'blocked', reason: 'invalid_evidence' }; }
}

/** Same investment, universe and entry price. Sales, existing cash, RC/regime/news/performance and forced topups are excluded.
 * The third arm exposes target-deficit effects, so they cannot be mislabeled as FX/MA benefit. */
export function compareContribution(basis: ContributionComparisonBasis, amount: string, funding: Currency = 'KRW'):
  ContributionComparison | { status: 'blocked'; reason: string } {
  try {
    const parsed = parseMoneyInput(amount, funding);
    if (parsed === null || parsed <= 0 || parsed > 100_000_000_000) return { status: 'blocked', reason: 'invalid_amount' };
    if (funding === 'USD' && (!basis.usdKrw || basis.usdKrw <= 0)) return { status: 'blocked', reason: 'fx_missing' };
    const exactBudget = Decimal.from(parsed).mul(funding === 'USD' ? basis.usdKrw! : 1);
    const units = Number(exactBudget.minor('KRW', 'floor'));
    const budget = exactBudget.toNumber();
    if (!Number.isSafeInteger(units) || units <= 0 || budget > 100_000_000_000) return { status: 'blocked', reason: 'invalid_amount' };
    if (basis.rows.some(row => row.targetWeightBps > 0 && !row.buyable)) return { status: 'blocked', reason: 'unbuyable_target' };
    // Both engine runs use the very same snapshot; cost evidence cannot trigger a sale here.
    const input = { cashAmountKrw: units, minimumExecutionRatioPct: 0, trimDriftThresholdPct: 100 };
    const buyOnlyRows = basis.rows.map(row => ({ ...row, costBasisKrw: null, hasExactLoss: undefined }));
    const aligned = calculateExplainableAdditionalContribution({ ...input, rows: buyOnlyRows.map(row => ({ ...row, maRuleEnabled: false })) });
    const adjusted = calculateExplainableAdditionalContribution({ ...input, rows: buyOnlyRows });
    if (aligned.status !== 'ready' || adjusted.status !== 'ready') return { status: 'blocked', reason: 'invalid_policy' };
    const ratioAmounts = allocateRatio(units, basis.rows);
    const alignedAmounts = Object.fromEntries(aligned.rows.map(row => [row.allocationKey, row.allocationKrw]));
    const amounts: Record<string, number> = Object.create(null);
    const evidence = adjusted.rows.map(row => {
      const source = basis.rows.find(item => item.allocationKey === row.allocationKey)!;
      const fx = resolveContributionMultipliers({ modifiers: { ...basis.modifiers, fundingBasis: funding === 'KRW' ? 'KRW' : 'unsupported' }, exposure: source.fxExposureType, targetFraction: source.targetWeightBps / 10000 }).fx;
      amounts[row.allocationKey] = Number(Decimal.from(row.allocationKrw).mul(fx.value).minor('KRW', 'floor'));
      return { key: row.allocationKey, ma: row.maEffectiveMultiplier, maReason: row.maAdjustmentReason, fx: fx.value, fxStatus: funding === 'USD' ? 'not_applicable' : fx.status };
    });
    const plan = (allocations: Record<string, number>): ComparisonPlan => ({ amounts: { ...allocations }, cash: exactBudget.sub(Object.values(allocations).reduce((a, b) => a + b, 0)).toNumber() });
    return { status: 'ready', budget, funding, basis, ratio: plan(ratioAmounts), aligned: plan(alignedAmounts), adjusted: plan(amounts), evidence };
  } catch { return { status: 'blocked', reason: 'invalid_evidence' }; }
}

function allocateRatio(budget: number, rows: readonly ComparisonRow[]) {
  const ranked = rows.map(row => {
    const numerator = BigInt(budget) * BigInt(row.targetWeightBps);
    return { key: row.allocationKey, amount: Number(numerator / BigInt(10000)), remainder: Number(numerator % BigInt(10000)) };
  }).sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  let left = budget - ranked.reduce((sum, row) => sum + row.amount, 0);
  for (const row of ranked) if (left > 0) { row.amount++; left--; }
  return Object.fromEntries(ranked.map(row => [row.key, row.amount]));
}

export type ContributionScenario = { pricePct: number; usdKrwPct: number; rowPricePct?: Record<string, number> };
/** Terminal sensitivity, not a forecast path. KRW quoted asset changes already include currency exposure. */
export function evaluateContributionScenario(comparison: ContributionComparison, scenario: ContributionScenario) {
  const valid = (value: number) => Number.isFinite(value) && value >= -100 && value <= 200;
  if (!valid(scenario.pricePct) || !valid(scenario.usdKrwPct) || Object.entries(scenario.rowPricePct ?? {}).some(([key, value]) => !comparison.basis.rows.some(row => row.allocationKey === key) || !valid(value))) return null;
  const evaluate = (plan: ComparisonPlan) => {
    // USD-funded residual stays USD. Only the reporting value changes with FX.
    let value = Decimal.from(plan.cash).mul(comparison.funding === 'USD' ? Decimal.from(scenario.usdKrwPct).div(100).add(1) : 1);
    for (const row of comparison.basis.rows) {
      const price = Decimal.from(scenario.rowPricePct?.[row.allocationKey] ?? scenario.pricePct).div(100).add(1);
      const fx = row.metadata.currency === 'USD' ? Decimal.from(scenario.usdKrwPct).div(100).add(1) : Decimal.from(1);
      value = value.add(Decimal.from(plan.amounts[row.allocationKey]).mul(price).mul(fx));
    }
    return value;
  };
  const ratio = evaluate(comparison.ratio), aligned = evaluate(comparison.aligned), adjusted = evaluate(comparison.adjusted);
  return { ratio: ratio.toNumber(), aligned: aligned.toNumber(), adjusted: adjusted.toNumber(),
    gap: adjusted.sub(ratio).toNumber(), alignmentEffect: aligned.sub(ratio).toNumber(), adjustmentEffect: adjusted.sub(aligned).toNumber(),
    ratioReturnPct: ratio.sub(comparison.budget).div(comparison.budget).mul(100).toNumber(),
    adjustedReturnPct: adjusted.sub(comparison.budget).div(comparison.budget).mul(100).toNumber() };
}
