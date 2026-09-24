import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { executionFixture } from './support/shared-execution-fixture.mjs';
import { packExecution,decodePath,EXECUTION_POLICY } from '../src/lib/simulation-execution-codec.ts';
import { projectPath } from '../src/lib/simulation-path-detail-store.ts';
import { sharedExecutionEnabled,sharedExecutionCleanupEnabled,sharedExecutionOwnerEnabled } from '../src/lib/simulation-execution-availability.ts';
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function fixture() {
  let afterLookup;
  const pg=new PGlite();
  await pg.exec("create role varda_tenant_app nosuperuser nobypassrls; create table app_users(id uuid primary key,status text); grant usage on schema public to varda_tenant_app;");
  await pg.exec(readFileSync(new URL('../drizzle/0045_investment_plans.sql',import.meta.url),'utf8'));
  await pg.exec(readFileSync(new URL('../drizzle/0054_simulation_executions.sql',import.meta.url),'utf8'));
  await pg.exec(readFileSync(new URL('../drizzle/0055_simulation_execution_admission.sql',import.meta.url),'utf8'));
  await pg.exec("update simulation_execution_service set enabled=true,qa_only=false,max_creating=4,max_hourly=100,owner_interval_seconds=0,cleanup_succeeded_at=clock_timestamp()");
  await pg.query("insert into app_users values($1,'active'),($2,'active')",[A,B]);
  const metrics={requests:0,requestBytes:0,responseBytes:0};
  const client={transaction:async(build)=>{
    const queries=build({query:(sql,params=[])=>({sql,params})});
    metrics.requests++;metrics.requestBytes+=Buffer.byteLength(JSON.stringify(queries));
    const rows=await pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');const result=[];for(const q of queries)result.push((await tx.query(q.sql,q.params)).rows);return result;});
    metrics.responseBytes+=Buffer.byteLength(JSON.stringify(rows));
    if(afterLookup && queries.some(q=>q.sql.startsWith('select id from simulation_executions'))) { const callback=afterLookup;afterLookup=undefined;await callback(); }
    return rows;
  }};
  const adminClient={query:async(sql,params)=> (await pg.query(sql,params)).rows,transaction:async build=>pg.transaction(async tx=>{const result=[];for(const q of build({query:(sql,params=[])=>({sql,params})}))result.push((await tx.query(q.sql,q.params)).rows);return result;})};
  const [store,cleanup]=await importWithPorts(['src/db/queries/simulation-execution-storage.ts','src/db/queries/simulation-execution-cleanup.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>client},'@/db/client':{sqlClient:adminClient}});
  return {pg,store,cleanup,metrics,setAfterLookup:callback=>{afterLookup=callback;}};
}

test('global admission enforces QA, cooldown, capacity, cleanup freshness and private policy access', async()=>{
  const {pg,store,cleanup}=await fixture();
  try {
    await pg.query('update simulation_execution_service set enabled=false');
    assert.equal(await store.canAdmitSharedExecution(A),false);
    await pg.query('update simulation_execution_service set enabled=true,qa_only=true,qa_owners=$1::uuid[],owner_interval_seconds=60,max_count=1',[[A]]);
    assert.equal(await store.canAdmitSharedExecution(B),false);
    const p=packExecution(A,executionFixture());
    await store.beginSharedExecution(A,p);
    assert.equal((await pg.query('select retained,creating,used_bytes::text from simulation_execution_service')).rows[0].used_bytes,String(p.bytes));
    await pg.query('update simulation_execution_service set qa_only=false');
    await assert.rejects(store.beginSharedExecution(B,packExecution(B,executionFixture())),/execution_service_limit/);
    assert.equal((await pg.query('select count(*)::int as n from simulation_executions')).rows[0].n,1);
    await pg.query('delete from simulation_executions where owner_user_id=$1',[A]);
    const usage=(await pg.query('select retained,creating,used_bytes::text,hourly from simulation_execution_service')).rows[0];
    assert.deepEqual(usage,{retained:0,creating:0,used_bytes:'0',hourly:1});
    assert.equal(await store.canAdmitSharedExecution(A),false,'delete must not reset owner frequency');
    assert.equal(await store.canAdmitSharedExecution(B),true);
    await pg.query("update simulation_execution_service set cleanup_succeeded_at=clock_timestamp()-interval '27 hours'");
    assert.equal(await store.canAdmitSharedExecution(B),false);
    const jobs=await Promise.all([cleanup.cleanupSimulationExecutions(),cleanup.cleanupSimulationExecutions()]);
    assert.deepEqual(jobs.map(j=>j.status).sort(),['busy','completed']);
    assert.equal(await store.canAdmitSharedExecution(B),true);
    await pg.query('update simulation_execution_service set max_hourly=1');
    assert.equal(await store.canAdmitSharedExecution(B),false,'delete must not refund hourly frequency');
    for(const table of ['simulation_execution_service','simulation_execution_frequency']) {
      await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query(`select * from ${table}`);}),/permission denied/);
      await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query(`delete from ${table}`);}),/permission denied/);
    }
  } finally { await pg.close(); }
});

test('release rollout is closed by default and admits only explicitly allowed owners',()=>{
  const env={VERCEL_ENV:'production',SIMULATION_EXECUTION_STORAGE_ENABLED:'true',SIMULATION_EXECUTION_CLEANUP_ENABLED:'true',SIMULATION_EXECUTION_ENVIRONMENT:'production'};
  assert.equal(sharedExecutionOwnerEnabled(env,A),false);
  Object.assign(env,{SIMULATION_EXECUTION_ROLLOUT:'qa',SIMULATION_EXECUTION_QA_OWNERS:A});
  assert.equal(sharedExecutionOwnerEnabled(env,A),true);assert.equal(sharedExecutionOwnerEnabled(env,B),false);
  assert.equal(sharedExecutionOwnerEnabled({...env,SIMULATION_EXECUTION_ENVIRONMENT:'preview'},A),false);
});
test('shared SQL writer/query preserves both exact engine models, retries, owner and bounded reads',async()=>{
  const {pg,store,metrics}=await fixture();
  try { for(const model of ['economic','bootstrap']) {
    const s=executionFixture(model), packed=packExecution(A,s);
    const before=performance.now(),saved=await store.saveSharedExecution(A,packed);
    assert.equal(saved.status,'ready');const storedMs=performance.now()-before;
    const oldBytes=metrics.responseBytes, requests=metrics.requests, readAt=performance.now();
    const result=await store.readSharedExecution(A,saved.handle,141);
    assert.equal(result.ok,true); assert.equal(result.detail.pathIndex,141);
    // Persistence identity: every holding, factor and historical draw equals the
    // original C projection from the still-intact source, not a new simulation.
    assert.deepEqual(result.detail,projectPath(s,packed.id,141));
    for(let step=0;step<=s.horizon;step++) assert.equal(Number(result.detail.portfolio[step].toPrecision(7)),s.chart[141*(s.horizon+1)+step]);
    assert.equal(result.detail.model,model);assert.equal(metrics.requests-requests,2);
    console.info('shared SQL PGlite metrics',JSON.stringify({model,storedMs,readMs:performance.now()-readAt,...metrics,selectedWireReadBytes:metrics.responseBytes-oldBytes}));
    assert.equal((await store.saveSharedExecution(A,packed)).handle.executionId,packed.id);
    const changed=packExecution(A,{...s,seed:99},packed.id);
    assert.equal((await store.saveSharedExecution(A,changed)).status,'conflict');
    s.growth.fill(42); // Immutable DB result is unaffected by current caller/input changes.
    assert.deepEqual(await store.readSharedExecution(A,saved.handle,141),result);
    assert.equal((await store.readSharedExecution(B,saved.handle,141)).status,404);
    assert.equal((await store.readSharedExecution(A,{...saved.handle,executionId:randomUUID()},141)).status,404);
    assert.equal((await store.readSharedExecution(A,{...saved.handle,currency:'USD'},141)).status,409);
    assert.equal((await store.readSharedExecution(A,saved.handle,1000)).status,400);
    const c=(await pg.query("select current_setting('app.current_user_id',true) as v")).rows[0].v;assert.ok(c==null||c==='');
  }
  assert.equal((await store.saveSharedExecution(A,packExecution(A,executionFixture()))).status,'limit');
  const role=(await pg.query("select rolsuper,rolbypassrls from pg_roles where rolname='varda_tenant_app'")).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false});
  await pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query("select set_config('app.current_user_id',$1,true)",[B]);assert.equal((await tx.query('select * from simulation_executions')).rows.length,0);assert.equal((await tx.query('select * from simulation_execution_chunks')).rows.length,0);});
  await pg.query("update app_users set status='disabled' where id=$1",[A]);
  await pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query("select set_config('app.current_user_id',$1,true)",[A]);assert.equal((await tx.query('select * from simulation_executions')).rows.length,0);});
  } finally {await pg.close();}
});
test('partial upload cannot become ready, retry completes exact pieces and deletion cascades',async()=>{
  const {pg,store}=await fixture();try {
    const p=packExecution(A,executionFixture()); assert.equal(await store.beginSharedExecution(A,p),'creating');
    await store.appendSharedExecution(A,p,p.chunks.slice(0,4));
    await assert.rejects(()=>store.finishSharedExecution(A,p));
    assert.equal((await pg.query('select state from simulation_executions')).rows[0].state,'creating');
    assert.equal((await store.saveSharedExecution(A,packExecution(A,executionFixture()))).status,'limit');
    const saved=await store.saveSharedExecution(A,p);assert.equal(saved.status,'ready');
    assert.equal(await store.deleteSharedExecution(B,saved.handle),false);
    assert.equal(await store.deleteSharedExecution(A,saved.handle),true);
    assert.equal((await pg.query('select count(*)::int as n from simulation_execution_chunks')).rows[0].n,0);
    assert.equal((await store.readSharedExecution(A,saved.handle,141)).status,404);
    const again=await store.saveSharedExecution(A,packExecution(A,executionFixture()));
    await pg.query('delete from app_users where id=$1',[A]);
    assert.equal((await store.readSharedExecution(A,again.handle,141)).status,404);
  }finally{await pg.close();}
});
test('codec preserves Float64 and exact path identity and refuses corrupted/oversized bytes',()=>{
  const s=executionFixture(),p=packExecution(A,s),h={executionId:p.id,binding:p.binding,model:p.model,currency:p.currency,preview:false,expiresAt:1};
  const chunk=p.chunks[17],detail=decodePath(h,141,p.common,chunk);
  assert.equal(detail.assets[0].values[8],s.assets[0].weightBps/10000*s.growth[(141*22+8)*3]*100);
  assert.throws(()=>decodePath(h,133,p.common,chunk));
  assert.throws(()=>decodePath(h,141,p.common,{...chunk,data:'aaaa'}));
  assert.throws(()=>decodePath(h,141,p.common,{...chunk,rawBytes:EXECUTION_POLICY.chunkRaw+1}));
  assert.throws(()=>decodePath(h,141,p.common,{...chunk,checksum:'0'.repeat(64)}));
});
test('production admission requires separate explicit environment and cleanup activation',()=>{
  const env={NODE_ENV:'production',VERCEL_ENV:'production',SIMULATION_EXECUTION_STORAGE_ENABLED:'true',SIMULATION_EXECUTION_CLEANUP_ENABLED:'true',SIMULATION_EXECUTION_ENVIRONMENT:'production'};
  assert.equal(sharedExecutionEnabled(env),true);
  assert.equal(sharedExecutionEnabled({...env,SIMULATION_EXECUTION_ENVIRONMENT:'preview'}),false);
  assert.equal(sharedExecutionEnabled({...env,SIMULATION_EXECUTION_CLEANUP_ENABLED:undefined}),false);
  assert.equal(sharedExecutionEnabled({NODE_ENV:'production'}),false);
  assert.equal(sharedExecutionCleanupEnabled({...env,SIMULATION_EXECUTION_STORAGE_ENABLED:'false'}),true);
});
test('refresh and interrupted identical rendering reuse one execution and its original expiry',async()=>{
  const {pg,store}=await fixture();try {
    const s=executionFixture(),p=packExecution(A,s);
    await store.beginSharedExecution(A,p);await store.appendSharedExecution(A,p,p.chunks.slice(0,4));
    const restored=await store.saveRenderedExecution(A,packExecution(A,s));assert.equal(restored.status,'ready');assert.equal(restored.handle.executionId,p.id);
    for(let i=0;i<3;i++) assert.deepEqual((await store.saveRenderedExecution(A,packExecution(A,s))).handle,restored.handle);
    assert.equal((await pg.query('select count(*)::int as n from simulation_executions')).rows[0].n,1);
  }finally{await pg.close();}
});

test('another render finishing between lookup and admission still reuses the winning execution',async()=>{
  const {pg,store,setAfterLookup}=await fixture();try {
    const s=executionFixture(),winner=packExecution(A,s);let first;
    setAfterLookup(async()=>{first=await store.saveSharedExecution(A,winner);});
    const second=await store.saveRenderedExecution(A,packExecution(A,s));
    assert.equal(first.status,'ready');assert.deepEqual(second.handle,first.handle);
    assert.equal((await pg.query('select count(*)::int as n from simulation_executions')).rows[0].n,1);
  }finally{await pg.close();}
});

test('shared read outage returns retryable error without generating another execution',async()=>{
  let calls=0;
  const [store]=await importWithPorts(['src/db/queries/simulation-execution-storage.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>({transaction:async()=>{calls++;throw Error('offline');}})}});
  const h={executionId:randomUUID(),binding:'a'.repeat(64),model:'economic',currency:'KRW',expiresAt:1,preview:false};
  for(let i=0;i<2;i++) assert.deepEqual(await store.readSharedExecution(A,h,141),{ok:false,status:503,error:'detail_unavailable'});
  assert.equal(calls,2);
});
test('expiry, incomplete cleanup, corruption and version errors stay scoped and do not replay',async()=>{
  const {pg,store,cleanup}=await fixture();try {
    const p=packExecution(A,executionFixture()),saved=await store.saveSharedExecution(A,p),h=saved.handle;
    // Administrator test-fixture mutation only: simulates damaged persisted bytes.
    await pg.query("update simulation_execution_chunks set data=decode('AAAA','base64') where owner_user_id=$1 and execution_id=$2 and chunk_index=17",[A,p.id]);
    assert.equal((await store.readSharedExecution(A,h,141)).status,422);
    await pg.exec('alter table simulation_executions disable trigger simulation_execution_immutable');
    await pg.query("update simulation_executions set codec='future-version' where owner_user_id=$1 and id=$2",[A,p.id]);
    assert.equal((await store.readSharedExecution(A,h,141)).error,'unsupported_version');
    await pg.query("update simulation_executions set codec='path-f64le-gzip-v1',expires_at=clock_timestamp()-interval '1 second' where owner_user_id=$1 and id=$2",[A,p.id]);
    const expires=Number((await pg.query('select (extract(epoch from expires_at)*1000)::bigint as expires from simulation_executions where owner_user_id=$1 and id=$2',[A,p.id])).rows[0].expires);
    const expiredHandle={...h,expiresAt:expires};
    assert.equal((await store.readSharedExecution(A,expiredHandle,141)).status,410);
    assert.equal((await store.readSharedExecution(B,expiredHandle,141)).status,404);
    await pg.exec('alter table simulation_executions enable trigger simulation_execution_immutable');
    const other=await store.saveSharedExecution(B,packExecution(B,executionFixture()));
    const cleaned=await cleanup.cleanupSimulationExecutions();assert.equal(cleaned.removed,1);
    assert.equal((await store.readSharedExecution(B,other.handle,141)).ok,true);
    assert.equal((await store.readSharedExecution(A,expiredHandle,141)).status,404);
    const partial=packExecution(A,executionFixture());await store.beginSharedExecution(A,partial);await store.appendSharedExecution(A,partial,partial.chunks.slice(0,4));
    await pg.exec('alter table simulation_executions disable trigger simulation_execution_immutable');
    await pg.query("update simulation_executions set created_at=clock_timestamp()-interval '31 minutes' where owner_user_id=$1 and id=$2",[A,partial.id]);
    await pg.exec('alter table simulation_executions enable trigger simulation_execution_immutable');
    assert.equal((await cleanup.cleanupSimulationExecutions()).removed,1);
  }finally{await pg.close();}
});
test('tenant role cannot mutate ready state or chunks or forge ownership',async()=>{
  const {pg,store}=await fixture();try {
    const p=packExecution(A,executionFixture());await store.saveSharedExecution(A,p);
    for(const command of ["update simulation_executions set binding=repeat('0',64)","update simulation_execution_chunks set data=decode('AAAA','base64')","delete from simulation_execution_chunks"]) {
      await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query("select set_config('app.current_user_id',$1,true)",[A]);await tx.exec(command);}));
    }
    await assert.rejects(()=>pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query("select set_config('app.current_user_id',$1,true)",[B]);await tx.query('insert into simulation_execution_chunks values($1,$2,0,$3::jsonb,decode($4,\'base64\'))',[A,p.id,JSON.stringify(p.chunks[0]),p.chunks[0].data]);}));
  }finally{await pg.close();}
});

test('cleanup HTTP boundary requires a server job secret and explicit activation',async()=>{
  const names=['ADMIN_JOB_SECRET','CRON_SECRET','SIMULATION_EXECUTION_CLEANUP_ENABLED'];
  const previous=Object.fromEntries(names.map(key=>[key,process.env[key]]));
  try {
    process.env.ADMIN_JOB_SECRET='synthetic-job-secret';delete process.env.CRON_SECRET;delete process.env.SIMULATION_EXECUTION_CLEANUP_ENABLED;
    const [route]=await importWithPorts(['src/app/api/cron/simulation-executions/route.ts'],{});
    const request=(query='',auth)=>new Request(`http://127.0.0.1/api/cron/simulation-executions${query}`,{headers:auth?{authorization:auth}:{}});
    assert.equal((await route.GET(request())).status,401);
    assert.equal((await route.GET(request('','Bearer wrong'))).status,401);
    assert.equal((await route.GET(request('?owner=A','Bearer synthetic-job-secret'))).status,400);
    const response=await route.GET(request('','Bearer synthetic-job-secret'));
    assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.deepEqual(await response.json(),{status:'disabled'});
  }finally{for(const key of names)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
});
