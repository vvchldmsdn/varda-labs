import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reconcileManualCarryWithClose } from '../src/lib/portfolio-dashboard-manual-carry.ts';

const [{ HomeToday }] = await importUiWithPorts(['src/components/cairn-v2/home-today.tsx'], {
  '@/components/cairn-v2/home-impact': { impactTypes: ['price', 'fx'], impactNames: { price: '가격', fx: '환율' } },
});
const movementView = (movement, fxRate = 1300, state = 'ready') => ({
  rows: [], domain: { state, currentHoldingMovement: movement, moneyBasis: { dashboard: { usdKrwRate: fxRate } } },
});
const homeMarkup = (view, currency = 'KRW') => renderToStaticMarkup(createElement(HomeToday, { view, currency }));

it('shows broker equivalents once and keeps unpriced sales separate from a verified zero', async () => {
  const [{RealizedProfitResult}] = await importUiWithPorts(['src/components/cairn-v2/realized-profit-section.tsx'], {});
  const summary = {total:null,verifiedSubtotal:null,through:'2025-05-15',sales:2,valued:0,missingCostSales:2,scopeComplete:false,fees:'separate'};
  const broker = [{accountLabel:'Account',startDate:'2025-04-01',endDate:'2025-05-15',subtotalKrw:'18000',domesticKrw:'10000',overseasUsd:'6.50',overseasBrokerKrw:'8000',
    months:[{month:'2025-04',domesticKrw:'10000',overseasUsd:'6.50',overseasBrokerKrw:'8000'}, {month:'2025-05',domesticKrw:null,overseasUsd:'0',overseasBrokerKrw:null}]}];
  const markup = (ledger, currency) => renderToStaticMarkup(createElement(RealizedProfitResult, {data:{scope:'all',broker,ledger:{KRW:ledger,USD:ledger}},currency}));
  const account = markup(summary, 'KRW');
  assert.match(account,/\+18,000원/); assert.match(account,/\+6\.50 USD/); assert.match(account,/\+8,000원/);
  assert.match(account,/취득원가 미확인 2건/); assert.match(account,/2025-05<\/th><td>—<\/td><td><span[^>]*>0\.00 USD/);
  assert.match(account,/거래 원장 계산분<\/h4><strong>—<\/strong>/);
  assert.match(markup({...summary,total:'0',valued:2,missingCostSales:0,scopeComplete:true}, 'USD'),/거래 원장 계산분<\/h4><strong><span[^>]*>0\.00 USD/);
  const partial = markup({...summary,verifiedSubtotal:'20',valued:1,missingCostSales:1}, 'KRW');
  assert.match(partial,/\+20원/); assert.match(partial,/확인분 소계/);
});

it('includes an unchanged dated manual mark in the verified account value while preserving the quoted subset', () => {
  const cutoffDate = '2026-11-25', source = 'varda_manual_daily_snapshot', account = 'brokerage', currency = 'KRW';
  const holdings = [
    {id:'etf',name:'ETF',quantity:1,valueKrw:900,account,currency},
    {id:'gold',name:'금현물',quantity:2,currentPrice:500,valueKrw:1000,priceSource:'manual_entry',priceQuoteType:'manual_valuation',
      priceStatus:'stored_manual',priceAsOf:'2026-11-23T13:00:00Z',account,currency},
  ];
  const positions = holdings.map(h => ({assetId:h.id,account,currency,source,snapshotDate:cutoffDate,quantity:h.quantity,
    marketValueKrw:1000,unitPrice:h.id==='gold'?500:1000,fxRate:1,priceSource:h.priceSource,priceBasis:h.id==='gold'?'manual_current':'close'}));
  const exclusion = {holdingId:'gold',subject:'holding',reason:'missing_quoted_instrument',assetName:'금현물'};
  const movement = {excludedCount:1,includedCount:1,exclusions:[exclusion],partial:true,changeKrw:-100,returnPct:-10,
    previousValueKrw:1000,priceChangeKrw:-100,fxChangeKrw:0};
  const input = {holdings,positions,movement,closingRows:[{snapshotDate:cutoffDate,source,totalMarketValue:2000}],
    cutoffDate,cycleStart:new Date('2026-11-24T22:00:00Z'),hasCycleEvents:false};
  const view = movementView(movement);
  Object.assign(view.domain, {manualCarryClose:reconcileManualCarryWithClose(input),valueState:'ready',refreshedAt:'2026-11-25T01:00:00Z'});
  view.totalKrw=1900;
  assert.match(homeMarkup(view),/-5\.00%/);
  assert.match(homeMarkup(view),/금현물 수동 평가액 유지/);
  assert.match(homeMarkup(view),/-100원/);
  view.totalKrw=1800;
  assert.match(homeMarkup(view),/-10\.00%/);
  assert.doesNotMatch(homeMarkup(view),/수동 평가액 유지/);
  const second = {...holdings[1], id:'other-manual',name:'기타 실물자산'};
  const both = {...input, holdings:[...holdings,second], positions:[...positions,{...positions[1],assetId:second.id}],
    closingRows:[{...input.closingRows[0],totalMarketValue:3000}],
    movement:{...movement,excludedCount:2,exclusions:[exclusion,{...exclusion,holdingId:second.id}]}};
  view.totalKrw=2900;
  view.domain.manualCarryClose=reconcileManualCarryWithClose(both);
  assert.match(homeMarkup(view),/-3\.33%/);
  assert.match(homeMarkup(view),/금현물, 기타 실물자산 수동 평가액 유지/);
  assert.equal(reconcileManualCarryWithClose({...both,positions:[...positions,{...both.positions[2],priceSource:null}]}),null);
  for (const patch of [{hasCycleEvents:true},{positions:positions.slice(1)},
    {holdings:[holdings[0],{...holdings[1],priceAsOf:'2026-11-25T00:00:00Z'}]},
    {positions:[positions[0],{...positions[1],priceBasis:'close'}]},
    {positions:[positions[0],{...positions[1],quantity:1}]},
    {closingRows:[{...input.closingRows[0],totalMarketValue:1900}]}]) {
    assert.equal(reconcileManualCarryWithClose({...input,...patch}),null);
  }
});

it('keeps the restored close, today totals and per-holding price, FX and quantity changes on one basis', async () => {
  const [{ TodayDetail }, { projectReviewedCurrentMovement }] = await importUiWithPorts([
    'src/components/cairn-v2/today-detail.tsx', 'src/lib/cairn-v2/reviewed-current-movement.ts',
  ], {
    'next/link': { default: () => null },
    '@/components/cairn-v2/beta-provider': { useBetaReadFreshness: () => null },
    '@/components/cairn-v2/home-impact': { impactTypes: ['price', 'fx'], impactNames: { price: '가격', fx: '환율' } },
  });
  const view = movementView({
    changeKrw: 999, returnPct: 1, includedCount: 1, excludedCount: 0, priceChangeKrw: 999, fxChangeKrw: 0,
    rows: [{ key: 'wrong', name: 'Legacy-only', changeKrw: 999 }],
  }, 1400);
  const voo = { name: 'VOO', ticker: 'VOO', account: 'qa', market: 'us', currency: 'USD' };
  const local = { name: '국내 ETF', ticker: '123456', account: 'qa', market: 'korea', currency: 'KRW' };
  view.domain.currentValuePresentation = { kind: 'legacy', data: {
    generatedAt: '2026-11-24T01:44:00.000Z', usdKrwRate: 1400, totalValueKrw: 869500,
    holdings: [{ ...voo, quantity: 5, currentPrice: 110, valueKrw: 770000 },
      { ...local, quantity: 10, currentPrice: 9950, valueKrw: 99500 }],
  } };
  view.domain.accountHistoryReview = { points: [{ date: '2026-11-24', valueKrw: 620000, positions: [
    { ...voo, key: 'USD:VOO', quantity: 4, price: 100, fxRate: 1300, valueKrw: 520000 },
    { ...local, key: 'KRW:123456', quantity: 10, price: 10000, fxRate: 1, valueKrw: 100000 },
  ] }] };
  const movement = projectReviewedCurrentMovement(view);
  assert.ok(movement);
  assert.equal(movement.priceChangeKrw, 51500);
  assert.equal(movement.fxChangeKrw, 44000);
  assert.equal(movement.quantityChangeKrw, 154000);
  assert.equal(movement.rows.reduce((sum, row) => sum + row.changeKrw, 0), 249500);
  assert.equal(movement.priceChangeKrw + movement.fxChangeKrw + movement.quantityChangeKrw, 249500);
  view.domain.reviewedCurrentMovement = movement;
  view.domain.accountHistoryReview.points[0].positions = undefined; // Client receives only the projected rows.
  const home = homeMarkup(view);
  assert.match(home, /\+249,500/);
  assert.match(home, /\+40\.24%/);
  assert.match(home, /\+51,500원/);
  assert.match(home, /\+44,000원/);
  assert.match(home, /수량·기타/);
  assert.doesNotMatch(home, /\+999원/);
  const context = { mode: 'domain', scope: 'account:qa', currency: 'KRW' };
  const detailMarkup = () => renderToStaticMarkup(createElement(TodayDetail, { view, context }));
  const detail = detailMarkup();
  assert.match(detail, /2026-11-23 평가액/);
  assert.match(detail, /2026-11-24 오전 7시 저장/);
  assert.match(detail, /620,000/);
  assert.match(detail, /869,500/);
  assert.match(detail, /VOO.+\+250,000/);
  assert.match(detail, /국내 ETF.+-500/);
  assert.doesNotMatch(detail, /Legacy-only/);

  view.domain.currentValuePresentation.data.totalValueKrw++;
  assert.doesNotMatch(homeMarkup(view), /\+51,500원/);
  assert.match(detailMarkup(), /종목별 근거가 아직 없어요/);
});

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
