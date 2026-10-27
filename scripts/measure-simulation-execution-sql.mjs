// Actual Neon HTTP serializer -> in-process PGlite transport. Never opens a socket.
// Measures payloads, NOT Neon latency or multi-process PostgreSQL behavior.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { neon, neonConfig } from '@neondatabase/serverless';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { executionFixture } from '../tests/support/shared-execution-fixture.mjs';
import { packExecution } from '../src/lib/simulation-execution-codec.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const model=process.argv[2]??'economic',assets=Number(process.argv[3]??3),horizon=Number(process.argv[4]??63);
const pg=new PGlite();
await pg.exec("create role varda_tenant_app nosuperuser nobypassrls; create table app_users(id uuid primary key,status text); grant usage on schema public to varda_tenant_app;");
for(const file of ['0045_investment_plans.sql','0054_simulation_executions.sql']) await pg.exec(readFileSync(new URL(`../drizzle/${file}`,import.meta.url),'utf8'));
await pg.query("insert into app_users values($1,'active')",[owner]);
const wire={requests:0,requestBytes:0,responseBytes:0,maxRequestBytes:0};
const originalFetch=neonConfig.fetchFunction;
neonConfig.fetchFunction=async (_url,options)=>{
  const bytes=Buffer.byteLength(options.body),body=JSON.parse(options.body);
  wire.requests++;wire.requestBytes+=bytes;wire.maxRequestBytes=Math.max(wire.maxRequestBytes,bytes);
  const results=await pg.transaction(async tx=>{
    await tx.exec('set local role varda_tenant_app');
    const results=[];
    for(const q of body.queries) {
      const r=await tx.query(q.query,q.params);
      results.push({fields:r.fields,rows:r.rows.map(row=>r.fields.map(f=>{
        const v=row[f.name];
        return v==null?null:f.dataTypeID===16?(v?'t':'f'):[114,3802].includes(f.dataTypeID)?JSON.stringify(v):String(v);
      })),rowCount:r.rows.length,command:'SELECT'});
    }
    return results;
  });
  const response=JSON.stringify({results});wire.responseBytes+=Buffer.byteLength(response);
  return new Response(response,{headers:{'content-type':'application/json'}});
};
try {
  // This URL is inert: fetchFunction above is the only transport, with no network calls.
  const client=neon('postgresql://isolated:isolated@127.0.0.1:1/isolated');
  const [store]=await importWithPorts(['src/db/queries/simulation-execution-storage.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>client}});
  const packed=packExecution(owner,executionFixture(model,assets,horizon));
  const start=performance.now(),saved=await store.saveRenderedExecution(owner,packed),writeMs=performance.now()-start;
  assert.equal(saved.status,'ready');
  const write={...wire};
  const readStart=performance.now(),result=await store.readSharedExecution(owner,saved.handle,141),readMs=performance.now()-readStart;
  assert.equal(result.ok,true);
  const readResponseBytes=wire.responseBytes-write.responseBytes,readRequests=wire.requests-write.requests;
  const sizes=(await pg.query("select pg_total_relation_size('simulation_executions')::bigint as execution_bytes,pg_total_relation_size('simulation_execution_chunks')::bigint as chunk_bytes")).rows[0];
  const cleanupStart=performance.now();await store.deleteSharedExecution(owner,saved.handle);
  const cleanupMs=performance.now()-cleanupStart;
  console.log(JSON.stringify({transport:'real Neon serializer; PGlite emulated HTTP response; no network',model,assets,horizon,paths:1000,write,writeMs,readMs,readRequests,readResponseBytes,detailJsonBytes:Buffer.byteLength(JSON.stringify(result.detail)),physicalRelationBytes:sizes,deleteMs:cleanupMs,rssPeakBytes:process.resourceUsage().maxRSS*1024},null,2));
}finally{neonConfig.fetchFunction=originalFetch;await pg.close();}
