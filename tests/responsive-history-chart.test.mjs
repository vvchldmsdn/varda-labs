import assert from 'node:assert/strict';
import {it} from 'node:test';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';
import {betaVisualFixture,returnVisualFixture} from './support/beta-visual-fixture.mjs';

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
it('reprojects history into measured dimensions while retaining null breaks and date navigation',async()=>{
  let size={width:320,height:220}, selected=null;
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/beta-charts.tsx'],{
    react:{useId:()=> 'chart'},'next/dynamic':{default:()=>()=>null},
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
