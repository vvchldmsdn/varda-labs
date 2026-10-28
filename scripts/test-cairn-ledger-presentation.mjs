import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(root,'package.json')),ts=require('typescript'),React=require('react');
const originalEntry=path.join(root,'src/components/native-ledger-view.tsx');
const entry=fs.existsSync(originalEntry)?originalEntry:path.join(root,'src/components/cairn-v2/reused/native-ledger-view.tsx');
const originalResolve=Module._resolveFilename,originalTs=Module._extensions['.ts'];
const originalFetch=globalThis.fetch,originalStorage=globalThis.localStorage,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),originalNow=Date.now;
const components=new Map();function stub(name){if(!components.has(name)){const component=()=>null;component.displayName=name;components.set(name,component);}return components.get(name);}
let slots=[],cursor=0,effects=[];
const hooks={...React,useState(initial){const at=cursor++;if(!(at in slots))slots[at]=typeof initial==='function'?initial():initial;return[slots[at],value=>{slots[at]=typeof value==='function'?value(slots[at]):value}]},useRef(initial){const at=cursor++;return slots[at]??(slots[at]={current:initial})},useEffect(effect,deps){const at=cursor++;if(!(at in slots)){slots[at]=deps;effects.push(effect);}}};
const memory=new Map();globalThis.localStorage={get length(){return memory.size},key:i=>[...memory.keys()][i]??null,getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
Module._resolveFilename=function(request,parent,...rest){if(request.startsWith('@/'))request=path.join(root,'src',request.slice(2));return originalResolve.call(this,request,parent,...rest)};
Module._extensions['.ts']=(module,file)=>{assert.ok(file.startsWith(path.join(root,'src')+path.sep));module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file)};
const ledgerModule=new Module(entry);ledgerModule.filename=entry;ledgerModule.paths=Module._nodeModulePaths(path.dirname(entry));const baseRequire=ledgerModule.require.bind(ledgerModule);
ledgerModule.require=request=>{
 if(request==='react')return hooks;
 if(request==='next/link')return{__esModule:true,default:stub('Link')};
 if(request==='@/components/cairn-ui')return new Proxy({},{get:(_target,key)=>stub(String(key))});
 if(request==='./native-locale'||request==='@/components/i18n/locale-provider')return{useI18n:()=>({t:ko=>ko,locale:'ko'})};
 if(request==='./onboarding-instrument-search')return{OnboardingInstrumentSearch:stub('InstrumentSearch')};
 if(request==='@/components/onboarding/instrument-search')return{InstrumentSearch:stub('InstrumentSearch')};
 if(request==='@/components/app-navigation')return{AppNavigation:stub('AppNavigation')};
 if(request==='./native-ledger-timestamp'||request==='@/components/native-ledger-timestamp')return{NativeLedgerTimestamp:stub('Timestamp')};
 if(request==='./native-trade-fields'||request==='@/components/native-trade-fields')return{NativeTradeFields:stub('TradeFields')};
 if(request==='./money-input'||request==='@/components/first-visit/money-input')return{MoneyInput:stub('MoneyInput')};
 if(request.endsWith('.css'))return{__esModule:true,default:new Proxy({},{get:(_target,key)=>String(key)})};
 assert.ok(request!=='server-only'&&!request.includes('/db/'),'presentation test cannot load database modules');return baseRequire(request);
};
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function treeText(node){if(node==null||typeof node==='boolean')return'';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(treeText).join('');return treeText(node.props?.children)}
function find(node,name){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const found=find(child,name);if(found)return found;}return null;}if(node.type?.displayName===name)return node;return find(node.props?.children,name);}
const accountId='11111111-1111-4111-8111-111111111111',assetId='22222222-2222-4222-8222-222222222222',sessionKey='a'.repeat(64);
const account={id:accountId,name:'Synthetic only',active:true,assets:[{id:assetId,name:'Synthetic ETF',ticker:'DEMO',currency:'USD',quantity:'6.177563',archived:false}],state:{version:1,accountId,startedAt:'2026-01-01T00:00:00.000Z',at:'2026-10-26T00:00:00.000Z',sequence:1,cash:{KRW:'0',USD:'0'},positions:[{assetId,currency:'USD',quantity:'6.177563',costLots:null}]}};
let now=Date.parse('2026-10-28T00:00:00.000Z');Date.now=()=>now;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,callback)=>{now+=5000;return callback()}}}});
const requests=[];let stage='network-failure';
globalThis.fetch=async(url,options={})=>{assert.equal(url,'/api/portfolio/ledger');const body=options.body?JSON.parse(options.body):null;requests.push({method:options.method??'GET',body});if(!body)return Response.json({serverNow:'2026-10-28T00:00:00.000Z',sessionKey,accounts:[account],canWrite:true,trades:[]});if(body.mutation?.event){if(stage==='network-failure')throw Error('synthetic lost response');return Response.json({status:'created'});}if(stage==='identity-change')return Response.json({error:'account_changed'},{status:401});return Response.json({status:stage==='committed'?'committed':'pending'});};
try{
 ledgerModule._compile(ts.transpileModule(fs.readFileSync(entry,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,entry);
 const {NativeLedgerView,buildNativeLedgerMutation}=ledgerModule.exports;
 const props={initialSelection:{accountId,assetId,action:'buy'},compact:true};
 const render=()=>{cursor=0;return NativeLedgerView(props)};
 let tree=render();assert.match(treeText(tree),/보유 정보를 확인/);for(const effect of effects.splice(0))effect();await flush();
 tree=render();assert.ok(find(tree,'Form'));const trade=find(tree,'TradeFields');trade.props.edit('quantity','0.010709');trade.props.edit('price','701.263896');
 tree=render();find(tree,'Form').props.onSubmit({preventDefault(){}});await flush();
 tree=render();assert.match(treeText(tree),/확인 중인 기록.*0.010709/);assert.equal(find(tree,'TradeFields').props.fields.quantity,'0.010709','uncertain save keeps draft');
 const mutation=requests.find(r=>r.body?.mutation?.event)?.body.mutation;assert.equal(mutation.event.quantity,'0.010709');assert.equal(mutation.event.price,'701.263896');assert.equal(mutation.event.settlementStatus,'unconfirmed');assert.equal(mutation.event.settlement,undefined,'execution cannot fabricate cash settlement');assert.equal(mutation.expectedSequence,1);
 const stored=JSON.parse([...memory.values()][0]);assert.equal(stored.savedAt,now,'recovery timestamp is sampled after acquiring the lock');const recoveryCopy=JSON.stringify(stored);
 stage='committed';find(tree,'Form').props.onSubmit({preventDefault(){}});await flush();tree=render();assert.doesNotMatch(treeText(tree),/확인 중인 기록:/);assert.equal(memory.size,0);assert.equal(requests.filter(r=>r.body?.mutation?.event).length,1,'committed retry must not resend a mutation');
 // Reloading an unresolved operation restores its display projection, while an
 // identity rejection clears both the synchronous ref and all visible data.
 memory.set('cairn:pending-trade:v1:'+sessionKey,recoveryCopy);slots=[];effects=[];stage='pending';tree=render();for(const effect of effects.splice(0))effect();await flush();tree=render();assert.match(treeText(tree),/확인 중인 기록.*0.010709/);
 stage='identity-change';find(tree,'Form').props.onSubmit({preventDefault(){}});await flush();tree=render();assert.doesNotMatch(treeText(tree),/확인 중인 기록:/);assert.equal(find(tree,'Form'),null,'identity change hides writable form');
 assert.throws(()=>buildNativeLedgerMutation({account,kind:'sell',fields:{assetId,quantity:'9',price:'701.263896',at:'2026-10-27T00:00:00.000Z',inputMode:'execution'},lots:[],operationId:'synthetic',newAssetId:'synthetic',confirmed:false,nowMs:now}),/insufficient_quantity/);
 console.log('Native ledger presentation passed: exact fractional input, no fabricated cash, uncertain draft, retry idempotency, lock-time recovery stamp, identity clearing');
}finally{Module._resolveFilename=originalResolve;if(originalTs)Module._extensions['.ts']=originalTs;else delete Module._extensions['.ts'];globalThis.fetch=originalFetch;if(originalStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=originalStorage;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete globalThis.navigator;Date.now=originalNow;}
