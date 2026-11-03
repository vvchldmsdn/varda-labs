import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';
import {createElement, Suspense} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

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
  const effects=[],listeners=new Map(),timers=new Map(),requests=[],replacedHrefs=[];let reloads=0,timerId=0;
  const newRoot=()=>({dataset:{},style:{visibility:'',removeProperty(){this.visibility='';}},isConnected:true});
  let root=newRoot(),roots=[root];
  const win={location:{href:'http://localhost/beta?mode=domain&scope=all',reload(){reloads++;}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  const doc={visibilityState:'visible',querySelectorAll:selector=>selector==='[data-beta-freshness-mask]'?roots.filter(row=>row.dataset.betaFreshnessMask):roots,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const originals=new Map(['window','document','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperty(globalThis,'window',{configurable:true,value:win});Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:()=>new Promise((resolve,reject)=>{requests.push({resolve,reject});})});
  const [provider]=await importUiWithPorts(['src/components/cairn-v2/beta-provider.tsx'],{
    react:{createContext:()=>({Provider:()=>null}),useContext:()=>null,useState:init=>[typeof init==='function'?init():init,()=>{}],useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn)},
    'next/navigation':{useRouter:()=>({replace:href=>{replacedHrefs.push(href);}})},
  });
  const tree=provider.BetaProvider({children:null}),{observed,store}=tree.props.children.props.value;const cleanup=effects.map(fn=>fn());observed('initial',undefined,'same-binding');
  t.after(()=>{cleanup.forEach(fn=>fn?.());for(const [key,value] of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
  const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
  return {get root(){return root;},win,doc,listeners,observed,store,get reloads(){return reloads;},get replacements(){return replacedHrefs.length;},get replacement(){return replacedHrefs.at(-1);},get pendingRequests(){return requests.length;},
    removeRoot(){root.isConnected=false;roots=[];},
    mountRoot(){root=newRoot();roots=[root];return root;},
    blur(){listeners.get('blur')();},focus(){listeners.get('focus')();},
    async response(binding='same-binding',ok=true){requests.shift().resolve({ok,json:async()=>({binding})});await settle();},
    async reject(){requests.shift().reject(new Error('session_request_failed'));await settle();},
    settle,
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

test('navigation during a delayed session response refreshes the destination and recovers after a fresh read',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();
  b.win.location.href='http://localhost/beta/history?mode=domain&scope=all';
  b.removeRoot();b.mountRoot();b.observed('cached-history',undefined,'same-binding');
  await b.response();
  const epoch=b.store.pendingEpoch();assert.ok(epoch);assert.equal(b.replacements,1);
  assert.equal(new URL(b.replacement,'http://localhost').pathname,'/beta/history');
  assert.equal(new URL(b.replacement,'http://localhost').searchParams.get('_betaRead'),epoch);
  assert.equal(b.root.style.visibility,'hidden');assert.equal(b.store.blocked('cached-history'),true);
  b.observed('fresh-history',epoch,'same-binding');
  assert.equal(b.store.blocked('fresh-history',epoch),false);assert.equal(b.root.style.visibility,'');
});

test('a detached root is rechecked even when navigation keeps the same URL',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();b.removeRoot();b.mountRoot();
  b.observed('replacement-root',undefined,'same-binding');await b.response();
  assert.equal(b.replacements,1);assert.equal(b.root.style.visibility,'hidden');
  assert.equal(b.store.blocked('replacement-root'),true);
  b.observed('fresh-root',b.store.pendingEpoch(),'same-binding');assert.equal(b.root.style.visibility,'');
});

test('a root-free loading interval bars cached reads before the next owner view commits',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();b.removeRoot();
  b.win.location.href='http://localhost/beta?mode=domain&scope=account%3Ab';
  await b.response('owner-b');
  const epoch=b.store.pendingEpoch();assert.ok(epoch);assert.equal(b.replacements,1);
  assert.equal(b.store.blocked('initial'),true);assert.equal(b.reloads,0);
  b.mountRoot();b.observed('fresh-owner-b',epoch,'owner-b');
  assert.equal(b.store.blocked('fresh-owner-b',epoch),false);assert.equal(b.root.style.visibility,'');
  assert.equal(b.store.blocked('initial'),true);
  b.blur();b.focus();await b.response('owner-b');
  assert.equal(b.reloads,0);assert.equal(b.root.style.visibility,'');
  b.blur();b.focus();await b.response('owner-c');
  assert.equal(b.reloads,1);assert.equal(b.root.style.visibility,'hidden');
});

test('suspending and resuming without a root requires a new epoch before cached content returns',async t=>{
  const b=await browserHarness(t);b.removeRoot();b.blur();b.focus();await b.settle();
  assert.equal(b.pendingRequests,0);assert.equal(b.replacements,1);assert.equal(b.store.blocked('initial'),true);
  b.mountRoot();b.observed('fresh-after-loading',b.store.pendingEpoch(),'same-binding');assert.equal(b.root.style.visibility,'');
});

test('a failed session request after navigation rechecks the destination instead of leaving it masked forever',async t=>{
  const b=await browserHarness(t);b.blur();b.focus();b.win.location.href+='&currency=USD';await b.reject();
  assert.equal(b.replacements,1);assert.equal(b.store.blocked('initial'),true);assert.equal(b.root.style.visibility,'hidden');
  b.observed('fresh-after-failure',b.store.pendingEpoch(),'same-binding');assert.equal(b.root.style.visibility,'');
});

test('beta loading and pending layout admission expose only a neutral shell',async()=>{
  let finishSession;
  const [loading,layout]=await importUiWithPorts(['src/app/beta/loading.tsx','src/app/beta/layout.tsx'],{
    '@/components/i18n/management-text':{ManagementText:({children})=>children},
    '@/lib/cairn-v2/server-access':{requireBetaFixtureAccess:async()=>{},betaUsesSharedService:async()=>true},
    '@/lib/cairn-v2/server-management-access':{betaAccountManagementAvailable:async()=>true},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:()=>new Promise(resolve=>{finishSession=resolve;})},
    '@/components/portfolio-read-access-boundary':{PortfolioReadAccessBoundary:()=>createElement('p',null,'Access withheld')},
    '@/components/cairn-v2/beta-provider':{BetaProvider:({children})=>createElement('div',null,children)},
  });
  const markup=renderToStaticMarkup(createElement(loading.default));
  assert.match(markup,/role="status"/);assert.match(markup,/aria-busy="true"/);assert.match(markup,/Cairn Labs/);
  assert.doesNotMatch(markup,/<nav|<a\s|data-beta-root|private-account|123456/);
  const shell=layout.default({children:createElement('p',null,'private-account 123456')});
  assert.equal(shell.type,Suspense);assert.equal(shell.props.fallback.type,loading.default);
  const authorized=shell.props.children;let settled=false;
  const pending=authorized.type(authorized.props).then(value=>{settled=true;return value;});
  for(let i=0;i<5;i++)await Promise.resolve();assert.equal(settled,false);
  finishSession({ok:false,failure:{httpStatus:401}});
  const denied=renderToStaticMarkup(await pending);assert.match(denied,/Access withheld/);assert.doesNotMatch(denied,/private-account|123456/);
});
