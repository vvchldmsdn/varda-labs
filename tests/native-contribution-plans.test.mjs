import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildNativeContributionPlan, validNativeContributionRequest } from '../src/lib/native-contribution-plan.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', account='11111111-1111-4111-8111-111111111111';
const asset='44444444-4444-4444-8444-444444444444', second='55555555-5555-4555-8555-555555555555', at='2026-09-01T00:00:00.000Z';
const lot={amount:'400',currency:'USD',at,source:'user_native_ledger',remaining:{n:'1',d:'1'}};
function basis(reportingCurrency='USD') {
  const row=(id,value,target,costLots)=>({ allocationKey:id,assetType:'stock',buyable:true,targetWeightBps:target,maRuleEnabled:true,maAssetClass:'large_growth',ma120Evidence:{status:'below_ma',distanceFromMaPct:-10},maBasis:{priceCurrency:'USD',averageCurrency:'USD',priceBasis:'raw',averageBasis:'raw'},metadata:{accountId:account},value:{amount:value,currency:'USD',at,source:'kis'},cost:null,costLots });
  return {status:'ready',scopeKey:'all',scopeLabel:'All',policy:{version:'approved_v1',revision:3,universeHash:'u',vectorHash:'v',effectiveServiceDate:'2026-09-01'},nativeSequences:{[account]:1},names:{[asset]:'A',[second]:'B'},availableCash:[{amount:'20.25',currency:'USD',at,source:'native_ledger_cash',kind:'native_cash',accountId:account}],input:{reportingCurrency,asOf:at,fx:[{base:'USD',quote:'KRW',rate:'1400',observedAt:at,fetchedAt:at,source:'reference',kind:'daily_reference'}],maxFxAgeMs:86400000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,rows:[row(asset,'900',5000,[lot]),row(second,'100',5000,null)]}};
}
const input=(patch={})=>({id:randomUUID(),scopeKey:'all',reportingCurrency:'USD',newMoney:{amount:'10.01',currency:'USD'},useAvailableCash:true,...patch});
const request=(method,body,url='https://local.test/api/native-contribution-plans')=>new Request(url,{method,headers:{origin:'https://local.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const pg=new PGlite(); let route,queries,tenant,subject,context,reads,beforeWrite,failDelete;
before(async()=>{
  await pg.exec(`create role varda_tenant_app; create table app_users(id uuid primary key,status text); insert into app_users values('${owner}','active'),('${other}','active'); create table accounts(id uuid primary key,canonical_owner_user_id uuid,native_state jsonb,is_active boolean default true); grant select on accounts to varda_tenant_app;`);
  for(const file of ['0045_investment_plans.sql','0053_native_contribution_plans.sql']) await pg.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const sql={transaction:async build=>{
    const commands=build({query:(text,params=[])=>({text,params})});
    if(failDelete && commands.some(command=>command.text.startsWith('delete from native_contribution_plans'))) { failDelete=false;throw new Error('temporary delete failure'); }
    if(beforeWrite && commands.some(command=>command.text.includes('insert into native_contribution_plans'))) { const fn=beforeWrite;beforeWrite=null;await fn(); }
    return pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');const results=[];for(const command of commands) results.push((await tx.query(command.text,command.params)).rows);return results;});
  }};
  [route,queries]=await importWithPorts(['src/app/api/native-contribution-plans/route.ts','src/db/queries/native-contribution-plans.ts'],{
    '@/db/tenant-client':{getTenantSqlClient:()=>sql},
    '@/db/queries/native-contribution-context':{readNativeContributionContext:async()=>{reads++;return structuredClone(context);}},
    '@/lib/auth/current-session-subject':{readCurrentSessionSubject:async()=>subject},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:tenant}})},
  });
});
beforeEach(async()=>{
  await pg.exec(`truncate native_contribution_plans,accounts; update app_users set status='active'; insert into accounts(id,canonical_owner_user_id,native_state) values('${account}','${owner}','{"sequence":1}')`);
  tenant=owner;subject={state:'authenticated',provider:'test',providerSubject:'one'};context=basis();reads=0;beforeWrite=null;failDelete=false;
});
after(async()=>{await pg.close();});
async function session() { return (await (await route.GET(request('GET',null,'https://local.test/api/native-contribution-plans?scope=all&currency=USD'))).json()).sessionKey; }
async function asTenant(sql,params=[],who=owner) {return pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query("select set_config('app.current_user_id',$1,true)",[who]);return (await tx.query(sql,params)).rows;});}

it('preserves native funds, cost lots, planned sales and USD cents with the existing policy engine',()=>{
  const plan=buildNativeContributionPlan(basis(),input());assert.equal(plan.status,'ready');
  const result=plan.document.result;
  assert.equal(result.context.profitCurrency,'USD'); assert.equal(result.context.originalFunds[0].amount,'10.01'); assert.equal(result.context.originalFunds[1].amount,'20.25');
  assert.deepEqual(result.context.originalCosts[0].costLots,[lot]);assert.ok(result.sales>0);assert.ok(result.context.plannedSaleProceeds.length>0);
  assert.equal(result.context.plannedSaleProceeds[0].currency,'USD');assert.equal(result.rows[1].sell,0);
  assert.ok(Math.abs(result.available-result.buys-result.remainingCash)<0.000001);
  assert.equal(plan.document.basis.policy.revision,3);assert.equal(plan.document.basis.input.rows[1].maAssetClass,'large_growth');
  const won=buildNativeContributionPlan(basis('KRW'),input({reportingCurrency:'KRW',newMoney:{amount:'1',currency:'KRW'}}));
  assert.equal(won.status,'ready');assert.equal(won.document.result.buys%1,0);
  for(const amount of ['1.001','NaN','1e3','1,000','-1']) assert.equal(validNativeContributionRequest(input({newMoney:{amount,currency:'USD'}})),false);
  assert.equal(validNativeContributionRequest({...input(),rows:[]}),false);
});
it('recomputes on the server and stores an immutable plan with idempotent retry and frozen currency',async(t)=>{
  const oldMode=process.env.NATIVE_LEDGER_ROLLOUT, oldOwners=process.env.NATIVE_LEDGER_QA_OWNERS;
  t.after(()=>{for(const [key,value] of [['NATIVE_LEDGER_ROLLOUT',oldMode],['NATIVE_LEDGER_QA_OWNERS',oldOwners]]) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }});
  delete process.env.NATIVE_LEDGER_ROLLOUT;
  const key=await session(), body={sessionKey:key,request:input()};
  assert.equal((await route.POST(request('POST',body))).status,503);
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,0);
  process.env.NATIVE_LEDGER_ROLLOUT='qa'; process.env.NATIVE_LEDGER_QA_OWNERS=owner;
  const response=await route.POST(request('POST',body));assert.equal(response.status,201);const saved=(await response.json()).plan;
  const original=structuredClone(saved.document);context.input.rows[0].value.amount='1200';context.input.reportingCurrency='KRW';
  const readBefore=reads;assert.equal((await route.POST(request('POST',body))).status,200);assert.equal(reads,readBefore);
  assert.deepEqual((await queries.listNativeContributionPlans({ownerUserId:owner}))[0].document,original);
  assert.equal((await route.POST(request('POST',{...body,request:{...body.request,useAvailableCash:false}}))).status,409);
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,1);
  assert.equal((await pg.query('select native_state from accounts')).rows[0].native_state.sequence,1);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
});
it('enforces tenant RLS, immutable records and inactive user boundaries',async()=>{
  await queries.saveNativeContributionPlan({ownerUserId:owner},input());
  assert.deepEqual(await asTenant('select * from native_contribution_plans',[],other),[]);
  const saved=(await queries.listNativeContributionPlans({ownerUserId:owner}))[0];
  await assert.rejects(asTenant('insert into native_contribution_plans(owner_user_id,id,scope_key,reporting_currency,request_json,document_json) values($1,$2,$3,$4,$5,$6)',[owner,randomUUID(),'all','USD',JSON.stringify(saved.document.request),JSON.stringify(saved.document)],other),/row-level security/);
  await assert.rejects(asTenant("update native_contribution_plans set reporting_currency='KRW'"),/permission denied/);
  assert.deepEqual(await asTenant('delete from native_contribution_plans returning id',[],other),[]);
  await pg.query("update app_users set status='disabled' where id=$1",[owner]);
  assert.deepEqual(await queries.listNativeContributionPlans({ownerUserId:owner}),[]);
  assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'inactive');
});
it('rejects cross-origin, malformed, forged evidence and switched sessions before writes',async()=>{
  const key=await session(), body={sessionKey:key,request:input()};
  const cross=request('POST',body);cross.headers.set('origin','https://foreign.test');assert.equal((await route.POST(cross)).status,400);
  assert.equal((await route.POST(request('POST',{...body,request:{...body.request,fx:[]}}))).status,400);
  subject={state:'authenticated',provider:'test',providerSubject:'two'};tenant=other;
  assert.equal((await route.POST(request('POST',body))).status,409);
  subject={state:'anonymous'};assert.equal((await route.POST(request('POST',body))).status,401);
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,0);
});
it('fails closed for changed holdings, missing approved targets and unknown scope',async()=>{
  beforeWrite=async()=>{await pg.query("update accounts set native_state='{"+'"sequence":2'+"}'");};
  assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'conflict');
  context={status:'blocked',reason:'approved_targets_required'};assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).reason,'approved_targets_required');
  context={status:'blocked',reason:'scope_unavailable'};assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).reason,'scope_unavailable');
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,0);
});
it('rejects saving after an account closes even when its native sequence is unchanged',async()=>{
  beforeWrite=async()=>{await pg.query('update accounts set is_active=false where id=$1',[account]);};
  assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'conflict');
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,0);
});
it('deletes only owned plans with session and origin checks, and supports failure and repeated retry',async()=>{
  const one=input();await queries.saveNativeContributionPlan({ownerUserId:owner},one);
  const key=await session(),body={sessionKey:key,id:one.id};
  const cross=request('DELETE',body);cross.headers.set('origin','https://foreign.test');assert.equal((await route.DELETE(cross)).status,400);
  assert.equal((await route.DELETE(request('DELETE',{...body,id:'bad'}))).status,400);
  tenant=other;subject={state:'authenticated',provider:'test',providerSubject:'two'};
  assert.equal((await route.DELETE(request('DELETE',body))).status,409);
  const otherResult=await route.DELETE(request('DELETE',{...body,sessionKey:await session()}));assert.equal(otherResult.status,200);assert.equal((await otherResult.json()).status,'absent');
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,1);
  subject={state:'anonymous'};assert.equal((await route.DELETE(request('DELETE',body))).status,401);
  tenant=owner;subject={state:'authenticated',provider:'test',providerSubject:'one'};
  failDelete=true;assert.equal((await route.DELETE(request('DELETE',body))).status,503);
  assert.equal((await queries.listNativeContributionPlans({ownerUserId:owner})).length,1);
  const removed=await route.DELETE(request('DELETE',body));assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{status:'deleted',id:one.id});
  const repeated=await route.DELETE(request('DELETE',body));assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),{status:'absent',id:one.id});
  assert.equal((await pg.query('select count(*)::int n from native_contribution_plans')).rows[0].n,0);
  assert.equal((await pg.query('select native_state from accounts')).rows[0].native_state.sequence,1);
});
it('serializes overlapping duplicates and caps retained plans without overwriting evidence',async()=>{
  const one=input();const results=await Promise.all([queries.saveNativeContributionPlan({ownerUserId:owner},one),queries.saveNativeContributionPlan({ownerUserId:owner},one)]);
  assert.deepEqual(results.map(row=>row.status).sort(),['created','existing']);
  for(let i=1;i<20;i++) assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'created');
  assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'limit');
  assert.equal(await queries.deleteNativeContributionPlan({ownerUserId:owner},one.id),true);
  assert.equal((await queries.saveNativeContributionPlan({ownerUserId:owner},input())).status,'created');
});
it('loads approved targets and MA metadata without importing legacy value or cost authority',async()=>{
  const observed={quantity:'10',price:'100',currency:'USD',at,priceObservedAt:at,basis:'raw',source:'kis_live'};
  const evidence={ownerId:owner,reporting:'USD',asOf:at,current:{at,source:'native',scopeComplete:true,positions:[{id:asset,ownerId:owner,accountId:account,name:'Native',kind:'holding',market:'us',ticker:'TEST',observation:observed,costLots:[lot]}]},history:[],trades:[],fx:[],maxFxAgeMs:1,maxPriceAgeMs:1000,ledgerComplete:true,nativeSequences:{[account]:1},contributionPolicy:{trimDriftThresholdPct:12,minimumExecutionRatioPct:85,useTrendFilter:true}};
  const model={status:'ready',policyValidation:{status:'available'},approvedPolicy:{policy:{policyVersion:'approved_v1',approvalRevision:3,universeHash:'u',vectorHash:'v',effectiveServiceDate:'2026-09-01'}},rows:[{accountId:account,assetId:asset,assetName:'Native',market:'us',currency:'USD',ticker:'TEST',buyability:'buyable',targetWeightBps:10000,assetType:'etf',maAssetClass:'thematic',maRuleEnabled:true,currentValueKrw:999999999,costBasisKrw:999999999}]};
  let maInput;
  evidence.nativeSequences[second]=5;
  const [loader]=await importWithPorts(['src/db/queries/native-contribution-context.ts'],{
    '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>({state:'ready',resolution:{state:'resolved',scope:{kind:'all',key:'all',label:'All'}}})},
    '@/db/queries/currency-tracked-portfolio':{getTrackedCurrencyEvidence:async()=>evidence},
    '@/db/queries/portfolio-target-policy':{getReadOnlyTenantPortfolioTargetPolicyModel:async()=>model},
    '@/db/queries/additional-contribution-ma120':{getReadOnlyTenantAdditionalContributionMa120Evidence:async value=>{maInput=value;return {rows:[{instrumentKey:'us:USD:TEST',priceBasis:'private_kis_raw_close',status:'below_ma',evidence:{distanceFromMaPct:-10}}]};}},
  });
  const result=await loader.readNativeContributionContext({ownerUserId:owner},'all','USD');assert.equal(result.status,'ready');
  assert.deepEqual(result.nativeSequences,{[account]:1});
  assert.equal(result.input.rows[0].value.amount,'1000');assert.equal(result.input.rows[0].cost,null);assert.deepEqual(result.input.rows[0].costLots,[lot]);assert.equal(result.input.rows[0].assetType,'etf');assert.equal(result.input.rows[0].maAssetClass,'thematic');assert.equal(result.input.rows[0].ma120Evidence.status,'below_ma');assert.equal(maInput.holdings[0].currentPrice,100);
  model.policyValidation.status='missing';assert.equal((await loader.readNativeContributionContext({ownerUserId:owner},'all','USD')).reason,'approved_targets_required');
});
it('renders a saved USD decision on a KRW page without changing its frozen result or making requests',async()=>{
  const saved=buildNativeContributionPlan(basis(),input()).document;
  const original=structuredClone(saved);
  let position=0;
  const values=[{context:basis('KRW'),sessionKey:'fixture',plans:[{id:saved.request.id,createdAt:at,document:saved}]},'', 'KRW',false,{document:saved,saved:true},'',false];
  const [ui]=await importUiWithPorts(['src/components/native-contribution-planner.tsx'],{
    react:{useState:()=>[values[position++],()=>{}],useRef:()=>({current:null}),useEffect:()=>{}},
    'next/link':{default:({href,children})=>createElement('a',{href},children)},
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'en',t:(_ko,en)=>en})},
    '@/components/first-visit/money-input':{MoneyInput:()=>null},
  });
  const html=renderToStaticMarkup(createElement(ui.NativeContributionPlanner,{scopeKey:'all',currency:'KRW'}));
  assert.match(html,/<h3>Saved plan · USD<\/h3>/);assert.match(html,/Profit currency.*USD/);assert.match(html,new RegExp('href="#native-plan-'+saved.request.id+'"'));
  assert.match(html,/Edit approved targets/);assert.deepEqual(saved,original);
});
