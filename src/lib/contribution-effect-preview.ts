import { contributionComparisonPreview } from './contribution-comparison-preview.ts';
import { compareContribution } from './contribution-comparison.ts';
import { evaluateContributionEffect, type SavedContributionEffect, type EffectTrade } from './contribution-effect.ts';
export function contributionEffectPreview() {
  const at = '2026-10-17T00:00:00Z', asOf = '2026-10-27T00:00:00Z';
  const basis = { ...contributionComparisonPreview(), asOf: at };
  const comparison = compareContribution(basis, '1000000');
  if (comparison.status !== 'ready') throw new Error('invalid_preview');
  const quotes = basis.rows.map(r => ({ key: r.allocationKey, assetId: r.allocationKey, currency: r.metadata.currency, price: '100', at, source: 'synthetic', basis: 'raw' as const }));
  const msft = basis.rows.find(r => r.metadata.name.includes('Microsoft')) ?? basis.rows[1];
  const trade: EffectTrade & { name: string } = { id: 'demo-trade', type: 'buy', accountId: 'demo', assetId: msft.allocationKey, at: '2026-10-18T00:00:00Z', quantity: '3.2', price: '100', currency: 'USD', name: msft.metadata.name };
  const saved: SavedContributionEffect = { id: 'demo-effect', createdAt: at, revision: 0, tradeIds: [trade.id], document: { version: 'contribution_effect_v1', accountId: 'demo', capturedAt: at, comparison, quotes } };
  const fx = [at, trade.at, asOf].map(observedAt => ({ base: 'USD' as const, quote: 'KRW' as const, rate: String(basis.usdKrw), observedAt, fetchedAt: observedAt, source: 'synthetic', kind: 'synthetic' as const }));
  return { ...saved, candidates: [trade], result: evaluateContributionEffect(saved, { asOf, quotes: quotes.map(q => ({ ...q, price: '90', at: asOf })), fx, complete: true, maxFxAgeMs: 3 * 86400000 }, [trade]) };
}
