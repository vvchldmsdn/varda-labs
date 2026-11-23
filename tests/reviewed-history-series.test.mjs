import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const [series, contract, display, current] = await importWithPorts([
  'src/lib/cairn-v2/reviewed-history-series.ts', 'src/lib/cairn-v2/read-contract.ts',
  'src/lib/cairn-v2/read-display.ts', 'src/lib/cairn-v2/history-current.ts',
], {});
const dates = ['2026-05-01','2026-05-02','2026-05-03','2026-05-04','2026-05-05'];
const review = { source: series.reviewedSource, basis:'reviewed_holdings_excluding_cash', currency:'KRW',
  startDate:dates[1], endDate:dates[3], excludedLabels:['Synthetic exclusion'], usesEstimates:true,
  points:[{ date:dates[1], valueKrw:110, returnPct:0, dailyReturnPct:null, segment:dates[1], estimated:true },
    { date:dates[2], valueKrw:121, returnPct:10, dailyReturnPct:10, segment:dates[1], estimated:true },
    { date:dates[3], valueKrw:null, returnPct:null, dailyReturnPct:null, segment:null, estimated:false }] };
const base = contract.blankDomainView('ready','');
const scope = { kind:'account', key:'account:synthetic', accountCode:'example' };
const original = dates.map(date => ({ snapshotDate:date, valuationDate:date, storageSnapshotDate:date,
  source:'base44_import', rowKind:'stored', account:'example', derivedFromAccounts:[],
  totalMarketValue:10, totalReturnPct:12, totalPnl:0, cashValue:0 }));
const history = { portfolioRows:original, observationPolicy:'production_observed_v1',
  selectedScope:scope, readStatus:'ready', accountHistoryReview:review };

test('initial and full KRW account views prefer the review, disclose missing dates and preserve original receipts', () => {
  const {view} = contract.applyBetaHistory(base, history, 'KRW');
  const def = display.historySourceView(view).view;
  assert.deepEqual(def.history.map(p => p.valueKrw), [10,110,121,null,10]);
  assert.deepEqual(def.history,view.history);
  assert.deepEqual(display.historySourceView(view,'base44_import').view.history.map(p=>p.valueKrw), dates.map(()=>10));
  assert.notEqual(def.history[0].valueSegment,def.history[1].valueSegment);
  assert.notEqual(def.history[3].valueSegment,def.history[4].valueSegment);
  assert.equal(view.domain.historyRecords,original);
  const live = {...def,totalKrw:400, domain:{...def.domain,valueState:'ready',refreshedAt:dates[2]+'T05:00:00Z'}};
  assert.equal(current.historyWithCurrentValue(live),live);
});

test('USD, group and all-account reads ignore a review even if it is supplied accidentally', () => {
  assert.equal(contract.applyBetaHistory(base,history,'USD').view.domain.accountHistoryReview,null);
  for (const kind of ['all','portfolio_group']) {
    const value=contract.applyBetaHistory(base,{...history,selectedScope:{kind,key:'all'}},'KRW').view;
    assert.equal(value.domain.accountHistoryReview,null);
    assert.ok(value.history.every(p=>p.source!=='broker_account_review_v1'));
  }
});

test('account performance overlays only reviewed dates, including holes, and preserves later live return and basis', () => {
  const performance = {range:{start:dates[0],end:dates[4]},basis:'invested_assets_excluding_cash',
    points:dates.map(date => ({date,returnPct:3,dailyReturnPct:1,segment:dates[0],liveAsOf:date===dates[4]?'live':undefined})),
    gaps:[{start:dates[0],end:dates[4],reason:'trade'}]};
  const revised=series.reviewedPerformance(performance,review);
  assert.deepEqual(revised.points.map(p=>p.returnPct),[3,0,10,null,3]);
  assert.deepEqual(revised.points.map(p=>p.dailyReturnPct),[1,null,10,null,1]);
  assert.deepEqual(revised.points.map(p=>!!p.accountReview),[false,true,true,true,false]);
  assert.equal(revised.points[2].reviewEstimated,true);
  assert.equal(revised.points[4],performance.points[4]);
  assert.deepEqual(revised.gaps,[{start:dates[0],end:dates[0],reason:'trade'},
    {start:dates[3],end:dates[3],reason:'valuation'},{start:dates[4],end:dates[4],reason:'trade'}]);
  assert.equal(series.reviewedPerformance(performance,{...review,startDate:'2027-01-01',endDate:'2027-02-01'}),performance);
});

test('the existing valuation and return charts show the new basis and break at the boundary to the live account', async () => {
  const reviewed = {...review,startDate:dates[0],endDate:dates[2],
    points:dates.slice(0,3).map((date, i)=>({date,valueKrw:100+i,returnPct:i,dailyReturnPct:i || null,segment:dates[0],estimated:false}))};
  const {view} = contract.applyBetaHistory(base,{...history,accountHistoryReview:reviewed,portfolioRows:original.slice(0,3)},'KRW');
  view.totalKrw=415;
  view.domain.refreshedAt=dates[3]+'T04:00:00Z';
  const data=series.reviewedPerformance({range:{start:dates[0],end:dates[3]},points:[{date:dates[3],
    returnPct:15,dailyReturnPct:1,segment:dates[0],liveAsOf:view.domain.refreshedAt}],gaps:[]},reviewed);
  const prefs={metric:'value',period:'ALL',historyDate:dates[1],setHistoryDate(){}};
  const [ui]=await importUiWithPorts(['src/components/cairn-v2/beta-charts.tsx'],{
    'next/dynamic':{default:()=>()=>null},
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'ko',t:ko=>ko})},
    '@/components/use-measured-plot':{useMeasuredPlot:()=>[{width:330,height:180},()=>{}]},
    '@/components/cairn-v2/beta-provider':{useBetaPreferences:()=>prefs},
    '@/components/cairn-v2/home-performance':{usePeriodPerformance:()=>({status:'ready',data}),PerformanceCaption:()=>null,PerformanceStatus:()=>null},
  });
  for (const metric of ['value','return']) {
    prefs.metric=metric;
    const html=renderToStaticMarkup(createElement(ui.HistoryChart,{view,compact:true,interactive:true}));
    assert.match(html,/사용자 확인 복원/);
    assert.match(html,/Synthetic exclusion 제외/);
    assert.match(html,/2026-05-02/);
    assert.doesNotMatch(html,/stroke-dasharray="3 4"/);
    assert.match(html,/data-history-line="true"/);
  }
});
