import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const [{ HomeToday }] = await importUiWithPorts(['src/components/cairn-v2/home-today.tsx'], {
  '@/components/cairn-v2/home-impact': { impactTypes: ['price', 'fx'], impactNames: { price: '가격', fx: '환율' } },
});
const movementView = (movement, fxRate = 1300, state = 'ready') => ({
  rows: [], domain: { state, currentHoldingMovement: movement, moneyBasis: { dashboard: { usdKrwRate: fxRate } } },
});
const homeMarkup = (view, currency = 'KRW') => renderToStaticMarkup(createElement(HomeToday, { view, currency }));

it('shows the opening shares and today’s fills in their own currency even when KRW attribution is unavailable', async () => {
  const [{ TodayDetail }, { movementEvidenceRows }] = await importUiWithPorts([
    'src/components/cairn-v2/today-detail.tsx', 'src/lib/cairn-v2/read-contract.ts',
  ], {
    'next/link': { default: () => null },
    '@/components/cairn-v2/beta-provider': { useBetaReadFreshness: () => null },
    '@/components/cairn-v2/home-impact': { impactTypes: ['price', 'fx'], impactNames: { price: '가격', fx: '환율' } },
  });
  const purchase = { openingQuantity: 1, boughtQuantity: 1, averageBuyPrice: 338.50, currentPrice: 337.40,
    buyPriceChangeLocal: -1.10, buyPriceReturnPctLocal: -1.10 / 338.50 * 100, openingPriceChangeLocal: 18.69, totalPriceChangeLocal: 17.59, currency: 'USD' };
  const excluded = { subject: 'holding', holdingId: 'r', ticker: 'TSM', reason: 'missing_trade_fx', localPurchases: purchase };
  const base = { basis: 'execution_adjusted_price_fx', changeKrw: null, returnPct: null, includedCount: 0, excludedCount: 1,
    partial: true, rows: [], exclusions: [excluded] };
  const context = { mode: 'domain', scope: 'account:qa', currency: 'KRW' };
  const details = movement => renderToStaticMarkup(createElement(TodayDetail, { view: movementView(movement), context }));
  const excludedDetail = details(base);
  assert.match(excludedDetail, /체결 환율 확인 필요/);
  assert.match(excludedDetail, /기존 보유 1주<\/dt><dd>\+18.69 USD/);
  assert.match(excludedDetail, /오늘 매수 1주<\/dt><dd>-1.10 USD/);
  assert.match(excludedDetail, /\(-0.32%\)/);
  assert.match(excludedDetail, /가격손익 합계<\/dt><dd>\+17.59 USD/);
  assert.match(homeMarkup(movementView(base)), /1종목 제외/);
  assert.match(homeMarkup(movementView(base)), /원화 변동액 확인 전/);
  assert.doesNotMatch(homeMarkup(movementView(base)), /오늘 변동액/);

  const execution = { ...purchase, soldQuantity: 0, buyAmountKrw: 338500, sellAmountKrw: 0,
    buyMarkChangeKrw: -1100, openingMarkChangeKrw: 18690, sellAdjustmentKrw: 0 };
  const { rows } = movementEvidenceRows({ holdings: [{ id: 'r', ticker: 'TSM', name: 'TSMC', market: 'us', account: 'qa', currency: 'USD' }],
    accountSummaries: [], todayMovement: { exclusions: [], contributionRows: [{
      holdingId: 'r', source: 'daily_position_snapshot', changeKrw: 17590, previousValueKrw: 318710, tradeFlowKrw: 338500,
      currentPrice: 337.40, priceChangeKrw: 17590, fxChangeKrw: 0, returnPct: null, execution,
    }] } });
  const included = { ...base, rows, exclusions: [], excludedCount: 0, includedCount: 1, partial: false, changeKrw: 17590 };
  assert.match(details(included), /오늘 매수 1주<\/dt><dd>-1.10 USD/);
  assert.match(homeMarkup(movementView(included)), /오늘 변동액 · KRW[^>]*>\+17,590/);
});

it('compact home movement preserves signed totals, independent factors and every exclusion reason', () => {
  const view = movementView({ changeKrw: -1000, returnPct: -1.25, includedCount: 2, excludedCount: 2,
    priceChangeKrw: -1500, fxChangeKrw: 500,
    exclusions: [{ subject: 'holding', assetName: '금현물', reason: 'missing_quoted_instrument' },
      { subject: 'holding', assetName: 'VOO', reason: 'missing_baseline_fx' }] });
  const before = structuredClone(view), markup = homeMarkup(view);
  assert.match(markup, /오늘 변동액 · KRW[^>]*>-1,000/);
  assert.match(markup, /-1.25%/);
  assert.match(markup, /-1,500원/); assert.match(markup, /\+500원/);
  assert.match(markup, /<details[^>]*><summary>2종목 제외<\/summary>/);
  assert.match(markup, /금현물 · 비교할 종목 티커 없음/);
  assert.match(markup, /VOO · 기준 환율 없음/);
  assert.deepEqual(view, before);
});

it('unavailable home movement has a concise status while preserving reasons without inventing zero', () => {
  const markup = homeMarkup(movementView({ changeKrw: null, returnPct: null, includedCount: 0, excludedCount: 1,
    exclusions: [{ subject: 'holding', assetName: 'VOO', reason: 'missing_previous_close_fallback' }] }));
  assert.match(markup, /role="status">비교 근거 확인 전/);
  assert.match(markup, /<summary>1종목 제외<\/summary>/);
  assert.match(markup, /VOO · 이전 종가 없음/);
  assert.doesNotMatch(markup, /오늘 변동액|—|0원|0\.00%/);
  const zero = homeMarkup(movementView({ changeKrw: 0, returnPct: 0, includedCount: 1, excludedCount: 0,
    priceChangeKrw: 0, fxChangeKrw: 0, exclusions: [] }));
  assert.match(zero, /오늘 변동액 · KRW[^>]*>0</);
  assert.doesNotMatch(zero, /비교 근거 확인 전/);
});

it('unavailable USD translation retains the valid KRW rate and access guards discard stale movement', () => {
  const movement = { changeKrw: 1300, returnPct: 1, includedCount: 1, excludedCount: 0,
    priceChangeKrw: 1000, fxChangeKrw: 300, exclusions: [] };
  const usd = homeMarkup(movementView(movement, null), 'USD');
  assert.match(usd, /환산할 환율 확인 전/);
  assert.match(usd, /변동률은 KRW 기준/);
  assert.doesNotMatch(usd, /오늘 변동액 · USD/);
  for (const state of ['loading', 'unauthorized']) {
    const guarded = homeMarkup(movementView(movement, 1300, state));
    assert.match(guarded, /비교 근거 확인 전/);
    assert.doesNotMatch(guarded, /1,300|1\.00%|1,000원|300원/);
  }
});

it('retains Today selection across quote reads while using fresh rows and guarding scope/access', async () => {
  let selection = null;
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/today-detail.tsx'], {
    react: { useId: () => 'selection-test', useState: () => [selection, value => { selection = value; }] },
    'next/link': { default: () => null },
    '@/components/cairn-v2/beta-provider': { useBetaReadFreshness: () => null },
    '@/lib/cairn-v2/read-contract': { displayReadMoney: (_view, value) => String(value) },
    '@/lib/cairn-v2/read-display': { movementDisplay: () => ({ message: null }) },
  });
  const row = (key, changeKrw) => ({ key, name: key, ticker: key, accountLabel: 'QA', market: 'us', changeKrw, returnPct: 10, previousValueKrw: 100 });
  const context = { mode: 'domain', scope: 'account:qa', currency: 'KRW' };
  const view = { asOf: '2026-10-29T07:00:00Z', domain: { state: 'ready', moneyBasis: { dashboard: {} }, currentHoldingMovement: { rows: [row('AAA', 30), row('BBB', 10)], exclusions: [] } } };
  const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
  const render = (v = view, c = context) => elements(ui.TodayDetail({ view: v, context: c }));
  const active = tree => tree.find(element => element.type === 'button' && element.props['aria-pressed'])?.props['aria-label'];
  render().find(element => element.type === 'button' && element.props['aria-label']?.startsWith('BBB ')).props.onClick();
  assert.match(active(render()), /^BBB /);
  const updated = { ...view, asOf: '2026-10-29T07:05:00Z', domain: { ...view.domain, currentHoldingMovement: { rows: [row('AAA', 80), row('BBB', 25)], exclusions: [] } } };
  assert.match(active(render(updated)), /^BBB .*25 KRW/, 'New observation must retain identity and display its new value');
  assert.match(active(render(updated, { ...context, scope: 'account:other' })), /^AAA /, 'Scope change must reset selection');
  assert.match(active(render(updated, { ...context, currency: 'USD' })), /^AAA /, 'Currency change must reset selection');
  const removed = { ...updated, domain: { ...updated.domain, currentHoldingMovement: { rows: [row('AAA', 80)], exclusions: [] } } };
  assert.match(active(render(removed)), /^AAA /, 'Removed holding must not reuse stale selected evidence');
  assert.equal(active(render({ ...updated, domain: { ...updated.domain, state: 'unauthorized' } })), undefined);
});
