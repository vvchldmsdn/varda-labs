import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';

test('display recheck uses active tenant and owned scopes without reading financial data',async()=>{
  let tenant={ownerUserId:'owner-a',role:'user'},failure=null,calls=0;
  let scopes=[{kind:'all',key:'all',label:'All'},{kind:'account',key:'account:a',accountId:'a',accountCode:'a',label:'A'}];
  let unavailable=false;
  const [route]=await importWithPorts(['src/app/api/portfolio/read-session/route.ts'],{
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>failure?{ok:false,failure:{httpStatus:failure}}:{ok:true,tenantContext:tenant}},
    '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async input=>{calls++;assert.equal(input.tenantContext,tenant);return unavailable?{state:'unavailable'}:{state:'ready',catalog:{scopes}};}},
  });
  const get=()=>route.GET(new Request('http://localhost/api/portfolio/read-session'));
  const first=await get(),baseline=(await first.json()).binding;assert.match(baseline,/^[a-f0-9]{64}$/);assert.equal(first.headers.get('Cache-Control'),'private, no-store');
  scopes.reverse();assert.equal((await (await get()).json()).binding,baseline);
  tenant={...tenant,role:'admin'};assert.notEqual((await (await get()).json()).binding,baseline);
  tenant={ownerUserId:'owner-b',role:'user'};assert.notEqual((await (await get()).json()).binding,baseline);
  tenant={ownerUserId:'owner-a',role:'user'};scopes=scopes.filter(row=>row.kind==='all');assert.notEqual((await (await get()).json()).binding,baseline);
  for(const code of [401,403,503]){failure=code;const before=calls;assert.equal((await get()).status,code);assert.equal(calls,before);}
  failure=null;unavailable=true;assert.equal((await get()).status,503);
  assert.equal((await route.GET(new Request('http://localhost/api/portfolio/read-session?owner=other'))).status,400);
});

async function browserHarness(t){
  const effects=[],listeners=new Map(),timers=[];let reloads=0,replacements=0,resolve;
  const root={dataset:{},style:{visibility:'',removeProperty(){this.visibility='';}},isConnected:true};
  const win={location:{href:'http://localhost/beta?mode=domain&scope=all',reload(){reloads++;}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}};
  const doc={visibilityState:'visible',querySelectorAll:()=>[root],addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const originals=new Map(['window','document','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>new Promise(done=>{resolve=done;})});
  const [provider]=await importUiWithPorts(['src/components/cairn-v2/beta-provider.tsx'],{
    react:{createContext:()=>({Provider:()=>null}),useContext:()=>null,useState:init=>[typeof init==='function'?init():init,()=>{}],useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn)},
    'next/navigation':{useRouter:()=>({replace:()=>{replacements++;}})},
  });
  const tree=provider.BetaProvider({children:null}),observed=tree.props.children.props.value.observed;const cleanup=effects.map(fn=>fn());observed('initial',undefined,'same-binding');
  t.after(()=>{cleanup.forEach(fn=>fn?.());for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  return {root,win,doc,listeners,observed,get reloads(){return reloads;},get replacements(){return replacements;},
    blur(){listeners.get('blur')();},focus(){listeners.get('focus')();},
    async response(binding='same-binding',ok=true){resolve({ok,json:async()=>({binding})});for(let i=0;i<5;i++)await Promise.resolve();while(timers.length)timers.shift()();},
  };
}
test('same-session focus preserves displayed values while ownership changes keep them masked',async t=>{
  const b=await browserHarness(t);b.blur();assert.equal(b.root.style.visibility,'hidden');b.focus();await b.response();
  assert.equal(b.root.style.visibility,'');assert.equal(b.replacements,0);assert.equal(b.reloads,0);
  b.blur();b.focus();await b.response('different-binding');assert.equal(b.reloads,1);assert.equal(b.root.style.visibility,'hidden');
});
test('failed checks and stale focus responses cannot unmask a cached financial view',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();await b.response('',false);assert.equal(b.replacements,1);assert.equal(b.root.style.visibility,'hidden');
  b.blur();b.focus();b.blur();await b.response();assert.equal(b.root.style.visibility,'hidden');
  b.focus();b.win.location.href+='&currency=USD';await b.response();assert.equal(b.root.style.visibility,'hidden');
});

test('a late financial read stays masked during a session check and requires a fresh authorized read',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();
  b.observed('late-rsc',undefined,'same-binding');assert.equal(b.root.style.visibility,'hidden');
  await b.response();assert.equal(b.root.style.visibility,'hidden');assert.equal(b.replacements,1);
});

test('focus checks the committed read owner even after a persistent layout has been reused',async t=>{
  const b=await browserHarness(t);b.observed('owner-b-read',undefined,'owner-b');b.blur();b.focus();
  await b.response('same-binding');assert.equal(b.reloads,1);assert.equal(b.root.style.visibility,'hidden');
});
