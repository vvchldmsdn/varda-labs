import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { buildCurrentHoldingMovement } from '../src/lib/current-holding-movement.ts';

const walk=node=>node==null||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(walk):[node,...walk(node.props?.children)];
const text=node=>node==null?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
const i18n={'@/components/i18n/locale-provider':{useI18n:()=>({locale:'ko',t:(ko)=>ko})}};
function hooks(seed=[]) {
  const state=[...seed],refs=[];let i=0,r=0;
  return {begin(){i=0;r=0;},react:{useId:()=> 'test-id',useEffect(){},useMemo:fn=>fn(),useCallback:fn=>fn,
    useState:initial=>{const at=i++;if(!(at in state))state[at]=typeof initial==='function'?initial():initial;return [state[at],next=>state[at]=typeof next==='function'?next(state[at]):next];},
    useRef:initial=>refs[r++]??(refs[r-1]={current:initial})}};
}

test('date form rejects missing, invalid, out-of-range and reversed dates in place, then permits a corrected period',async()=>{
  const h=hooks();
  const [ui]=await importUiWithPorts(['src/components/investment-lab/investment-lab-date-inputs.tsx'],{...i18n,react:h.react});
  const render=()=>{h.begin();return ui.InvestmentLabPeriodForm({children:'dates'});};
  for(const [start,end,reason] of [
    ['','2026-09-02','시작 관측일을 선택'],['2026-09-01','','종료 관측일을 선택'],
    ['2026-02-30','2026-09-02','날짜 형식'],['2026-08-31','2026-09-02','2026-09-01 이후'],
    ['2026-09-01','2026-10-01','2026-09-30 이전'],['2026-09-02','2026-09-01','종료 관측일은 시작 관측일보다'],
    ['2026-09-01','2026-09-01','종료 관측일은 시작 관측일보다'],['2026-09-01','2026-09-02',null],
  ]) {
    const invalid=reason!==null;
    let prevented=false,focused=false;
    render().props.onChange();
    assert.equal(render().props.noValidate,true);
    render().props.onSubmit({preventDefault(){prevented=true;},currentTarget:{elements:{namedItem:name=>({value:name==='start'?start:end,min:'2026-09-01',max:'2026-09-30',focus(){focused=true;}})}}});
    assert.equal(prevented,invalid);assert.equal(focused,invalid);
    if(reason)assert.ok(text(render()).includes(reason));else assert.equal(text(render()),'dates');
  }
});

test('selecting an instrument returns keyboard focus before the result button is removed',async()=>{
  const choice={id:'synthetic',name:'Synthetic',ticker:'SYN',market:'us',currency:'USD',assetType:'stock'};
  const h=hooks(['SYN',[choice],'ready']),calls=[];
  const [ui]=await importUiWithPorts(['src/components/onboarding/instrument-search.tsx'],{...i18n,react:h.react});
  const render=()=>{h.begin();return ui.InstrumentSearch({onSelect:value=>calls.push(value.ticker)});};
  const tree=render(),input=walk(tree).find(node=>node.type==='input');
  input.props.ref.current={focus:()=>calls.push('focus')};
  walk(tree).find(node=>node.type==='button').props.onClick();
  assert.deepEqual(calls,['focus','SYN']);
  assert.equal(walk(render()).filter(node=>node.type==='button').length,0);
});

test('trade field names stay stable while required errors are connected as descriptions',async()=>{
  const [ui]=await importUiWithPorts(['src/components/native-trade-fields.tsx'],i18n);
  for(const [name,label,message,fields] of [
    ['quantity','체결 수량','체결 수량을 입력해 주세요.',{}],
    ['price','체결 단가 · USD','체결 단가를 입력해 주세요.',{}],
    ['executionTotal','총 체결금액 · USD','총 체결금액을 입력해 주세요.',{inputMode:'execution_total'}],
  ]) {
    for(const invalid of [false,true]) {
      const html=renderToStaticMarkup(createElement(ui.TradeExecutionFields,{kind:'buy',fields,unit:'USD',quantity:'0',edit(){},locale:'ko',t:ko=>ko,requiredErrors:invalid?[name]:[]}));
      const input=html.match(new RegExp(`<input[^>]+name="${name}"[^>]*>`))?.[0];
      assert.equal(input?.match(/aria-label="([^"]+)"/)?.[1],label);
      if(invalid) {
        assert.match(input,/aria-invalid="true"/);
        const description=input.match(/aria-describedby="([^"]+)"/)?.[1];
        assert.ok(description?.endsWith(`-${name}`));
        assert.ok(html.includes(`<span id="${description}" role="alert">${message}</span>`));
      } else {
        assert.doesNotMatch(input,/aria-invalid|aria-describedby/);
      }
    }
  }
  const optional=renderToStaticMarkup(createElement(ui.TradeExecutionFields,{kind:'buy',fields:{inputMode:'net'},unit:'USD',quantity:'0',edit(){},locale:'ko',t:ko=>ko}));
  assert.match(optional,/aria-label="체결 단가 · USD · 선택"/);
});

test('ready lab price evidence is explicit without claiming all research requirements passed',async()=>{
  const [ui]=await importUiWithPorts(['src/components/holding-analysis-data-panel.tsx'],{
    '@/components/i18n/localized-text':{T:({ko})=>ko},'@/components/holding-analysis-data-form':{HoldingAnalysisDataForm:()=>null},
  });
  const result={state:'ready',entries:[{readiness:{state:'ready'}}]};
  assert.equal(ui.HoldingAnalysisDataPanelView({result}),null);
  const html=renderToStaticMarkup(createElement(ui.HoldingAnalysisDataPanelView,{result,showReadyState:true}));
  assert.match(html,/과거 가격이 준비/);assert.match(html,/각 비교의 계산 가능 여부/);
});

test('all excluded current holdings have a reason while matched return values remain unchanged',()=>{
  const base={legacyBase44Id:null,assetType:'etf',account:'brokerage',market:'korea',currency:'KRW',quantity:10,currentPrice:95,valueKrw:950,priceFetchedAt:'2026-07-08T01:00:00.000Z',priceAsOf:null,priceQuoteType:'live',priceStatus:'ok'};
  const holdings=[{...base,id:'matched',name:'Matched',ticker:'069500'},{...base,id:'unmatched',name:'Missing baseline',ticker:'123456'},{...base,id:'manual-1',name:'No ticker one',ticker:null,assetType:'pension'},{...base,id:'manual-2',name:'No ticker two',ticker:'-',assetType:'pension'}];
  const input={holdings,positionRows:[{id:'snapshot',account:'brokerage',assetId:'matched',legacyAssetId:null,ticker:'069500',assetName:'Matched',assetType:'etf',marketValueKrw:1000,unitPrice:100,closePrice:null,currentPrice:null,fxRate:null,previousFxRate:null}],priceRows:[],baselineDate:'2026-07-07',usdKrwRate:1400,movementCycle:{snapshotDate:'2026-07-08',liveWindowStartAt:new Date('2026-07-07T22:00:00.000Z'),liveWindowEndAt:new Date('2026-07-08T22:00:00.000Z')}};
  const before=structuredClone(input),result=buildCurrentHoldingMovement(input);
  assert.equal(result.includedCount,1);assert.equal(result.excludedCount,3);assert.equal(result.exclusions.length,3);
  assert.deepEqual(result.exclusions.map(row=>row.reason),['missing_baseline_snapshot','missing_quoted_instrument','missing_quoted_instrument']);
  assert.equal(result.changeKrw,-50);assert.equal(result.returnPct,-5);assert.deepEqual(input,before);
});

test('plan display limits percent precision and uses currency minor units without changing calculation values',async()=>{
  const [values,plan]=await importUiWithPorts(['src/components/cairn-v2/reused/saved-plan-values.ts','src/lib/investment-plan.ts'],{});
  const input={currency:'KRW',amount:100,rows:[{name:'A',value:100,targetBps:5000},{name:'B',value:200,targetBps:5000}]};
  const result=plan.calculatePlan(input),before=structuredClone(result);
  assert.equal(values.planValue(result.rows[0].beforePct),'33.33');
  assert.equal(values.planValue(123456.78,'KRW'),'123,457');assert.equal(values.planValue(1234.5,'USD'),'1,234.50');
  assert.deepEqual(result,before);
});

test('simulation Escape clears inspection once and preserves keyboard focus before allowing an outer close',async()=>{
  const h=hooks();
  const [ui]=await importUiWithPorts(['src/components/simulation/simulation-fan-explorer.tsx'],{...i18n,react:h.react,
    '@/components/simulation/simulation-text':{SimulationText:({ko})=>ko,useSimulationText:()=>ko=>ko}});
  const execution={id:'test',name:'Test',assumptions:{horizon:1},bands:[{stepIndex:0,p10:100,p50:100,p90:100},{stepIndex:1,p10:90,p50:100,p90:110}],samplePaths:[],displayPaths:{horizon:1,pathCount:1,values:[100,105]}};
  const render=()=>{h.begin();return ui.SimulationFanExplorer({execution});};
  const slider=()=>walk(render()).find(node=>node.type==='input'&&node.props.type==='range');
  slider().props.onFocus({currentTarget:{value:'1'}});
  const event=()=>({key:'Escape',prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},currentTarget:{blur(){throw Error('must preserve focus');}}});
  const first=event();slider().props.onKeyDown(first);assert.equal(first.prevented,true);assert.equal(first.stopped,true);
  const second=event();slider().props.onKeyDown(second);assert.equal(second.prevented,false);assert.equal(second.stopped,false);
});
