import { knownContributionEvidence, missingContributionEvidence, type ContributionModifiers } from './additional-contribution-modifiers.ts';

export type ContributionPerformanceHolding = Readonly<{
  ticker: string | null;
  market: string | null;
  currency: string | null;
  currentValue: number;
}>;
export type ContributionPerformancePrice = Readonly<{
  ticker: string;
  market: string;
  currency: string;
  date: string;
  price: number;
  source: string;
  priceBasis: 'provider_adjusted_close' | 'private_kis_raw_close';
}>;
export const CONTRIBUTION_PERFORMANCE_POLICY = 'gyeol_current_weight_log_alpha_kodex200_v1';

/** Fixed current weights, not realized user performance. No historical FX substitution. */
export function calculateContributionPerformance(input: {
  holdings: readonly ContributionPerformanceHolding[];
  prices: readonly ContributionPerformancePrice[];
  reportingCurrency: 'KRW' | 'USD';
  serviceDate: string;
  asOf: string;
}): ContributionModifiers['performance'] {
  const fail = missingContributionEvidence;
  if (input.reportingCurrency !== 'KRW') return fail('performance_reporting_currency_unsupported');
  if (!Number.isFinite(Date.parse(input.asOf)) || !validDate(input.serviceDate)) return fail('performance_time_invalid');
  if (input.holdings.some(row => !Number.isFinite(row.currentValue) || row.currentValue < 0)) return fail('performance_weight_invalid');
  const positive = input.holdings.filter(row => row.currentValue > 0);
  if (positive.some(row => row.market?.trim().toLowerCase() !== 'korea' || row.currency?.trim().toUpperCase() !== 'KRW' || !row.ticker?.trim())) return fail('performance_complete_krw_domestic_coverage_required');
  const values = new Map<string, number>();
  for (const row of positive) {
    const ticker = row.ticker!.trim().toUpperCase();
    values.set(ticker, (values.get(ticker) ?? 0) + row.currentValue);
  }
  if (values.size < 2) return fail('performance_two_instruments_required');
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return fail('performance_weight_invalid');
  const tickers = [...new Set([...values.keys(), '069500'])];
  const histories = new Map<string, ContributionPerformancePrice[]>();
  for (const ticker of tickers) {
    const rows = input.prices.filter(row => row.ticker.trim().toUpperCase() === ticker && row.market.trim().toLowerCase() === 'korea' && row.currency.trim().toUpperCase() === 'KRW');
    if (rows.some(row => !validDate(row.date) || row.date > input.serviceDate || !Number.isFinite(row.price) || row.price <= 0 || !row.source.trim())) return fail('performance_price_invalid');
    const byDate = new Map<string, ContributionPerformancePrice>();
    for (const row of rows) {
      const prior = byDate.get(row.date);
      if (prior && (prior.price !== row.price || prior.source !== row.source || prior.priceBasis !== row.priceBasis)) return fail('performance_price_conflict');
      byDate.set(row.date, row);
    }
    const selected = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-253);
    if (selected.length !== 253) return fail('performance_253_prices_required');
    histories.set(ticker, selected);
  }
  const benchmark = histories.get('069500')!;
  const lastDate = benchmark.at(-1)!.date;
  if (Date.parse(input.serviceDate) - Date.parse(lastDate) > 7 * 86400000) return fail('performance_history_stale');
  const source = benchmark[0].source;
  for (const rows of histories.values()) {
    if (rows.some((row, index) => row.date !== benchmark[index].date)) return fail('performance_dates_not_aligned');
    // Existing raw-history admission permits descriptive analysis, not this allocation effect.
    if (rows.some(row => row.priceBasis !== 'provider_adjusted_close')) return fail('performance_raw_price_effect_not_admitted');
    if (rows.some(row => row.source !== source)) return fail('performance_source_mismatch');
  }
  const logReturns = (rows: readonly ContributionPerformancePrice[]) => rows.slice(1).map((row, index) => Math.log(row.price / rows[index].price));
  const market = logReturns(benchmark);
  const portfolio = Array<number>(252).fill(0);
  for (const [ticker, value] of values) {
    logReturns(histories.get(ticker)!).forEach((r, index) => { portfolio[index] += value / total * r; });
  }
  const alpha90Pct = alpha(portfolio.slice(-90), market.slice(-90));
  const alpha252Pct = alpha(portfolio, market);
  if (alpha90Pct === null || alpha252Pct === null) return fail('performance_benchmark_variance_missing');
  let wealth = 1, peak = 1, maxDrawdown = 0;
  for (const r of portfolio.slice(-90)) {
    wealth *= Math.exp(r);
    peak = Math.max(peak, wealth);
    maxDrawdown = Math.max(maxDrawdown, (peak - wealth) / peak);
  }
  const mddPct = -(Math.round(maxDrawdown * 10000) / 100);
  if (![alpha90Pct, alpha252Pct, mddPct].every(Number.isFinite)) return fail('performance_calculation_invalid');
  return knownContributionEvidence({ alpha90Pct, alpha252Pct, mddPct }, `${CONTRIBUTION_PERFORMANCE_POLICY}:${source}:provider_adjusted_close:${benchmark[0].date}:${lastDate}`, input.asOf);
}

// Exact Gyeol policy: beta rounded to 2 decimals before cumulative alpha, no risk-free term.
function alpha(portfolio: readonly number[], market: readonly number[]) {
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const mp = mean(portfolio), mm = mean(market), denominator = market.length - 1;
  const covariance = portfolio.reduce((sum, value, index) => sum + (value - mp) * (market[index] - mm), 0) / denominator;
  const variance = market.reduce((sum, value) => sum + (value - mm) ** 2, 0) / denominator;
  if (!(variance > 0)) return null;
  const beta = Math.round(covariance / variance * 100) / 100;
  const rP = Math.exp(portfolio.reduce((sum, value) => sum + value, 0)) - 1;
  const rM = Math.exp(market.reduce((sum, value) => sum + value, 0)) - 1;
  return Math.round((rP - beta * rM) * 10000) / 100;
}
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
