import type { ContributionComparisonBasis } from './contribution-comparison.ts';
import { knownContributionEvidence, unavailableContributionModifiers } from './additional-contribution-modifiers.ts';

/** Development-only fixture: never a substitute for an owner's missing evidence. */
export function contributionComparisonPreview(): ContributionComparisonBasis {
  return { status: 'ready', scopeLabel: '예시 증권 계좌', asOf: '2026-10-27T12:00:00Z', policyRevision: 1, usdKrw: 1350,
    modifiers: { ...unavailableContributionModifiers(), fundingBasis: 'KRW', fx: knownContributionEvidence({ multiplier: .72, hot: true, observationCount: 180 }, 'synthetic_preview', '2026-10-27T12:00:00Z') },
    rows: [
      { key: 'voo', name: 'VOO', currency: 'USD', target: 5000, value: 5000000, ma: -5, assetClass: 'broad_index', exposure: 'US_LISTED' },
      { key: 'msft', name: 'Microsoft', currency: 'USD', target: 2000, value: 1600000, ma: 2, assetClass: 'large_growth', exposure: 'US_LISTED' },
      { key: 'kodex', name: 'KODEX 200', currency: 'KRW', target: 3000, value: 3400000, ma: 1, assetClass: 'broad_index', exposure: 'DOMESTIC' },
    ].map(row => ({ allocationKey: row.key, assetType: 'etf', buyable: true, currentValueKrw: row.value, costBasisKrw: null, targetWeightBps: row.target,
      ma120Evidence: { status: row.ma < 0 ? 'below_ma' : 'above_ma', distanceFromMaPct: row.ma }, maAssetClass: row.assetClass, maRuleEnabled: true,
      fxExposureType: row.exposure as 'US_LISTED' | 'DOMESTIC', metadata: { name: row.name, currency: row.currency as 'USD' | 'KRW' } })) };
}
