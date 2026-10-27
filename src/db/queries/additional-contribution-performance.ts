import 'server-only';
import { loadPortfolioRiskPriceCandidates } from '@/db/queries/portfolio-risk';
import { admitAdjustedHistoricalPriceRows, admitSharedKisRawHistoricalPriceRows, selectPreferredPrivateHistoricalPriceRows } from '@/lib/market-data/asset-price-consumer-admission';
import { calculateContributionPerformance, type ContributionPerformanceHolding } from '@/lib/additional-contribution-performance';
import { missingContributionEvidence, type ContributionModifiers } from '@/lib/additional-contribution-modifiers';

/** Shared stored market history only. Holdings/weights come from the authenticated query caller. */
export async function readAdditionalContributionPerformance(input: {
  rows: readonly ContributionPerformanceHolding[];
  reportingCurrency: 'KRW' | 'USD';
  now: Date;
}): Promise<ContributionModifiers['performance']> {
  if (input.reportingCurrency !== 'KRW') return missingContributionEvidence('performance_reporting_currency_unsupported');
  if (input.rows.some(row => !Number.isFinite(row.currentValue) || row.currentValue < 0)) return missingContributionEvidence('performance_weight_invalid');
  const positive = input.rows.filter(row => row.currentValue > 0);
  if (positive.some(row => row.market?.trim().toLowerCase() !== 'korea' || row.currency?.trim().toUpperCase() !== 'KRW' || !row.ticker?.trim())) return missingContributionEvidence('performance_complete_krw_domestic_coverage_required');
  const tickers = [...new Set(positive.map(row => row.ticker!.trim().toUpperCase()))];
  if (tickers.length < 2) return missingContributionEvidence('performance_two_instruments_required');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(input.now);
  const candidates = await loadPortfolioRiskPriceCandidates({
    tickers: [...new Set([...tickers, '069500'])],
    sourceDateFrom: new Date(Date.parse(today) - 550 * 86400000).toISOString().slice(0, 10),
    sourceDateTo: today,
  });
  // Never read a future receipt or let sample evidence enter an allocation modifier.
  const validReceipt = (at: string | Date | null) => at !== null && Number.isFinite(new Date(at).getTime()) && new Date(at).getTime() <= input.now.getTime();
  const past = candidates.filter(row => !row.isSample && row.priceDate <= today);
  const selected = selectPreferredPrivateHistoricalPriceRows({
    adjustedRows: admitAdjustedHistoricalPriceRows(past.filter(row => validReceipt(row.adjustedCloseFetchedAt))).rows,
    privateRawRows: admitSharedKisRawHistoricalPriceRows(past.filter(row => validReceipt(row.fetchedAt))).rows,
  });
  // One adjusted provider binding/source across the whole comparison, including the benchmark.
  const providers = new Set(selected.rows.filter(row => row.priceBasis === 'provider_adjusted_close').map(({ row }) => row.adjustedCloseProvider!.trim().toLowerCase()));
  if (providers.size > 1) return missingContributionEvidence('performance_provider_mismatch');
  const receiptTimes = selected.rows.map(({ row, priceBasis }) => new Date((priceBasis === 'provider_adjusted_close' ? row.adjustedCloseFetchedAt : row.fetchedAt)!).getTime());
  // Keep the saved-plan evidence version stable when only the request clock changes.
  const evidenceAsOf = receiptTimes.length ? new Date(Math.max(...receiptTimes)).toISOString() : input.now.toISOString();
  return calculateContributionPerformance({
    holdings: input.rows, reportingCurrency: input.reportingCurrency, serviceDate: today, asOf: evidenceAsOf,
    prices: selected.rows.map(({ row, priceBasis }) => ({
      ticker: row.ticker, market: row.market, currency: row.currency, date: row.priceDate, priceBasis,
      price: Number(priceBasis === 'provider_adjusted_close' ? row.adjustedClosePrice : row.closePrice),
      source: (priceBasis === 'provider_adjusted_close' ? row.adjustedCloseSource : row.source) ?? '',
    })),
  });
}
