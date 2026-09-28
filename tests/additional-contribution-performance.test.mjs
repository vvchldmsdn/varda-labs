import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { calculateContributionPerformance } from '../src/lib/additional-contribution-performance.ts';

const now = new Date('2026-09-27T01:00:00Z');
const dates = Array.from({ length: 253 }, (_, i) => new Date(now.getTime() - (253 - i) * 86400000).toISOString().slice(0, 10));
const holdings = [
  { ticker: 'AAA', market: 'korea', currency: 'KRW', currentValue: 750000 },
  { ticker: 'BBB', market: 'korea', currency: 'KRW', currentValue: 250000 },
];
const prices = () => ['AAA', 'BBB', '069500'].flatMap(ticker => dates.map((date, i) => ({
  ticker, market: 'korea', currency: 'KRW', date, source: 'approved_adjusted', priceBasis: 'provider_adjusted_close',
  // Weighted drift = .75*(-.002) + .25*0 = -.0015. Alternating market term cancels over even windows.
  price: 100 * Math.exp((ticker === 'AAA' ? -.002 : 0) * i + (i % 2 ? .01 : 0)),
})));
const run = (patch = {}) => calculateContributionPerformance({ holdings, prices: prices(), reportingCurrency: 'KRW', serviceDate: '2026-09-27', asOf: now.toISOString(), ...patch });

it('uses current weights and Gyeol log-return alpha with independent closed-form expectations', () => {
  // exp(-.0015*90)-1=-12.6284%; exp(-.0015*252)-1=-31.477%; drawdown exp(-.1435)-1=-13.3679%.
  const result = run();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.value, { alpha90Pct: -12.63, alpha252Pct: -31.48, mddPct: -13.37 });
  const equal = run({ holdings: holdings.map(row => ({ ...row, currentValue: 500000 })) });
  assert.deepEqual(equal.value, { alpha90Pct: -8.61, alpha252Pct: -22.28, mddPct: -9.43 });
});

it('rounds beta before computing alpha and has no risk-free subtraction', () => {
  // Two identical assets with log return 1.234*m; m alternates .001/.003.
  // beta=1.23; 90-day alpha=(exp(.22212)-1)-1.23*(exp(.18)-1)=.006143858...; 252-day alpha=.056475295...
  const series = ['AAA', 'BBB', '069500'].flatMap(ticker => dates.map((date, i) => ({
    ticker, market: 'korea', currency: 'KRW', date, source: 'approved_adjusted', priceBasis: 'provider_adjusted_close',
    price: 100 * Math.exp((Math.floor(i / 2) * .004 + (i % 2 ? .001 : 0)) * (ticker === '069500' ? 1 : 1.234)),
  })));
  assert.deepEqual(run({ prices: series }).value, { alpha90Pct: .61, alpha252Pct: 5.65, mddPct: -0 });
});

it('does not normalize away excluded foreign or unknown holdings and rejects USD reporting', () => {
  assert.equal(run({ reportingCurrency: 'USD' }).reason, 'performance_reporting_currency_unsupported');
  for (const change of [{ currency: 'USD' }, { market: 'us' }, { ticker: null }]) {
    assert.equal(run({ holdings: [holdings[0], { ...holdings[1], ...change }] }).status, 'unavailable');
  }
  assert.equal(run({ holdings: [holdings[0], { ...holdings[0] }] }).reason, 'performance_two_instruments_required');
  assert.equal(run({ holdings: [holdings[0], { ...holdings[1], currentValue: Number.NaN }] }).reason, 'performance_weight_invalid');
});

it('requires complete exact dates rather than silently intersecting missing history', () => {
  assert.equal(run({ prices: prices().filter(row => !(row.ticker === 'AAA' && row.date === dates[20])) }).reason, 'performance_253_prices_required');
  const shifted = prices().map(row => row.ticker === 'AAA' && row.date === dates[0] ? { ...row, date: '2025-01-01' } : row);
  assert.equal(run({ prices: shifted }).reason, 'performance_dates_not_aligned');
  assert.equal(run({ serviceDate: '2026-10-10' }).reason, 'performance_history_stale');
});

it('rejects mixed sources, unadmitted raw prices, conflicts and invalid prices', () => {
  assert.equal(run({ prices: prices().map(row => row.ticker === 'AAA' ? { ...row, source: 'other' } : row) }).reason, 'performance_source_mismatch');
  assert.equal(run({ prices: prices().map(row => ({ ...row, priceBasis: 'private_kis_raw_close' })) }).reason, 'performance_raw_price_effect_not_admitted');
  assert.equal(run({ prices: [...prices(), { ...prices()[0], price: 101 }] }).reason, 'performance_price_conflict');
  assert.equal(run({ prices: prices().map((row, i) => i === 0 ? { ...row, price: 0 } : row) }).reason, 'performance_price_invalid');
  assert.equal(run({ prices: [...prices(), prices()[0]] }).status, 'ready');
});

it('requires benchmark variance and preserves neutral ready separately from unavailable', () => {
  const flatMarket = prices().map(row => row.ticker === '069500' ? { ...row, price: 100 } : row);
  assert.equal(run({ prices: flatMarket }).reason, 'performance_benchmark_variance_missing');
  assert.equal(run({ prices: prices().map(row => ({ ...row, price: 100 * Math.exp(dates.indexOf(row.date) % 2 ? .01 : 0) })) }).value.alpha90Pct, 0);
});

it('reads real shared price SQL and admission against isolated PGlite; rejects sample/future/source changes', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create table asset_price_snapshots(ticker text, market text, currency text, date date, close_price numeric,
      adjusted_close_price numeric, adjusted_close_basis text, adjusted_close_provider text, adjusted_close_source text,
      adjusted_close_fetched_at timestamptz, provider_symbol text, provider_exchange text, fetched_at timestamptz,
      source text, is_sample boolean);`);
    const dataset = prices().map(row => ({ ticker: row.ticker, date: row.date, price: row.price }));
    await pg.query(`insert into asset_price_snapshots select ticker,'korea','KRW',date,price,price,'provider_adjusted_close_v1','approved','approved_adjusted',$2::timestamptz,ticker,'KRX',$2::timestamptz,'approved',false from jsonb_to_recordset($1::jsonb) as x(ticker text,date date,price numeric)`, [JSON.stringify(dataset), now.toISOString()]);
    const [query] = await importWithPorts(['src/db/queries/additional-contribution-performance.ts'], {
      '@/db/client': { db: drizzle(pg), sqlClient: () => { throw new Error('unexpected external SQL path'); } },
    });
    const read = (patch = {}) => query.readAdditionalContributionPerformance({ rows: holdings, reportingCurrency: 'KRW', now, ...patch });
    const first = await read();
    assert.deepEqual(first.value, { alpha90Pct: -12.63, alpha252Pct: -31.48, mddPct: -13.37 });
    assert.deepEqual(await read({ now: new Date(now.getTime() + 60000) }), first, 'clock-only refresh preserves evidence version');
    await pg.exec(`update asset_price_snapshots set is_sample=true where ticker='AAA'`);
    assert.equal((await read()).status, 'unavailable');
    await pg.exec(`update asset_price_snapshots set is_sample=false,adjusted_close_fetched_at='2026-09-28T00:00:00Z' where ticker='AAA'`);
    assert.equal((await read()).status, 'unavailable');
    await pg.query(`update asset_price_snapshots set adjusted_close_fetched_at=$1,adjusted_close_provider='other' where ticker='AAA'`, [now.toISOString()]);
    assert.equal((await read()).reason, 'performance_provider_mismatch');
    await pg.exec(`update asset_price_snapshots set adjusted_close_price=null,source='kis',provider_exchange='KRX'`);
    assert.equal((await read()).reason, 'performance_raw_price_effect_not_admitted');
  } finally { await pg.close(); }
});
