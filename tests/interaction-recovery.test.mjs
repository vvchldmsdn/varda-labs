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

test('home contribution keeps detail entry to expand and allocation controls and validates their current input', async () => {
  const runtime = hooks();
  const [{ ContributionEntry }] = await importUiWithPorts(['src/components/cairn-v2/home-contribution-entry.tsx'], {
    react: runtime.react,
    '@/components/cairn-v2/home-contribution': { ContributionHome: () => null },
  });
  const opens = [];
  const render = cashAmountKrw => {
    runtime.begin();
    const card = ContributionEntry({
      view: {}, context: { currency: 'KRW', cashAmountKrw }, dirty: false, colors: [],
      onCalculate: () => assert.fail('render should not calculate'),
      onView: (trigger, amount) => opens.push([trigger, amount]),
    });
    return card.type(card.props);
  };
  const button = (tree, label) => walk(tree).find(node => node.type === 'button' &&
    (node.props['aria-label'] === label || text(node).trim() === label));
  const input = tree => walk(tree).find(node => node.type === 'input');
  const opening = { kind: 'open' }, submit = { kind: 'submit' };
  const empty = render(undefined);
  assert.equal(button(empty, '추가 투자'), undefined);
  assert.equal(empty.props.onClick, undefined);
  button(empty, '추가 투자 확대').props.onClick({ currentTarget: opening });
  assert.deepEqual(opens.pop(), [opening, undefined], 'the untouched expand control can open an empty form or recovery link');

  input(render('1000000')).props.onChange({ target: { value: '300.0001' } });
  const edited = render('1000000');
  button(edited, '추가 투자 확대').props.onClick({ currentTarget: opening });
  walk(edited).find(node => node.props.type === 'submit').props.ref.current = submit;
  walk(edited).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(opens, [opening, submit].map(trigger => [trigger, '3000001']));

  input(edited).props.onChange({ target: { value: '' } });
  const invalid = render('1000000');
  let focused = false;
  input(invalid).props.ref.current = { focus: () => { focused = true; } };
  button(invalid, '추가 투자 확대').props.onClick({ currentTarget: opening });
  assert.equal(focused, true);
  assert.equal(input(render('1000000')).props['aria-invalid'], true);
  assert.equal(opens.length, 2, 'clearing a submitted amount cannot open its old result');
});

test('home contribution debounces recalculation while keeping its last read and waits for explicit dialog opening', async (t) => {
  const runtime = hooks();
  let effect;
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/home-contribution-entry.tsx'], {
    react: { ...runtime.react, useEffect: callback => { effect = callback; } },
    '@/components/cairn-v2/home-contribution': { ContributionHome: () => null },
  });
  const calls = [];
  const view = { domain: { planning: { contribution: { state: 'ready', inputKrw: 1000000 } } } };
  const render = (amount = '1000000') => {
    runtime.begin();
    return ui.ContributionEntry({ view, context: { currency:'KRW', cashAmountKrw:amount }, dirty:false, colors:[],
      onCalculate: value => calls.push(value), onView: () => assert.fail('automatic calculation opened the dialog') });
  };
  const input = tree => walk(tree).find(node => node.props.inputMode === 'decimal');
  const summary = tree => walk(tree).find(node => node.props.view === view && 'pendingAmount' in node.props);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  input(render()).props.onChange({ target:{ value:'200' } });
  const first = render();
  assert.equal(summary(first).props.pendingAmount, 2000000);
  assert.equal(summary(first).props.dirty, false);
  const cancel = effect();
  t.mock.timers.tick(250);
  input(first).props.onChange({ target:{ value:'300' } });
  render();
  cancel();
  effect();
  t.mock.timers.tick(449);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['3000000']);
  assert.equal(input(render('3000000')).props.value, '300');
  assert.equal(summary(render('3000000')).props.pendingAmount, 3000000);
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

test('current basket separates offsetting local price and FX moves using the same comparable quantities', async () => {
  const base = {
    assetType: 'etf', account: 'brokerage', quantity: 2, priceStatus: 'ok',
    priceQuoteType: 'live', priceFetchedAt: '2026-07-08T01:00:00Z',
  };
  const usd = { ...base, id: 'us', ticker: 'VOO', name: 'VOO', market: 'us', currency: 'USD', currentPrice: 90, valueKrw: 252000 };
  const krw = { ...base, id: 'kr', ticker: '069500', name: 'KODEX 200', market: 'korea', currency: 'KRW', currentPrice: 105, valueKrw: 210 };
  const input = {
    holdings: [usd, krw], priceRows: [], usdKrwRate: 1400, baselineDate: '2026-07-07',
    movementCycle: {snapshotDate:'2026-07-08',liveWindowStartAt:new Date('2026-07-07T22:00:00Z'),liveWindowEndAt:new Date('2026-07-08T22:00:00Z')},
    positionRows: [usd, krw].map(h => ({ id: h.id + '-prev', assetId: h.id, account: h.account, unitPrice: 100, quantity: 1, fxRate: h.currency === 'USD' ? 1300 : null })),
  };
  const result = buildCurrentHoldingMovement(input);
  assert.deepEqual(result.rows.map(r => [r.priceChangeKrw, r.fxChangeKrw]), [[-26000, 18000], [10, 0]]);
  assert.deepEqual([result.priceChangeKrw, result.fxChangeKrw, result.changeKrw], [-25990, 18000, -7990]);
  const [contract] = await importUiWithPorts(['src/lib/cairn-v2/read-contract.ts'], {});
  const evidence = contract.movementEvidenceRows({holdings: input.holdings, todayMovement: {contributionRows: result.rows, exclusions: result.exclusions}});
  assert.deepEqual(evidence.rows.map(r => [r.ticker,r.priceChangeKrw,r.fxChangeKrw]), [['VOO',-26000,18000], ['069500',10,0]]);
  const partial = buildCurrentHoldingMovement({...input, positionRows: input.positionRows.map(row => ({...row, fxRate:null}))});
  assert.deepEqual([partial.priceChangeKrw, partial.fxChangeKrw, partial.excludedCount], [10, 0, 1]);
  const missing = buildCurrentHoldingMovement({...input, positionRows: []});
  assert.deepEqual([missing.changeKrw, missing.priceChangeKrw, missing.fxChangeKrw], [null, null, null]);
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
