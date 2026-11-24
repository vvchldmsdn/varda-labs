import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const [series, contract, display, current, heatmap, value] = await importWithPorts([
  'src/lib/cairn-v2/reviewed-history-series.ts', 'src/lib/cairn-v2/read-contract.ts',
  'src/lib/cairn-v2/read-display.ts', 'src/lib/cairn-v2/history-current.ts',
  'src/lib/cairn-v2/heatmap-contract.ts', 'src/lib/cairn-v2/current-value-presentation.ts',
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
  assert.deepEqual(def.history.map(p => [p.date,p.valueKrw]), [[dates[0],110],[dates[1],121],[dates[2],null],[dates[3],10],[dates[4],10]]);
  assert.deepEqual(def.history.slice(0,3).map(p => p.storageSnapshotDate), dates.slice(1,4));
  assert.deepEqual(def.history,view.history);
  assert.deepEqual(display.historySourceView(view,'base44_import').view.history.map(p=>p.valueKrw), dates.map(()=>10));
  assert.equal(def.history[0].valueSegment,def.history[1].valueSegment);
  assert.notEqual(def.history[2].valueSegment,def.history[3].valueSegment);
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
  assert.deepEqual(revised.points.map(p=>p.returnPct),[0,10,null,3,3]);
  assert.deepEqual(revised.points.map(p=>p.dailyReturnPct),[null,10,null,1,1]);
  assert.deepEqual(revised.points.map(p=>!!p.accountReview),[true,true,true,false,false]);
  assert.equal(revised.points[1].reviewEstimated,true);
  assert.equal(revised.points[1].segment,dates[0]);
  assert.equal(revised.points[4],performance.points[4]);
  assert.deepEqual(revised.gaps,[{start:dates[2],end:dates[2],reason:'valuation'},{start:dates[3],end:dates[4],reason:'trade'}]);
  assert.equal(series.reviewedPerformance(performance,{...review,startDate:'2027-01-01',endDate:'2027-02-01'}),performance);
});

test('the existing valuation and return charts show the new basis and break at the boundary to the live account', async () => {
  const reviewed = {...review,startDate:dates[0],endDate:dates[3],
    points:dates.slice(0,4).map((date, i)=>({date,valueKrw:100+i,returnPct:i,dailyReturnPct:i || null,segment:dates[0],estimated:false}))};
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
    assert.doesNotMatch(html,/사용자 확인 복원|Synthetic exclusion 제외/);
    const detail = renderToStaticMarkup(createElement(ui.HistoryChart,{view}));
    assert.match(detail,/Synthetic exclusion 제외/);
    assert.match(html,/2026-05-02/);
    assert.doesNotMatch(html,/stroke-dasharray="3 4"/);
    assert.match(html,/data-history-line="true"/);
  }
  prefs.metric='value';
  prefs.historyDate=dates[3];
  const live=renderToStaticMarkup(createElement(ui.HistoryChart,{view,compact:true,interactive:true}));
  assert.match(live,/aria-label="히스토리 날짜 탐색 · 2026-05-04 · 현재 평가액 415원 · 05.04 13:00 KST/);
});

test('the same admitted amount feeds Home and the live chart while its change uses the preserved same-day close', () => {
  const last = '2026-11-24';
  const accountReview = {...review,startDate:last,endDate:last,excludedTickers:['000010'],
    points:[{...review.points[0],date:last,segment:last,valueKrw:17_355_456}]};
  const active = {name:'Active',ticker:'000020',currency:'KRW',market:'korea',account:'brokerage',currentPrice:1000,valueKrw:17_419_955};
  const excluded = {...active,name:'Renamed exclusion',ticker:'000010',valueKrw:100};
  const currentValuePresentation = value.alignCurrentValueWithReview({kind:'legacy',data:{holdings:[active,excluded],
    generatedAt:last+'T11:42:00.000Z',usdKrwRate:1350,totalValueKrw:17_420_055}},accountReview);
  const {view} = contract.applyBetaHistory(base,{...history,portfolioRows:[],accountHistoryReview:accountReview},'KRW');
  view.totalKrw = 5;
  view.domain.currentValuePresentation = currentValuePresentation;
  const projected = current.historyWithCurrentValue(view);
  assert.equal(projected.history.length,2);
  assert.deepEqual(projected.history.map(p=>p.date), ['2026-11-23',last]);
  assert.equal(projected.history[0].storageSnapshotDate,last);
  assert.equal(projected.history[0].valueKrw,17_355_456);
  assert.equal(projected.history[1].valueKrw,current.currentHistoryValuation(view,'KRW').amount);
  assert.equal(projected.history[1].liveAsOf,'2026-11-24T11:42:00.000Z');
  const change = current.todayChangeForHistory(view);
  assert.equal(change.baselineDate,'2026-11-23');
  assert.equal(change.cutoffDate,last);
  assert.equal(change.changeKrw,64_499);
  assert.equal(change.returnPct.toFixed(2),'0.37');
});

test('a quote after midnight remains on the open valuation day until the next 07:00 KST cutoff', () => {
  const cutoff = '2026-11-23';
  const archive = {...review,startDate:cutoff,endDate:cutoff,
    points:[{...review.points[0],date:cutoff,segment:cutoff,valueKrw:100}]};
  const {view} = contract.applyBetaHistory(base,{...history,portfolioRows:[],accountHistoryReview:archive},'KRW');
  view.totalKrw = 110;
  view.domain.refreshedAt = '2026-11-23T21:44:00Z';
  const rows = current.historyWithCurrentValue(view).history;
  assert.deepEqual(rows.map(row=>[row.date,row.valueKrw]), [['2026-11-22',100],['2026-11-23',110]]);
  assert.equal(rows[1].liveAsOf,view.domain.refreshedAt);
  assert.equal(current.todayChangeForHistory(view).baselineDate,'2026-11-22');
});

test('reviewed heatmap displays the marked weekend and Monday close before the separate Tuesday live cell', async () => {
  const calendar = ['2026-11-20','2026-11-21','2026-11-22','2026-11-23','2026-11-24'];
  const cutoffs = calendar.slice(1);
  const points = cutoffs.map((date,index) => {
    const rate = index < 3 ? 1320 : 1330;
    const price = index < 3 ? 10 : 11;
    const position = {key:'USD:VOO',name:'VOO',ticker:'VOO',market:'us',currency:'USD',quantity:1,price,fxRate:rate,valueKrw:price*rate};
    return {...review.points[0],date,valueKrw:position.valueKrw,positions:[position],trades:[]};
  });
  const tuesday = calendar[4];
  const liveCell = {date:tuesday,changePct:9,marketValueKrw:20000,changeKrw:1000,priceChangeKrw:300,fxChangeKrw:700,basis:'live_movement'};
  const read = heatmap.adaptHeatmap({dates:calendar,rows:[{holdingId:'fixture',name:'VOO',ticker:'VOO',market:'us',account:'brokerage',currentWeight:100,cells:[liveCell]}],
    observedCellCount:1,expectedCellCount:5,coveragePct:20},scope.key,tuesday);
  const reviewed = {...review,startDate:cutoffs[0],endDate:cutoffs[3],points};
  const movement = {cutoffDate:tuesday,asOf:'2026-11-24T01:44:00Z',previousValueKrw:14630,currentValueKrw:14850,
    priceChangeKrw:110,fxChangeKrw:110,quantityChangeKrw:0,rows:[{key:'USD:VOO',name:'VOO',ticker:'VOO',market:'us',
      currency:'USD',account:'brokerage',previousValueKrw:14630,currentValueKrw:14850,changeKrw:220,returnPct:220/14630*100,
      priceChangeKrw:110,fxChangeKrw:110,quantityChangeKrw:0}]};
  const model = heatmap.projectReviewedHeatmap(read,reviewed,movement);
  const cells = model.heatmap.history.rows[0].cells;
  assert.equal(model.heatmap.currentDate,tuesday);
  assert.deepEqual(cells.map(cell=>cell.date),calendar);
  assert.deepEqual(cells.map(cell=>cell.basis),['missing','unit_value','unit_value','unit_value','live_movement']);
  assert.deepEqual(cells.slice(1,3).map(cell=>[cell.changePct,cell.priceChangeKrw,cell.fxChangeKrw]),[[0,0,0],[0,0,0]]);
  assert.deepEqual(model.impacts.slice(1),[
    {date:calendar[1],value:13200,price:0,fx:0},
    {date:calendar[2],value:13200,price:0,fx:0},
    {date:calendar[3],value:14630,price:1320,fx:110},
  ]);
  assert.deepEqual(cells[4],{...liveCell,changePct:220/14630*100,marketValueKrw:14850,changeKrw:220,priceChangeKrw:110,fxChangeKrw:110});
  assert.deepEqual(heatmap.projectReviewedHeatmap(read,reviewed).heatmap.history.rows[0].cells[4],liveCell);

  const withoutSaturdayEvidence = {...reviewed,points:points.filter(point=>point.date!==cutoffs[1])};
  const missingCells = heatmap.projectReviewedHeatmap(read,withoutSaturdayEvidence).heatmap.history.rows[0].cells;
  assert.deepEqual(missingCells.slice(1,3).map(cell=>cell.changePct),[null,null]);

  const [ui] = await importUiWithPorts(['src/components/cairn-v2/holding-heatmap.tsx'],{});
  const html = renderToStaticMarkup(createElement(ui.HoldingHeatmap,{view:{...base,domain:{...base.domain,heatmap:model.heatmap}},compact:true}));
  for (const day of calendar.slice(1,3)) assert.match(html,new RegExp(`aria-label="[^\"]*${day} · 단위 평가 변동률 0%"[^>]*>0</button>`));
  assert.match(html,/aria-label="[^"]*현재 2026-11-24 · 현재 평가액 변동률/);
});
