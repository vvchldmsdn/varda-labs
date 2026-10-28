import { Decimal, type Currency } from './money.ts';
import { convertMoney, type FxEvidence } from './currency-valuation.ts';
import type { ContributionComparison, ComparisonPlan } from './contribution-comparison.ts';

export type EffectQuote = { key: string; assetId: string; price: string; currency: Currency; at: string; source: string; basis: 'raw' };
export type ContributionEffectDocument = {
  version: 'contribution_effect_v1'; accountId: string; capturedAt: string;
  comparison: ContributionComparison; quotes: EffectQuote[];
};
export type EffectTrade = { id: string; accountId: string; assetId: string; type: 'buy' | 'sell' | 'split'; at: string; quantity?: string; price?: string; currency?: Currency; dateOnly?: boolean };
export type SavedContributionEffect = { id: string; createdAt: string; revision: number; document: ContributionEffectDocument; tradeIds: string[] };
export type EffectMarket = { asOf: string; quotes: EffectQuote[]; fx: readonly FxEvidence[]; complete: boolean; maxFxAgeMs: number };
const blocked = (reason: string) => ({ status: 'blocked' as const, reason });
const day = (at: string) => new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);

/** Never infers a trade link from a similar amount. Dates are execution dates, not settlement dates. */
export function eligibleEffectTrade(document: ContributionEffectDocument, trade: EffectTrade) {
  return Number.isFinite(Date.parse(document.capturedAt)) && trade.accountId === document.accountId && trade.type === 'buy' &&
    document.quotes.some(row => row.assetId === trade.assetId && row.currency === trade.currency) &&
    Number.isFinite(Date.parse(trade.at)) && (trade.dateOnly
      ? day(trade.at) > day(document.capturedAt)
      : Date.parse(trade.at) >= Date.parse(document.capturedAt));
}

/** Frozen plan price returns. This is an observed counterfactual, never a causal claim or realized P&L. */
export function evaluateContributionEffect(saved: SavedContributionEffect, market: EffectMarket, trades: readonly EffectTrade[]) {
  try {
    const doc = saved.document, comparison = doc.comparison;
    if (!Number.isFinite(Date.parse(doc.capturedAt)) || !Number.isFinite(Date.parse(comparison.basis.asOf)) || Date.parse(comparison.basis.asOf) > Date.parse(doc.capturedAt)) return blocked('invalid_snapshot');
    if (!market.complete || !Number.isFinite(Date.parse(market.asOf)) || Date.parse(market.asOf) < Date.parse(doc.capturedAt)) return blocked('market_incomplete');
    if (new Set(doc.quotes.map(q => q.key)).size !== doc.quotes.length || new Set(market.quotes.map(q => q.key)).size !== market.quotes.length) return blocked('quote_conflict');
    const convert = (amount: string | Decimal, currency: Currency, at: string) => {
      const result = convertMoney(typeof amount === 'string' ? amount : amount.toExactString(), currency, 'KRW', at, market.fx, market.maxFxAgeMs);
      if (!result.ok) throw new Error(result.reason);
      return result.value;
    };
    const now = new Map<string, Decimal>();
    for (const entry of doc.quotes) {
      const quote = market.quotes.find(row => row.key === entry.key && row.assetId === entry.assetId);
      if (!quote || quote.currency !== entry.currency || quote.basis !== entry.basis || !quote.source || !entry.source ||
        !Number.isFinite(Date.parse(quote.at)) || !Number.isFinite(Date.parse(entry.at)) || Date.parse(entry.at) > Date.parse(doc.capturedAt) ||
        Date.parse(quote.at) < Date.parse(entry.at) || Date.parse(quote.at) > Date.parse(market.asOf) ||
        Date.parse(market.asOf) - Date.parse(quote.at) > 10 * 86400000 || Decimal.from(quote.price).compare(0) <= 0 || Decimal.from(entry.price).compare(0) <= 0) return blocked('quote_unavailable');
      now.set(entry.assetId, convert(quote.price, quote.currency, market.asOf));
    }
    // A split requires rebasing both hypothetical baskets. Until supported, never show a false drop.
    if (trades.some(t => t.accountId === doc.accountId && t.type === 'split' && doc.quotes.some(q => q.assetId === t.assetId) && Date.parse(t.at) > Date.parse(doc.capturedAt) && Date.parse(t.at) <= Date.parse(market.asOf))) return blocked('split_requires_rebase');
    const entryFx = comparison.basis.usdKrw;
    const cashNow = (krw: Decimal) => comparison.funding === 'KRW' ? krw : entryFx ? convert(krw.div(entryFx), 'USD', market.asOf) : (() => { throw new Error('fx_missing'); })();
    const valuePlan = (plan: ComparisonPlan) => {
      let total = cashNow(Decimal.from(plan.cash));
      for (const row of comparison.basis.rows) {
        if (!plan.amounts[row.allocationKey]) continue;
        const entry = doc.quotes.find(q => q.key === row.allocationKey);
        if (!entry || (entry.currency === 'USD' && !entryFx)) throw new Error('entry_quote_missing');
        const cost = Decimal.from(entry.price).mul(entry.currency === 'USD' ? entryFx! : 1);
        total = total.add(Decimal.from(plan.amounts[row.allocationKey]).div(cost).mul(now.get(entry.assetId)!));
      }
      return total;
    };
    const ratio = valuePlan(comparison.ratio), aligned = valuePlan(comparison.aligned), adjusted = valuePlan(comparison.adjusted);
    const actual = (() => {
      try {
      if (!saved.tradeIds.length) return blocked('trades_not_linked');
      if (new Set(saved.tradeIds).size !== saved.tradeIds.length) return blocked('duplicate_trade');
      const linked = saved.tradeIds.map(id => trades.find(t => t.id === id));
      if (linked.some(t => !t || !eligibleEffectTrade(doc, t) || Date.parse(t.at) > Date.parse(market.asOf))) return blocked('trade_unavailable');
      let spentFunding = Decimal.from(0), value = Decimal.from(0), spentKrw = Decimal.from(0);
      for (const trade of linked as EffectTrade[]) {
        if (trades.some(t => t.accountId === doc.accountId && t.assetId === trade.assetId && ['sell', 'split'].includes(t.type) && Date.parse(t.at) >= Date.parse(trade.at) && Date.parse(t.at) <= Date.parse(market.asOf))) return blocked('subsequent_disposal');
        const quantity = Decimal.from(trade.quantity!), price = Decimal.from(trade.price!);
        if (quantity.compare(0) <= 0 || price.compare(0) <= 0) return blocked('invalid_trade');
        const cost = quantity.mul(price);
        const executionFx = trade.dateOnly ? market.fx.filter(rate => rate.kind === 'daily_reference') : market.fx;
        const funded = convertMoney(cost.toExactString(), trade.currency!, comparison.funding, trade.at, executionFx, market.maxFxAgeMs);
        const costKrw = convertMoney(cost.toExactString(), trade.currency!, 'KRW', trade.at, executionFx, market.maxFxAgeMs);
        if (!funded.ok || !costKrw.ok) return blocked('execution_fx_missing');
        spentFunding = spentFunding.add(funded.value);
        spentKrw = spentKrw.add(costKrw.value);
        value = value.add(quantity.mul(now.get(trade.assetId)!));
      }
      const fundingBudget = Decimal.from(comparison.budget).div(comparison.funding === 'USD' ? entryFx! : 1);
      if (spentFunding.compare(fundingBudget) > 0) return blocked('budget_exceeded');
      const cash = convert(fundingBudget.sub(spentFunding), comparison.funding, market.asOf);
      const total = value.add(cash);
      return { status: 'ready' as const, count: linked.length, investedValue: value.toNumber(), executionCost: spentKrw.toNumber(),
        remainingBudgetValue: cash.toNumber(), total: total.toNumber(), profit: total.sub(comparison.budget).toNumber(),
        returnPct: total.sub(comparison.budget).div(comparison.budget).mul(100).toNumber(), gapToRatio: total.sub(ratio).toNumber() };
      } catch { return blocked('execution_fx_missing'); }
    })();
    return { status: 'ready' as const, asOf: market.asOf, ratio: ratio.toNumber(), aligned: aligned.toNumber(), adjusted: adjusted.toNumber(),
      gap: adjusted.sub(ratio).toNumber(), alignmentEffect: aligned.sub(ratio).toNumber(), adjustmentEffect: adjusted.sub(aligned).toNumber(),
      ratioReturnPct: ratio.sub(comparison.budget).div(comparison.budget).mul(100).toNumber(), adjustedReturnPct: adjusted.sub(comparison.budget).div(comparison.budget).mul(100).toNumber(), actual };
  } catch { return blocked('price_or_fx_unavailable'); }
}
