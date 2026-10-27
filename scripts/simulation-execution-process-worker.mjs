// IPC-only credentials from a newly-created verified loopback cluster. Never reads env files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { sqlTransport } from './krw-usd-rc-rehearsal.mjs';
process.once('message',async input=>{
  let pool;
  process.on('message',()=>{}); // Keep writer A alive until the parent explicitly stops it.
  try {
    assert.equal(input.connection.host,'127.0.0.1');assert.equal(input.connection.user,'varda_tenant_app');assert.equal(input.connection.database,'postgres');
    const {Pool}=await import('pg');pool=new Pool(input.connection);
    const forbid=()=>{throw Error('reader_reexecuted_model');};
    const [store]=await importWithPorts(['src/db/queries/simulation-execution-storage.ts'],{
      '@/db/tenant-client':{getTenantSqlClient:()=>sqlTransport(pool,new Set())},
      '@/lib/simulation-owner-economic-research':{buildSimulationOwnerEconomicResearch:forbid},
      '@/lib/simulation-research-execution-core':{prepareSimulationResearchPaths:forbid,executeSimulationResearchPathsFromPrepared:forbid},
    });
    let handle=input.handle,chart;
    if(input.action==='write'||input.action==='partial') {
      const {executionFixture}=await import('../tests/support/shared-execution-fixture.mjs');
      const {packExecution}=await import('../src/lib/simulation-execution-codec.ts');
      const s=executionFixture(input.model??'economic',input.assets??3,input.horizon??21),packed=packExecution(input.owner,s,input.id);
      if(input.action==='partial') {await store.beginSharedExecution(input.owner,packed);await store.appendSharedExecution(input.owner,packed,packed.chunks.slice(0,4));process.send({ok:true,pid:process.pid,partialId:packed.id});return;}
      const saved=await store.saveSharedExecution(input.owner,packed);assert.equal(saved.status,'ready');handle=saved.handle;
      chart=Array.from(s.chart.slice(141*(s.horizon+1),142*(s.horizon+1)));
    }
    const read=await store.readSharedExecution(input.owner,handle,input.path??141);
    const hash=read.ok?createHash('sha256').update(JSON.stringify(read.detail)).digest('hex'):null;
    const context=(await pool.query("select current_setting('app.current_user_id',true) as value")).rows[0].value;assert.ok(context==null||context==='');
    process.send({ok:true,pid:process.pid,handle,chart,hash,status:read.ok?200:read.status,values:read.ok?read.detail.portfolio.map(v=>Number(v.toPrecision(7))):null});
  } catch(error) {process.send({ok:false,code:error.code??'CASE_FAILED'});}
  finally {await pool?.end();}
});
