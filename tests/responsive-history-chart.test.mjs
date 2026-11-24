import assert from 'node:assert/strict';
import {it} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';
import {betaVisualFixture,returnVisualFixture} from './support/beta-visual-fixture.mjs';

it('refreshes a visible return chart after the Korean close with a bounded late-job retry', async () => {
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/home-performance.tsx'], {
    '@/components/cairn-v2/beta-provider': {useBetaPreferences: () => null},
  });
  const next = (at, missing) => new Date(ui.nextPerformanceReadAt(new Date(at), missing)).toISOString();
  assert.equal(next('2026-11-24T06:59:00+09:00', true), '2026-11-23T22:05:00.000Z');
  assert.equal(next('2026-11-24T07:05:00+09:00', true), '2026-11-23T23:05:00.000Z');
  assert.equal(next('2026-11-24T08:05:00+09:00', true), '2026-11-24T15:00:00.000Z');
  assert.equal(next('2026-11-24T06:59:00+09:00', false), '2026-11-23T22:05:00.000Z');
  assert.equal(next('2026-11-24T07:05:00+09:00', false), '2026-11-24T15:00:00.000Z');
});

it('zooms the cumulative return without rebasing or joining an unverified interval', async () => {
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/home-performance.tsx'], {
    '@/components/cairn-v2/beta-provider': {useBetaPreferences: () => null},
  });
  const start='2026-07-26', end='2026-11-23';
  const data={range:{start,end},basis:'invested_assets_excluding_cash',currency:'KRW',points:[
    {date:start,segment:start,dailyReturnPct:null,returnPct:0},
    {date:'2026-09-14',segment:null,dailyReturnPct:null,returnPct:null},
    {date:'2026-11-22',segment:start,dailyReturnPct:null,returnPct:10},
    {date:end,segment:start,dailyReturnPct:1,returnPct:11.1,liveAsOf:'2026-11-23T05:00:00Z'},
  ],gaps:[{start:'2026-09-14',end:'2026-09-14',reason:'trade'},
    {start:'2026-10-19',end:'2026-10-24',reason:'valuation'}]};
  for(const period of ['1M','3M','6M','ALL']) {
    const visible=ui.visiblePerformance(data,period);
    assert.equal(visible.points.at(-1), data.points.at(-1));
    assert.equal(visible.points.at(-1).segment,start);
    assert.equal(visible.points.at(-1).returnPct,11.1);
    assert.equal(visible.points.at(-2).returnPct,10);
    if(period==='1M') {
      assert.deepEqual(visible.gaps,[{start:'2026-10-23',end:'2026-10-24',reason:'valuation'}]);
      assert.equal(visible.points[0].date,'2026-11-22');
    } else assert.equal(visible.points.find(point=>point.date==='2026-09-14').returnPct,null);
  }
  assert.equal(data.gaps[1].start,'2026-10-19');
});

it('keeps linked performance, daily evidence, and separately saved returns distinct in the history detail', async () => {
  const account = '11111111-1111-4111-8111-111111111111';
  const context = {mode:'domain',scope:'account:'+account,currency:'USD',fixture:'standard'};
  const dates = ['2026-11-15','2026-11-16','2026-11-17'];
  const data = {
    basis:'invested_assets_excluding_cash', currency:'KRW', includesCarriedMarks:true,
    range:{start:dates[0],end:dates[2]},
    points:[
      {date:dates[0],segment:dates[0],dailyReturnPct:null,returnPct:0},
      {date:dates[1],segment:dates[0],dailyReturnPct:2.5,returnPct:2.5},
      {date:dates[2],segment:null,dailyReturnPct:null,returnPct:null},
    ],
    gaps:[{start:dates[2],end:dates[2],reason:'trade'}],
  };
  const prefs = {metric:'return',period:'ALL',historyDate:null,setPeriod(){},setMetric(){},setHistoryDate(){}};
  let performance = {status:'ready',data,retry(){}};
  const [ui, history, fixtures, contract] = await importUiWithPorts([
    'src/components/cairn-v2/history-detail.tsx','src/lib/cairn-v2/read-presentation.ts',
    'src/lib/cairn-v2/fixtures.ts','src/lib/cairn-v2/read-contract.ts',
  ],{
    'next/link':{default:({href,children})=>React.createElement('a',{href},children)},
    '@/components/recovery/recovery-notice':{RecoveryNotice:()=>null},
    '@/components/cairn-v2/beta-provider':{useBetaPreferences:()=>prefs,useBetaReadFreshness:()=>null,useBetaExistingCrudAvailable:()=>false},
    '@/components/cairn-v2/home-performance':{
      usePeriodPerformance:()=>performance,PerformanceStatus:()=>React.createElement('p',{role:'status'},'다시 조회'),
    },
    '@/components/cairn-v2/beta-charts':{HistoryChart:()=>null,historyRows:(view,period)=>history.historyRows(view,period)},
  });
  const view = betaVisualFixture(fixtures.getFixtureView({...context,scope:'all'}),contract.blankDomainView('ready',''));
  view.history = [{date:dates[1],valueKrw:41000,exampleReturnPct:99,source:'saved'}];
  view.domain.historyState = 'ready';
  const render = () => renderToStaticMarkup(React.createElement(ui.HistoryDetail,{context,view}));
  let html = render();
  assert.match(html,/원화 기준/); assert.match(html,/2026-11-15 기준 누적 수익률/);
  assert.match(html,/일간 수익률 \+2\.50%/); assert.match(html,/이전에 확인한 평가액/);
  assert.match(html,/\/beta\/history\/events\?[^"]*date=2026-11-16/); assert.match(html,/currency=USD/);
  assert.match(html,/기존 저장·복구 수익률 보기/); assert.doesNotMatch(html,/99\.00/);
  prefs.historyDate = dates[2];
  html = render();
  assert.match(html,/일간 수익률 —/); assert.match(html,/보유 수량 변화와 매매 기록을 맞출 수 없어요/);
  assert.match(html,new RegExp('/beta/portfolio/ledger\\?[^"]*accountId='+account));
  assert.doesNotMatch(html,/history\/events|2026-11-15 기준 누적 수익률/);
  prefs.historyDate = null;
  data.range.end = '2026-11-18';
  data.includesClosingFx = true;
  data.points.push({date:data.range.end,segment:dates[0],dailyReturnPct:null,returnPct:4.5,estimatedFx:true,
    liveAsOf:'2026-11-18T16:12:00Z'});
  html = render();
  assert.match(html,/2026\.11\.18/); assert.match(html,/\+4\.50%/); assert.match(html,/일간 수익률 —/);
  assert.match(html,/누적 변화만 확인/); assert.match(html,/평가 환율을 적용한 추정치/);
  assert.match(html,/잠정 수익률 · 평가 시각/); assert.match(html,/11\.19 01:12 KST/);
  delete data.points.at(-1).liveAsOf;
  data.points.at(-1).returnPct=4.75;
  html=render();
  assert.match(html,/2026\.11\.18/); assert.match(html,/\+4\.75%/); assert.doesNotMatch(html,/잠정 수익률/);
  performance = {status:'error',data:null,retry(){}};
  html = render();
  assert.match(html,/다시 조회/); assert.match(html,/히스토리 기간/); assert.match(html,/히스토리 보기/);
  assert.doesNotMatch(html,/data-history-selected-value|일간 수익률 —/);
});

it('keeps required heatmap weights when the full-app visual fixture is serialized',async()=>{
  const [fixtures,contract]=await importUiWithPorts(['src/lib/cairn-v2/fixtures.ts','src/lib/cairn-v2/read-contract.ts'],{});
  const base=fixtures.getFixtureView({mode:'domain',scope:'all',currency:'KRW',fixture:'standard'});
  const view=JSON.parse(JSON.stringify(betaVisualFixture(base,contract.blankDomainView('ready',''))));
  assert.ok(view.domain.heatmap.history.rows.length>0);
  for(const row of view.domain.heatmap.history.rows){
    assert.ok(Number.isFinite(row.currentWeight),'required numeric field must survive JSON serialization');
    assert.equal(row.currentWeight,base.rows.find(item=>item.key===row.holdingId).weightPct);
  }
});

const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree,...elements(tree.props?.children)];
it('leaves missing return dates blank even when the next measured close shares the same capital base',async()=>{
  const point = (day, returnPct, dailyReturnPct, base) => ({
    date:'2026-11-'+day, returnPct, dailyReturnPct, segment:base && '2026-11-'+base,
  });
  const data = {basis:'invested_assets_excluding_cash',currency:'KRW',gaps:[],points:[
    point('10',0,null,'10'),point('11',1,1,'10'),point('12',null,null,null),
    point('13',2,null,'10'),point('14',null,null,null),point('15',0,null,'15'),
    point('16',-3,-3,'15'),point('17',null,null,null),point('18',1,null,'15'),
    point('19',null,null,null),
  ]};
  let selected=null;
  const [ui]=await importUiWithPorts(['src/components/cairn-v2/beta-charts.tsx'],{
    react:{useContext:()=>null,useId:()=>'period',useState:initial=>[initial,()=>{}]},
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'ko',t:ko=>ko})},
    'next/dynamic':{default:()=>()=>null},
    '@/components/use-measured-plot':{useMeasuredPlot:()=>[{width:330,height:180},()=>{}]},
    '@/components/cairn-v2/beta-provider':{useBetaPreferences:()=>({metric:'return',period:'1M',historyDate:selected,setHistoryDate:date=>{selected=date;}})},
    '@/components/cairn-v2/home-performance':{usePeriodPerformance:()=>({status:'ready',data}),PerformanceCaption:()=>null,PerformanceStatus:()=>null},
  });
  const view={history:[],domain:{state:'ready',historyState:'unavailable',recoveredReturn:{}}};
  const render=()=>elements(ui.HistoryChart({view,compact:true,interactive:true,currency:'USD'}));
  const initial=render();
  assert.equal(initial.filter(node=>node.type==='line' && node.props.y1!==node.props.y2 &&
    node.props.x1!==node.props.x2).length,0,'no diagonal line may span an unobserved date');
  assert.equal(initial.find(node=>node.type==='svg').props['aria-label'].includes('2026-11-18'),true);
  assert.equal(initial.filter(node=>node.props?.['data-history-line'] && node.props.d.includes(' L')).length,2);
  assert.equal(initial.filter(node=>node.props?.['data-history-line']).length,4,'show both valid stretches and the two independent observation points');
  initial.find(node=>node.type==='svg').props.onKeyDown({key:'End',preventDefault(){}});
  assert.equal(selected,'2026-11-19');
  assert.equal(render().some(node=>node.props?.['data-observed-date']==='2026-11-19'),false);
  const live = { ...point('19',3,1.98,'15'), liveAsOf:'2026-11-19T15:11:00Z' };
  data.points[data.points.length-1] = live;
  const preview=render();
  assert.equal(preview.filter(node=>node.props?.['data-observed-date']===live.date).length,1);
  assert.equal(preview.filter(node=>node.type==='path' && node.props.strokeDasharray==='3 4').length,1);
  assert.match(preview.find(node=>node.type==='svg').props['aria-label'],/잠정 수익률 3\.00% · 11\.20 00:11 KST/);
  data.points[data.points.length-2] = point('18',null,null,null);
  assert.equal(render().filter(node=>node.type==='path' && node.props.strokeDasharray==='3 4').length,0);
  data.points[data.points.length-2] = point('18',2,null,'15');
  data.points[data.points.length-1] = point('19',3.5,1.47,'15');
  const finalized=render();
  assert.equal(finalized.filter(node=>node.type==='path' && node.props.strokeDasharray==='3 4').length,0);
  assert.equal(finalized.filter(node=>node.props?.['data-observed-date']===live.date).length,1);
  assert.equal(finalized.some(node=>node.props?.['data-live-as-of']),false);
});
it('reprojects history into measured dimensions while retaining null breaks and date navigation',async()=>{
  let size={width:320,height:220}, selected=null;
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/beta-charts.tsx'],{
    react:{useContext:()=>null,useId:()=> 'chart',useState:initial=>[initial,()=>{}]},'next/dynamic':{default:()=>()=>null},
    '@/components/use-measured-plot':{useMeasuredPlot:()=>[size,()=>{}]},
    '@/components/cairn-v2/beta-provider':{useBetaPreferences:()=>({metric:'value',period:'ALL',historyDate:selected,setHistoryDate:date=>{selected=date;}})},
  });
  const view={history:[{date:'2026-10-01',valueKrw:100},{date:'2026-10-02',valueKrw:110},{date:'2026-10-03',valueKrw:null},{date:'2026-10-04',valueKrw:105}],domain:{state:'ready',historyState:'ready'}};
  const render=()=>elements(ui.HistoryChart({view}));
  for(const dimensions of [{width:320,height:220},{width:900,height:300}]){
    size=dimensions; const tree=render(), svg=tree.find(e=>e.type==='svg');
    assert.equal(svg.props.viewBox,`0 0 ${size.width} ${size.height}`);
    const paths=tree.filter(e=>e.type==='path'&&e.props.fill==='none');assert.equal(paths.length,2,'null day must split the financial series');
    const areas=tree.filter(e=>e.type==='path'&&e.props.fill!=='none');assert.equal(areas.length,1,'only the two adjacent observations have a filled area');
    const last=tree.find(e=>e.type==='circle');assert.equal(last.props.cx,size.width-8);assert.equal(Number(last.props.r),3);
    svg.props.onPointerDown({clientX:16,currentTarget:{getBoundingClientRect:()=>({left:8,width:size.width}),setPointerCapture:()=>{}},pointerId:1});
    assert.equal(selected,'2026-10-01');
    render().find(e=>e.type==='svg').props.onKeyDown({key:'ArrowRight',preventDefault:()=>{}});
    assert.equal(selected,'2026-10-02');selected=null;
  }
});

it('reprojects recovered returns without joining missing days or changing their values',async()=>{
  let size={width:300,height:185}, chosen=null;
  const [ui]=await importUiWithPorts(['src/components/return-timeline-chart.tsx'],{
    react:{useState:initial=>[initial,()=>{}]},
    '@/components/use-measured-plot':{useMeasuredPlot:()=>[size,()=>{}]},
  });
  for(const dimensions of [{width:300,height:185},{width:960,height:300}]){
    size=dimensions;
    const tree=elements(ui.ReturnTimelineChart({...returnVisualFixture,onSelect:date=>{chosen=date;}}));
    const svg=tree.find(e=>e.type==='svg');assert.equal(svg.props.viewBox,`0 0 ${size.width} ${size.height}`);
    assert.equal(tree.filter(e=>e.props?.['data-return-series']==='recoveredPct').length,2);
    const gap=tree.find(e=>e.type==='rect');assert.ok(gap.props.x>=14&&gap.props.x+gap.props.width<=size.width-14);
    svg.props.onPointerDown({type:'pointerdown',clientX:size.width-14,currentTarget:{getBoundingClientRect:()=>({left:0,width:size.width})}});
    assert.equal(chosen,'2026-10-04');
    const missing=elements(ui.ReturnTimelineChart({...returnVisualFixture,selectedDate:'2026-10-02'}));
    assert.ok(missing.some(e=>e.type==='strong'&&e.props.children==='종가 미확인'));
  }
});
