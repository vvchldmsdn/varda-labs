import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { observeNativeLedgerClock, nativeLedgerNow, nativeLedgerLocalTime, updateNativeLedgerLocalMinute } from '../src/lib/native-ledger-clock.ts';

const SERVER = '2026-09-27T07:16:48.000Z', serverMs = Date.parse(SERVER);
const accountId = '11111111-1111-4111-8111-111111111111', assetId = '44444444-4444-4444-8444-444444444444';
const account = { id:accountId, name:'Synthetic', active:true,
  state:{sequence:0,positions:[{assetId,quantity:'10',currency:'USD',costLots:null}],cash:{KRW:'0',USD:'1000'}},
  assets:[{id:assetId,name:'Synthetic',currency:'USD',quantity:'10',ticker:'SYN'}] };
const ports = {'next/link':{default:()=>null},'@/components/app-navigation':{AppNavigation:()=>null},
  '@/components/onboarding/instrument-search':{InstrumentSearch:()=>null},'@/components/native-trade-fields':{NativeTradeFields:()=>null},
  '@/components/first-visit/money-input':{MoneyInput:()=>null},
  '@/components/i18n/locale-provider':{useI18n:()=>({t:(ko,en)=>en,locale:'en'})}};
const [ui] = await importUiWithPorts(['src/components/native-ledger-view.tsx'],ports);
function build(at, nowMs, extra={}) { return ui.buildNativeLedgerMutation({account,kind:'buy',fields:{at,assetId,quantity:'1',inputMode:'total',total:'100'},lots:[],operationId:accountId,newAssetId:assetId,confirmed:false,nowMs,...extra}); }
function globalValue(t,name,value) { const original=Object.getOwnPropertyDescriptor(globalThis,name); Object.defineProperty(globalThis,name,{value,configurable:true,writable:true}); t.after(()=>{if(original) Object.defineProperty(globalThis,name,original);else delete globalThis[name];}); }
function deviceClock(t,offset) {const RealDate=Date; globalValue(t,'Date',class extends RealDate {constructor(...args){super(...(args.length ? args : [serverMs+offset]));} static now(){return serverMs+offset;}});}

it('uses elapsed monotonic time without adding latency or trusting device wall-clock adjustments',t=>{
  deviceClock(t,60_000);
  const observed=observeNativeLedgerClock(SERVER,2000);
  assert.equal(nativeLedgerNow(observed,3250),serverMs+1250);
  assert.equal(nativeLedgerNow(observed,1000),serverMs,'a reset monotonic source must not move the estimate into the future');
  assert.throws(()=>observeNativeLedgerClock(undefined,2000),/unavailable/);
  assert.throws(()=>nativeLedgerNow(null,2000),/unavailable/);
});

it('preserves explicitly entered timestamps and rejects future trades and cost evidence against server time',t=>{
  deviceClock(t,60_000);
  const manual='2026-09-27T07:16:40.123Z';
  assert.equal(build(manual,serverMs).event.at,manual);
  assert.throws(()=>build('2026-09-27T07:16:49.000Z',serverMs),/invalid_time/);
  assert.throws(()=>build(SERVER,serverMs,{kind:'cost_basis',lots:[{amount:'100',currency:'USD',at:'2026-09-27T07:16:49.000Z'}]}),/invalid_time/);
});

function elements(tree) {if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(elements);return [tree,...elements(tree.props?.children)];}
function hooks() {
  const state=[],refs=[];let s=0,r=0,effect;
  return {begin(){s=0;r=0;},effect(){effect();},react:{
    useEffect:callback=>{effect??=callback;},
    useState:initial=>{const i=s++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],next=>{state[i]=typeof next==='function'?next(state[i]):next;}];},
    useRef:initial=>{const i=r++;return refs[i]??=( {current:initial} );},
  }};
}
// Real view event handlers with only browser/network ports substituted. Remote
// authenticated browser QA separately covers the actual provider/session/writer.
async function harness(t,offset) {
  deviceClock(t,offset);let monotonic=1000,serverNow=SERVER;const sent=[];
  t.mock.method(performance,'now',()=>monotonic);
  const values=new Map();globalValue(t,'localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  globalValue(t,'navigator',{locks:{request:async(_name,callback)=>callback()}});
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    if(options.method==='POST') {sent.push(JSON.parse(options.body));return Response.json({error:'conflict'},{status:409});}
    return Response.json({serverNow,sessionKey:'a'.repeat(64),accounts:[account],canWrite:true,ordering:[],trades:[]});
  });
  const h=hooks();const [view]=await importUiWithPorts(['src/components/native-ledger-view.tsx'],{...ports,react:h.react});
  const render=()=>{h.begin();return elements(view.NativeLedgerView({compact:true,initialSelection:{accountId,assetId,action:'buy'}}));};
  render();h.effect();await new Promise(resolve=>setImmediate(resolve));
  const findTime=()=>render().find(e=>e.props?.name==='at');
  const trade=render().find(e=>typeof e.props?.edit==='function');trade.props.edit('quantity','1');trade.props.edit('total','100');
  return {render,findTime,sent,advance(){monotonic+=5000;serverNow='2026-09-27T07:16:53.000Z';},
    submit:()=>render().find(e=>e.type==='form').props.onSubmit({preventDefault(){}})};
}

for(const offset of [60_000,-60_000]) it(`uses server-backed defaults and validation when the device is ${offset>0?'ahead':'behind'} by one minute`,async t=>{
  const h=await harness(t,offset);
  assert.equal(new Date(h.findTime().props.value).toISOString(),SERVER);
  await h.submit();
  assert.equal(h.sent.length,1,'the client must dispatch despite its wall-clock difference');
  assert.equal(h.sent[0].mutation.event.at,SERVER);
});

it('retains a manually entered time through server resync and conflict retry',async t=>{
  const h=await harness(t,-60_000),manual='2026-09-27T07:16:40.123Z';
  const local=nativeLedgerLocalTime(Date.parse(manual));
  h.findTime().props.onChange(local);
  await h.submit();h.advance();
  h.render().find(e=>e.type==='button'&&e.props.children==='Review latest holdings').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.findTime().props.value,local);
  await h.submit();
  assert.deepEqual(h.sent.map(row=>row.mutation.event.at),[manual,manual]);
});

it('minute/date edits preserve retained event seconds and milliseconds',()=>{
  assert.equal(updateNativeLedgerLocalMinute('2026-09-28T11:19:18.123','2026-09-29T12:20'),'2026-09-29T12:20:18.123');
  assert.equal(updateNativeLedgerLocalMinute('2026-09-28T11:19','2026-09-29T12:20'),'2026-09-29T12:20:00');
  assert.equal(updateNativeLedgerLocalMinute('2026-09-28T11:19:18.123',''),'2026-09-28T11:19:18.123');
});
