import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {normalizePortfolioTargetUniverse,createPortfolioTargetUniverseHash} from '../src/lib/portfolio-target-policy.ts';

test('approve, revoke, replay and reapprove preserve history and reject stale no-target drafts',async()=>{
  const pg=new PGlite();
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222';
  const scope={kind:'account',key:`account:${account}`,accountId:account,label:'QA'};
  const universe=normalizePortfolioTargetUniverse([{accountId:account,assetId:asset,accountCode:'brokerage',accountName:'QA',assetName:'QA ETF',assetType:'etf',market:'us',currency:'USD',ticker:'VOO',currentValueKrw:1000}]);
  let identity=owner,staleModel=null;
  try{
    await pg.exec(`create table app_users(id uuid primary key); create table accounts(id uuid,canonical_owner_user_id uuid,unique(id,canonical_owner_user_id)); create table portfolio_groups(id uuid,canonical_owner_user_id uuid,unique(id,canonical_owner_user_id)); create table assets(id uuid,account_id uuid,canonical_owner_user_id uuid,unique(id,account_id),unique(id,canonical_owner_user_id));`);
    await pg.exec(readFileSync(new URL('../drizzle/0026_curved_raider.sql',import.meta.url),'utf8'));
    await pg.query('insert into app_users values($1)',[owner]);
    await pg.query('insert into accounts values($1,$2)',[account,owner]);
    await pg.query('insert into assets values($1,$2,$3)',[asset,account,owner]);
    async function model(){
      const latest=(await pg.query('select * from portfolio_target_policy_revisions order by approval_revision desc limit 1')).rows[0];
      const approvedPolicy=latest?.lifecycle_status==='approved'?{status:'available',policy:{approvalRevision:latest.approval_revision}}:{status:'missing',policy:null,lastRevision:latest?.approval_revision??0,explicitlyRevoked:latest?.lifecycle_status==='revoked'};
      return {status:'ready',approvedPolicy,rows:universe.rows,universe,currentUniverseHash:createPortfolioTargetUniverseHash({scope,universe:universe.rows})};
    }
    const [writer]=await importWithPorts(['src/lib/portfolio-target-policy-write.ts'],{
      '@/db/queries/onboarding-instrument-search':{resolveOnboardingInstrumentById:async()=>null},
      '@/db/client':{sqlClient:{transaction:async(build,options)=>{
        assert.equal(options.isolationLevel,'ReadCommitted');
        const commands=build({query:(text,params)=>({text,params})});
        assert.match(commands[2].text,/pg_advisory_xact_lock/,'lock must be acquired before the statement snapshot');
        return pg.transaction(async tx=>{const results=[];for(const c of commands)results.push((await tx.query(c.text,c.params)).rows);return results;});
      }}},
      '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:identity}})},
      '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>({state:'ready',resolution:{state:'resolved',scope}})},
      '@/db/queries/portfolio-target-policy':{getReadOnlyTenantPortfolioTargetPolicyModel:async()=>staleModel??model()},
    });
    function form(approvalRevision,policyRevision,intent='approve'){
      const data=new FormData();for(const [k,v] of Object.entries({scope:scope.key,approvalRevision,policyRevision,intent,rowCount:1,universeHash:createPortfolioTargetUniverseHash({scope,universe:universe.rows}),'targetWeight:0':'100'}))data.set(k,String(v));return data;
    }
    const initial=await model();
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(0,0))).status,'success');
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(1,1,'revoke'))).status,'success');
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(1,1,'revoke'))).status,'success');
    assert.equal((await pg.query('select count(*)::int n from portfolio_target_policy_lifecycle_events')).rows[0].n,2);
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(0,0))).status,'conflict');
    staleModel=initial;
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(0,0))).status,'conflict','SQL CAS also rejects a stale pre-read');
    staleModel=null;
    const renewed=await writer.writeSessionPortfolioTargetPolicy(form(0,1));
    assert.equal(renewed.status,'success');assert.equal(renewed.approvalRevision,2);
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(1,1,'revoke'))).status,'conflict');
    identity='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    assert.equal((await writer.writeSessionPortfolioTargetPolicy(form(2,2,'revoke'))).status,'conflict');
    assert.deepEqual((await pg.query('select lifecycle_status from portfolio_target_policy_revisions order by approval_revision')).rows.map(r=>r.lifecycle_status),['revoked','approved']);
    assert.equal((await pg.query('select count(*)::int n from portfolio_target_policy_rows')).rows[0].n,2);
  }finally{await pg.close();}
});
