import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {validateLocalConnectionFile} from '../scripts/snapshot-work-operator.mjs';

describe('Provider-free snapshot retry admission',()=>{
  it('runs only persisted work and continues the other family after failure',async()=>{
    const calls=[];
    const [runner]=await importWithPorts(['src/lib/snapshots/retry-runner.ts'],{
      '@/lib/snapshots/daily-job':{runDailySnapshotJob:async options=>{calls.push(['legacy',options]);throw Error('synthetic failure');}},
      '@/lib/snapshots/native-daily-job':{runNativeDailySnapshotJob:async options=>{calls.push(['native',options]);return {targetCount:1,writtenCount:1,failedCount:0,blockedCount:0};}},
    });
    const result=await runner.runSnapshotRetry(new Date('2026-09-24T22:00:00Z'));
    assert.equal(result.status,'failed');assert.equal(result.native.writtenCount,1);assert.equal(result.providerRequests,0);
    assert.deepEqual(calls.map(([name])=>name),['legacy','native']);
    for(const [,options] of calls) assert.deepEqual(options,{dryRun:false,durable:true,discover:false,snapshotDate:'2026-09-25'});
  });
  it('recognizes a PostgreSQL lock conflict through a transport cause only',async()=>{
    const [work]=await importWithPorts(['src/lib/snapshots/durable-work.ts'],{'@/db/client':{sqlClient:{}}});
    assert.equal(work.isSnapshotLockContention({code:'55P03'}),true);
    assert.equal(work.isSnapshotLockContention({cause:{code:'55P03'}}),true);
    assert.equal(work.isSnapshotLockContention({code:'57014'}),false);
    assert.equal(work.isSnapshotLockContention(Error('55P03 in arbitrary error text')),false);
  });
  it('uses actual route auth, opt-in and body status boundaries',async()=>{
    const prior=process.env.MARKET_CYCLE_CRON_WRITE_ENABLED;
    let authorized=false,calls=0,result={ok:true,status:'completed'};
    const [route]=await importWithPorts(['src/app/api/cron/snapshots/retry/route.ts'],{
      '@/lib/admin-auth':{isAuthorizedAdminJob:()=>authorized},
      '@/lib/snapshots/retry-runner':{runSnapshotRetry:async()=>{calls++;return result;}},
      'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    });
    const request=query=>new Request(`http://127.0.0.1/api/cron/snapshots/retry${query??''}`);
    try {
      process.env.MARKET_CYCLE_CRON_WRITE_ENABLED='true';assert.equal((await route.GET(request())).status,401);
      authorized=true;assert.equal((await route.GET(request('?force=true'))).status,400);
      delete process.env.MARKET_CYCLE_CRON_WRITE_ENABLED;assert.equal((await route.GET(request())).status,409);assert.equal(calls,0);
      process.env.MARKET_CYCLE_CRON_WRITE_ENABLED='true';
      for(const [status,ok,http] of [['completed',true,200],['blocked',false,409],['failed',false,500]]) {
        result={status,ok};const response=await route.GET(request());assert.equal(response.status,http);assert.equal(response.headers.get('cache-control'),'no-store');
      }
      assert.equal(calls,3);
    } finally {if(prior===undefined)delete process.env.MARKET_CYCLE_CRON_WRITE_ENABLED;else process.env.MARKET_CYCLE_CRON_WRITE_ENABLED=prior;}
  });
  it('refuses remote, inherited and wrong-role operator targets',()=>{
    const config={purpose:'cairn-reliability-isolated-postgres',connection:{host:'127.0.0.1',port:54329,user:'rc_admin',database:'postgres',password:'synthetic',ssl:false}};
    assert.equal(validateLocalConnectionFile(config).host,'127.0.0.1');
    for(const replacement of [{host:'production.example.test'},{user:'app_owner'},{database:'production'},{ssl:true},{port:543}]) assert.throws(()=>validateLocalConnectionFile({...config,connection:{...config.connection,...replacement}}));
    assert.throws(()=>validateLocalConnectionFile({...config,purpose:'production'}));
  });
});
