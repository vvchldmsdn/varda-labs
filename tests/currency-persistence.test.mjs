import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { createQuickDraft } from '../src/lib/quick-portfolio.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const input={version:2,currency:'USD',source:'manual',locale:'en',timeZone:'America/New_York',asOf:'2026-09-02T00:00:00Z',rows:[{name:'VOO',value:1000.25,inputCurrency:'USD',instrumentId:'us-voo'}]};

it('applies currency migration locally and preserves owner-bound activation, cents, duplicate retries and legacy JSON',async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`create role varda_tenant_app; create table app_users(id uuid primary key,status text not null); insert into app_users values('${owner}','active'),('${other}','active');
      create table fx_rates(id int, usdkrw numeric, fetched_at timestamptz);`);
    for(const file of ['0045_investment_plans.sql','0046_portfolio_drafts.sql','0048_reporting_currency_inputs.sql']) await pg.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
    await assert.rejects(pg.query("insert into fx_rates(id,usdkrw,observed_at,fetched_at) values(1,1400,'2026-09-01','2026-09-02')"));
    const sql={transaction:async(build)=>pg.transaction(async tx=>{
      await tx.exec('set local role varda_tenant_app'); const out=[];
      for(const command of build({query:(text,params=[])=>({text,params})})) out.push((await tx.query(command.text,command.params)).rows);
      return out;
    })};
    let subject='verified-user', authenticated=true;
    const [route,queries,plans]=await importWithPorts(['src/app/api/portfolio-activation/route.ts','src/db/queries/portfolio-drafts.ts','src/db/queries/investment-plans.ts'],{
      '@/db/tenant-client':{getTenantSqlClient:()=>sql},
      '@/lib/auth/current-session-subject':{readCurrentSessionSubject:async()=>authenticated?{state:'authenticated',provider:'neon',providerSubject:subject}:{state:'unauthenticated'}},
      '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:owner}})},
      '@/lib/auth/self-service-tenant-onboarding-write':{createCurrentSessionTenant:async()=>{throw new Error('must not create account for linked user');}},
    });
    const req=(method,body)=>new Request('https://local.test/api/portfolio-activation',{method,headers:{origin:'https://local.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const key=(await (await route.GET(req('GET'))).json()).sessionKey;
    const draft=createQuickDraft(input);
    assert.equal((await route.POST(req('POST',{draft,sessionKey:key}))).status,201);
    assert.equal((await route.POST(req('POST',{draft,sessionKey:key}))).status,200);
    const saved=await queries.listPortfolioDrafts({ownerUserId:owner}); assert.deepEqual(saved[0].input,input);
    assert.deepEqual(await queries.listPortfolioDrafts({ownerUserId:other}),[]);
    assert.equal(await queries.deletePortfolioDraft({ownerUserId:other},draft.id),false);
    subject='other-session'; assert.equal((await route.POST(req('POST',{draft,sessionKey:key}))).status,409);
    authenticated=false; assert.equal((await route.POST(req('POST',{draft,sessionKey:key}))).status,401);
    const old={currency:'KRW',rows:[{name:'Old',value:1000,instrumentId:null}]};
    const oldId='11111111-1111-4111-8111-111111111111';
    assert.equal((await queries.savePortfolioDraft({ownerUserId:owner},oldId,old)).status,'created');
    assert.equal((await queries.savePortfolioDraft({ownerUserId:owner},oldId,old)).status,'existing');
    assert.equal((await pg.query('select engine_version from portfolio_drafts where id=$1',[oldId])).rows[0].engine_version,'amount_composition_v1');
    const plan={version:2,asOf:input.asOf,currency:'USD',amount:.01,rows:[{name:'VOO',value:1000.25,targetBps:10000}]};
    assert.equal((await plans.saveInvestmentPlan({ownerUserId:owner},oldId,plan)).status,'created');
    assert.equal((await plans.saveInvestmentPlan({ownerUserId:owner},oldId,plan)).status,'existing');
    assert.deepEqual((await plans.listInvestmentPlans({ownerUserId:owner}))[0].input,plan);
    const names=(await pg.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row=>row.tablename);
    assert.deepEqual(names,['app_users','fx_rates','investment_plans','portfolio_drafts']); // no invented accounts/holdings/trades
  } finally { await pg.close(); }
});
