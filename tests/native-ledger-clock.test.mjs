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
  '@/components/i18n/locale-provider':{useI18n:()=>({t:(ko,en)=>en,locale:'en'})},
  '@/components/cairn-v2/reused/onboarding-instrument-search':{OnboardingInstrumentSearch:()=>null},
  '@/components/cairn-v2/reused/native-trade-fields':{NativeTradeFields:()=>null},
  '@/components/cairn-v2/reused/money-input':{MoneyInput:()=>null},
  '@/components/cairn-v2/reused/native-locale':{useI18n:()=>({t:(ko,en)=>en,locale:'en'})}};
const [ui,betaUi] = await importUiWithPorts(['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'],ports);
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
async function harness(t,offset,{entry='src/components/native-ledger-view.tsx',compact=true,trades=[],loseResponse=false,pendingOther=false,otherAccount=false,snapshotAt,postFailure={error:'conflict',status:409}}={}) {
  deviceClock(t,offset);let monotonic=1000,serverNow=SERVER;const sent=[];
  const loadedAccount=snapshotAt?{...account,state:{...account.state,at:snapshotAt}}:account;
  t.mock.method(performance,'now',()=>monotonic);
  const values=new Map();globalValue(t,'localStorage',{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)});
  if(pendingOther){
    const otherId='33333333-3333-4333-8333-333333333333',sid='a'.repeat(64);
    const draft={at:Date.now(),accountId,kind:'buy',fields:{currency:'USD',assetId,quantity:'2',price:'1',inputMode:'execution',historyMode:'yes',replaces:'old',at:'2026-09-26T07:00:00Z'},suspended:{kind:'buy',fields:{currency:'USD',assetId:'new',name:'New A instrument',ticker:'NEWA',quantity:'0.896567',price:'100',inputMode:'execution',at:'2026-09-26T07:00:00Z'}}};
    const drafts=new Map([['cairn:trade-entry:v1:'+sid+':'+accountId+':'+assetId+':buy',JSON.stringify(draft)]]);
    globalValue(t,'sessionStorage',{getItem:k=>drafts.get(k)??null,setItem:(k,v)=>drafts.set(k,v),removeItem:k=>drafts.delete(k)});
    values.set('cairn:pending-trade:v1:'+sid,JSON.stringify({sessionKey:sid,mutation:{accountId:otherId,operationId:'77777777-7777-4777-8777-777777777777',expectedSequence:0,event:{type:'deposit',currency:'USD',amount:'1',at:'2026-09-26T07:00:00Z'}},savedAt:Date.now()}));
  }
  globalValue(t,'navigator',{locks:{request:async(_name,callback)=>callback()}});
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    if(options.method==='POST') {const request=JSON.parse(options.body);sent.push(request);if(pendingOther)return Response.json({status:request.mutation?'created':'committed'});if(loseResponse){if(request.mutation)throw new Error('lost_response');return Response.json({status:'committed'});}return Response.json({error:postFailure.error},{status:postFailure.status});}
    return Response.json({serverNow,sessionKey:'a'.repeat(64),accounts:pendingOther||otherAccount?[loadedAccount,{...account,id:"33333333-3333-4333-8333-333333333333",assets:[],state:{...account.state,positions:[]}}]:[loadedAccount],canWrite:true,ordering:[],trades});
  });
  const h=hooks();const [view]=await importUiWithPorts([entry],{...ports,react:h.react});
  const render=()=>{h.begin();return elements(view.NativeLedgerView({compact,initialSelection:{accountId,assetId,action:'buy'}}));};
  render();h.effect();await new Promise(resolve=>setImmediate(resolve));
  const findTime=()=>render().find(e=>e.props?.name==='at');
  const trade=render().find(e=>typeof e.props?.edit==='function');if(!pendingOther){trade.props.edit('quantity','1');trade.props.edit('price','100');}
  return {render,findTime,sent,advance(){monotonic+=5000;serverNow='2026-09-27T07:16:53.000Z';},
    submit:async(controls=[])=>{render().find(e=>e.type==='form').props.onSubmit({preventDefault(){},currentTarget:{elements:controls}});await new Promise(resolve=>setImmediate(resolve));}};
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
  const retry=h.render().find(e=>e.type==='button'&&e.props.children==='Review latest holdings');
  assert.ok(retry, 'a settled conflict response must expose a retry control');
  retry.props.onClick();
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

function text(node) {if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx']) it(entry+' empty trade fields focus the first missing input without sending a record',async t=>{
  const h=await harness(t,0,{entry}),calls=[];
  const trade=()=>h.render().find(e=>typeof e.props?.edit==='function');
  trade().props.edit('quantity','');trade().props.edit('price','');
  await h.submit(['quantity','price'].map(name=>({name,validity:{valueMissing:true},closest:()=>null,focus:()=>calls.push('focus:'+name),reportValidity:()=>calls.push('report:'+name)})));
  assert.deepEqual(calls,['focus:quantity']);
  assert.deepEqual(trade().props.requiredErrors,['quantity','price']);
  assert.equal(trade().props.fields.quantity,'');assert.equal(h.sent.length,0);
  trade().props.edit('quantity','1');
  assert.deepEqual(trade().props.requiredErrors,['price']);
});
for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx']) it(entry+' retains separate type drafts without leaking a buy fee into exchange',async t=>{
  const h=await harness(t,0,{entry,compact:false});
  const input=()=>h.render().find(e=>typeof e.props?.edit==='function');
  input().props.edit('quantity','0.896567');input().props.edit('price','701.263896');input().props.edit('fee','0.17');
  const selectKind=kind=>h.render().find(e=>e.props?.['aria-label']==='Record type').props.onChange({target:{value:kind}});
  selectKind('exchange');
  const amount=name=>h.render().find(e=>e.props?.['aria-label']===name);
  assert.equal(amount('Separately debited fee USD').props.value,'');
  amount('Amount to exchange USD').props.onValueChange('12.34');
  amount('Amount actually received KRW').props.onValueChange('17000');
  selectKind('buy');assert.equal(input().props.fields.quantity,'0.896567');assert.equal(input().props.fields.fee,'0.17');
  selectKind('exchange');assert.equal(amount('Amount to exchange USD').props.value,'12.34');assert.equal(amount('Amount actually received KRW').props.value,'17000');
  assert.equal(h.sent.length,0);
});
for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx']) {
  it(`${entry} shows the actual cash-event timestamp after switching from a date-only trade`,async t=>{
    const h=await harness(t,0,{entry,compact:false});
    const trade=h.render().find(e=>typeof e.props?.edit==='function');
    trade.props.edit('timePrecision','date_only');trade.props.edit('tradeDate','2026-09-20');
    const summary=()=>h.render().find(e=>e.type==='summary'&&text(e).startsWith('Date & corrections'));
    const selectKind=kind=>h.render().find(e=>e.props?.['aria-label']==='Record type').props.onChange({target:{value:kind}});
    for(const kind of ['buy','sell']) {selectKind(kind);assert.match(text(summary()),/2026-09-20.*Korea time/);}
    selectKind('deposit');
    assert.ok(text(summary()).includes(nativeLedgerLocalTime(serverMs).replace('T',' ').slice(0,16)));
    assert.match(text(summary()),/Device time/);
    assert.doesNotMatch(text(summary()),/2026-09-20|Korea time/);
    h.render().find(e=>typeof e.props?.onValueChange==='function').props.onValueChange('100');
    await h.submit();
    assert.equal(h.sent.length,1);
    assert.equal(h.sent[0].mutation.event.type,'deposit');
    assert.equal(h.sent[0].mutation.event.at,SERVER);
    assert.equal(h.sent[0].mutation.event.dateEvidence,undefined);
  });
}

for (const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx']) it(entry+' separates correction target from new trade fields and restores original input',async t=>{
  const id='22222222-2222-4222-8222-222222222222';
  const event={type:'buy',assetId,quantity:'2',currency:'USD',executionUnitPrice:{amount:'1',currency:'USD'},settlementStatus:'unconfirmed',memo:'old trade',at:'2026-09-26T07:00:00Z'};
  const h=await harness(t,0,{entry,compact:false,trades:[{id,accountId,event}]});
  const input=()=>h.render().find(e=>typeof e.props?.edit==='function');
  input().props.edit('quantity','0.896567');input().props.edit('price','701.263896');input().props.edit('memo','new draft');
  const before={...input().props.fields};
  input().props.edit('historyMode','yes');
  const selector=()=>h.render().find(e=>e.type==='select'&&elements(e).some(child=>child.type==='option'&&child.props.value===id));
  selector().props.onChange({target:{value:id}});
  assert.equal(input().props.fields.quantity,'2');assert.equal(input().props.fields.memo,'old trade');
  assert.equal(input().props.fields.notInOpening,'');
  selector().props.onChange({target:{value:''}});
  assert.equal(input().props.fields.quantity,before.quantity);assert.equal(input().props.fields.price,before.price);assert.equal(input().props.fields.memo,before.memo);
  assert.equal(input().props.fields.replaces,undefined);assert.equal(input().props.fields.notInOpening,undefined);
  input().props.edit('historyMode','');await h.submit();
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].mutation.history,undefined);assert.equal(h.sent[0].mutation.event.quantity,'0.896567');assert.equal(h.sent[0].mutation.event.memo,'new draft');
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' restores a new draft after an uncertain correction is confirmed without duplicate saving',async t=>{
 const id='22222222-2222-4222-8222-222222222222',event={type:'buy',assetId,quantity:'2',currency:'USD',executionUnitPrice:{amount:'1',currency:'USD'},settlementStatus:'unconfirmed',memo:'old trade',at:'2026-09-26T07:00:00Z'};
 const h=await harness(t,0,{entry,compact:false,trades:[{id,accountId,event}],loseResponse:true});
 const input=()=>h.render().find(e=>typeof e.props?.edit==='function');
 for(const [key,value] of Object.entries({quantity:'0.896567',price:'701.263896',memo:'new draft',historyMode:'yes'}))input().props.edit(key,value);
 h.render().find(e=>e.type==='select'&&elements(e).some(child=>child.type==='option'&&child.props.value===id)).props.onChange({target:{value:id}});
 input().props.edit('notInOpening','yes');input().props.edit('reason','correction');
 await h.submit();await h.submit();assert.equal(h.sent.length,2);assert.equal(h.sent[1].mutation,undefined);
 assert.equal(input().props.fields.quantity,'0.896567');assert.equal(input().props.fields.memo,'new draft');assert.equal(input().props.fields.replaces,undefined);
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' restores the account together with its draft after recovering another account pending operation',async t=>{
 const h=await harness(t,0,{entry,compact:false,pendingOther:true});
 const fields=h.render().find(e=>typeof e.props?.edit==='function').props.fields;
 assert.equal(fields.quantity,'0.896567');assert.equal(fields.ticker,'NEWA');
 await h.submit();const mutation=h.sent.find(row=>row.mutation)?.mutation;
 assert.equal(mutation.accountId,accountId);assert.equal(mutation.newAsset.ticker,'NEWA');assert.equal(mutation.event.quantity,'0.896567');assert.equal(mutation.history,undefined);
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' never restores another account kind draft after a cross-tab pending recovery',async t=>{
 const h=await harness(t,0,{entry,compact:false,otherAccount:true,loseResponse:true});
 const selectKind=value=>h.render().find(e=>e.props?.['aria-label']==='Record type').props.onChange({target:{value}});
 const amount=name=>h.render().find(e=>e.props?.['aria-label']===name);
 selectKind('cost_basis');h.render().find(e=>typeof e.props?.onValueChange==='function').props.onValueChange('420');
 selectKind('buy');
 selectKind('exchange');
 amount('Amount to exchange USD').props.onValueChange('12.34');amount('Amount actually received KRW').props.onValueChange('17000');
 selectKind('buy');
 const otherId='33333333-3333-4333-8333-333333333333',sessionKey='a'.repeat(64);
 localStorage.setItem('cairn:pending-trade:v1:'+sessionKey,JSON.stringify({sessionKey,mutation:{accountId:otherId,operationId:'77777777-7777-4777-8777-777777777777',expectedSequence:0,event:{type:'deposit',currency:'USD',amount:'1',at:'2026-09-26T07:00:00Z'}},savedAt:Date.now()}));
 await h.submit();selectKind('exchange');
 assert.equal(h.render().find(e=>e.type==='select').props.value,otherId);
 assert.equal(amount('Amount to exchange USD').props.value,'');assert.equal(amount('Amount actually received KRW').props.value,'');
 selectKind('cost_basis');assert.equal(h.render().find(e=>typeof e.props?.onValueChange==='function').props.value,'');
 assert.ok(h.sent.every(row=>!row.mutation),'recovery may look up a pending request, never create a new transaction');
});

for(const [surface,view] of [['original',ui],['beta',betaUi]]) it(surface+' rejects new trades before the recorded snapshot and requires historical confirmation without changing execution evidence',()=>{
 const snapshotAt='2026-09-27T07:16:40.000Z',previous='2026-09-27T07:16:39.999Z';
 const scopedAccount={...account,state:{...account.state,at:snapshotAt}};
 const fields={at:previous,assetId,quantity:'0.896567',price:'701.263896',inputMode:'execution',currency:'USD',memo:'Verified execution'};
 const make=(kind,patch={})=>view.buildNativeLedgerMutation({account:scopedAccount,kind,fields:{...fields,...patch},lots:[],operationId:accountId,newAssetId:assetId,confirmed:false,nowMs:serverMs});
 for(const kind of ['buy','sell']){
  assert.throws(()=>make(kind),/event_precedes_recorded_snapshot/);
  assert.throws(()=>make(kind,{timePrecision:'date_only',tradeDate:'2026-09-26'}),/event_precedes_recorded_snapshot/);
  assert.equal(make(kind,{at:snapshotAt}).event.at,snapshotAt,'the snapshot boundary itself remains allowed');
  assert.equal(make(kind,{at:SERVER}).event.at,SERVER);
  assert.throws(()=>make(kind,{historyMode:'yes',notInOpening:''}),/opening_confirmation_required/);
  const historical=make(kind,{historyMode:'yes',notInOpening:'yes',reason:'A missing execution'});
  assert.equal(historical.event.at,previous);assert.equal(historical.event.quantity,'0.896567');
  assert.equal(historical.event.price,'701.263896');
  assert.deepEqual(historical.history,{reason:'A missing execution',notInOpening:true});
 }
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' preserves the full trade draft and opens historical confirmation before dispatching a past execution',async t=>{
 const h=await harness(t,0,{entry,snapshotAt:SERVER});
 const input=()=>h.render().find(e=>typeof e.props?.edit==='function');
 const manual=nativeLedgerLocalTime(Date.parse('2026-09-26T07:15:00.123Z'));
 for(const [key,value] of Object.entries({at:manual,timePrecision:'exact',quantity:'0.896567',price:'701.263896',memo:'Keep this draft',notInOpening:'yes',reason:'Old confirmation'}))input().props.edit(key,value);
 const before={...input().props.fields};
 await h.submit();
 assert.equal(h.sent.length,0,'a past execution must not be sent as a new current-state mutation');
 const after=input().props.fields;
 for(const [key,value] of Object.entries(before))if(!['historyMode','notInOpening','reason'].includes(key))assert.equal(after[key],value,key+' must remain unchanged');
 assert.equal(after.historyMode,'yes');assert.equal(after.notInOpening,'');
 assert.equal(after.reason,'Add a missing trade from a photo or manual input');
 const disclosure=h.render().find(e=>e.type==='details'&&elements(e).some(child=>child.type==='summary'&&text(child)==='Historical trade entry / correction'));
 assert.equal(disclosure.props.open,true);
 assert.match(text(h.render()),/Choose historical trade entry to recalculate/);
 await h.submit();assert.equal(h.sent.length,0,'the fresh opening-balance confirmation cannot be skipped');
 assert.equal(input().props.fields.quantity,'0.896567');assert.equal(input().props.fields.memo,'Keep this draft');
 input().props.edit('notInOpening','yes');await h.submit();
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].mutation.event.at,new Date(manual).toISOString());
 assert.equal(h.sent[0].mutation.event.quantity,'0.896567');assert.equal(h.sent[0].mutation.history.notInOpening,true);
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' does not rewrite an unresolved dispatched operation into a historical trade',async t=>{
 const h=await harness(t,0,{entry,snapshotAt:SERVER,postFailure:{error:'event_precedes_recorded_snapshot',status:500}});
 const input=()=>h.render().find(e=>typeof e.props?.edit==='function');
 input().props.edit('memo','Uncertain original request');
 const before={...input().props.fields};await h.submit();
 assert.equal(h.sent.length,1);assert.equal(h.sent[0].mutation.event.at,SERVER);
 assert.deepEqual(input().props.fields,before,'pending evidence must stay exactly as dispatched');
 assert.equal(input().props.fields.historyMode,undefined);
 assert.match(text(h.render()),/The save result is uncertain/);
 assert.ok(h.render().some(e=>e.type==='button'&&text(e)==='Check save / retry'));
});

for(const entry of ['src/components/native-ledger-view.tsx','src/components/cairn-v2/reused/native-ledger-view.tsx'])it(entry+' applies the reviewed photo side and exact amounts, then focuses the form quantity after the photo entry remounts',async t=>{
 const frames=[],focus=[];
 globalValue(t,'requestAnimationFrame',callback=>{frames.push(callback);return frames.length;});
 const h=await harness(t,0,{entry});
 const photo=()=>h.render().find(e=>typeof e.props?.onApply==='function'&&e.props.accountId===accountId);
 const beforeKey=photo().key;
 h.render().find(e=>e.type==='form').props.ref.current={querySelector(selector){focus.push(selector);return {focus(){focus.push('quantity focused');}};}};
 photo().props.onOpenChange(true);
 const fields={quantity:'0.896567',price:'701.263896',executionTotal:'',currency:'USD',inputMode:'execution',executionInputMode:'execution',timePrecision:'exact',tradeDate:'2026-09-27',at:nativeLedgerLocalTime(serverMs)};
 photo().props.onApply({assetId,side:'sell',fields});
 const trade=h.render().find(e=>typeof e.props?.edit==='function');
 assert.equal(trade.props.kind,'sell');assert.equal(trade.props.fields.assetId,assetId);
 for(const [name,value] of Object.entries(fields))assert.equal(trade.props.fields[name],value,name+' must retain the reviewed photo value');
 assert.notEqual(photo().key,beforeKey,'changing buy to sell remounts the photo entry');
 assert.deepEqual(focus,[],'focus waits for the updated trade inputs to render');
 assert.equal(frames.length,1);frames.shift()();
 assert.deepEqual(focus,['input[name="quantity"]','quantity focused']);
 assert.equal(h.sent.length,0,'applying the photo fills the form without recording a trade');
});
