import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/node-postgres';
import {importWithPorts} from '../tests/helpers/import-with-ports.mjs';
import {sqlTransport} from './krw-usd-rc-rehearsal.mjs';
import {inspectSnapshotWork,requeueSnapshotWork} from './snapshot-work-operator.mjs';

export async function runReliabilityRetryCases({admin,worker,tenant,report}) {
  const sessions=new Set();
  const [work,ledger,mutation,retry]=await importWithPorts([
    'src/lib/snapshots/durable-work.ts','src/db/queries/native-portfolio-ledger.ts','src/lib/portfolio-mutation-transaction.ts','src/lib/snapshots/retry-runner.ts',
  ],{'@/db/client':{sqlClient:sqlTransport(worker,sessions),db:drizzle(worker)},'@/db/tenant-client':{getTenantSqlClient:()=>sqlTransport(tenant,sessions)},
    // Next's after-response scheduler is unused by stored-evidence retries.
    // Replace only this framework boundary; any attempt to schedule collection
    // makes the integration fail, while writer/query/valuation remain real.
    'next/server':{after:()=>assert.fail('Snapshot retry must not schedule provider collection')},
  });
  const owner=randomUUID(),account=randomUUID();
  await queueWrite("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
  await queueWrite("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'retry-synthetic','Synthetic retry','brokerage','USD')",[account,owner]);
  const created=await ledger.writeNativeMutation({ownerUserId:owner,role:'user'},{operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:'1999-12-01T00:00:00Z',cash:{KRW:'0',USD:'100'},positions:[]}});
  assert.equal(created.status,'created');
  async function check(name,fn){const result={name,status:'FAIL'};report.cases.push(result);await fn();result.status='PASS';}
  async function queueWrite(query,parameters=[]) {
    const client=await admin.connect();
    try {await client.query('BEGIN');await client.query("select set_config('app.trade_reliability_version','0059',true)");await client.query('select assert_trade_reliability_write(false)');const result=await client.query(query,parameters);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async function enqueue(day) {
    const id=randomUUID();await queueWrite("insert into daily_snapshot_work(id,canonical_owner_user_id,account_id,snapshot_date,stage,revision) values($1,$2,$3,$4,'native',0)",[id,owner,account,`2000-01-${day}`]);return id;
  }
  const scope=id=>({workId:id,ownerId:owner,accountId:account,revision:0});
  const read=id=>inspectSnapshotWork(admin,scope(id));
  const execute=(fn)=>work.runSnapshotWork('native','2000-02-01',fn,{discover:false});
  const due=id=>queueWrite("update daily_snapshot_work set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1",[id]);
  const complete=async()=>({status:'completed'});
  await check('retry-preserves-and-executes-queued-cutoff-older-than-three-days',async()=>{
    const id=await enqueue('01');const seen=[];await execute(async item=>{seen.push(item.id);return complete();});
    assert.deepEqual(seen,[id]);assert.equal((await read(id)).status,'completed');
    await execute(async()=>{assert.fail('A completed cutoff must not execute again');});
  });
  await check('evidence-blocked-does-not-consume-attempt-and-reviewed-requeue-drains-real-writer',async()=>{
    const id=await enqueue('02');await execute(async()=>({status:'blocked',reason:'cutoff_evidence_missing'}));
    const blocked=await read(id);assert.equal(blocked.status,'blocked');assert.equal(blocked.attempts,0);assert.equal(blocked.nextAttemptAt,null);
    await execute(async()=>assert.fail('Evidence-blocked work stays parked'));
    await assert.rejects(requeueSnapshotWork(admin,{...scope(id),ownerId:randomUUID()},{reason:'evidence_restored',expectedGeneration:blocked.generation}),/work_scope_mismatch/);
    await requeueSnapshotWork(admin,scope(id),{reason:'evidence_restored',expectedGeneration:blocked.generation});
    await assert.rejects(requeueSnapshotWork(admin,scope(id),{reason:'evidence_restored',expectedGeneration:blocked.generation}),/work_generation_changed/);
    const result=await retry.runSnapshotRetry(new Date('2000-02-01T01:00:00Z'));
    assert.equal(result.providerRequests,0);assert.equal((await read(id)).status,'completed');
    const stored=(await admin.query("select native_evidence from daily_portfolio_snapshots where account_id=$1 and snapshot_date='2000-01-02'",[account])).rows;
    assert.equal(stored.length,1);assert.equal(stored[0].native_evidence.frame.positions.find(row=>row.id===`cash:${account}:USD`).observation.quantity,'100');
    const audit=(await admin.query("select metadata_json from market_data_sync_runs where job_type='snapshot_work_requeue' and metadata_json->>'workId'=$1",[id])).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].metadata_json.priorAttempts,0);assert.equal(audit[0].metadata_json.reason,'evidence_restored');
    await assert.rejects(requeueSnapshotWork(admin,scope(id),{reason:'evidence_restored',expectedGeneration:(await read(id)).generation}),/work_not_requeueable/);
  });
  await check('four-real-failures-are-terminal-until-exact-reviewed-requeue',async()=>{
    const id=await enqueue('03');let calls=0;
    for(let n=1;n<=4;n++) {
      await execute(async()=>{calls++;throw Error('Synthetic write failure');});
      const row=await read(id);assert.equal(row.attempts,n);assert.equal(row.status,'failed');
      if(n<4) {assert.ok(row.nextAttemptAt);await due(id);} else assert.equal(row.nextAttemptAt,null);
    }
    await execute(async()=>assert.fail('Exhausted work must not auto-reset'));assert.equal(calls,4);
    const prior=await read(id);await requeueSnapshotWork(admin,scope(id),{reason:'transient_issue_resolved',expectedGeneration:prior.generation});
    await execute(complete);assert.equal((await read(id)).attempts,0);
  });
  await check('real-owner-lock-contention-and-not-due-wake-do-not-burn-failure-budget',async()=>{
    const id=await enqueue('04'),holder=await admin.connect();
    try {
      await holder.query('BEGIN');await holder.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`varda.portfolio_mutation.v1:${owner}`]);
      await execute(async()=>{await mutation.runPortfolioMutation(owner,'select 1',[]);return complete();});
      const row=await read(id);assert.equal(row.status,'pending');assert.equal(row.reason,'snapshot_lock_busy');assert.equal(row.attempts,0);
      await execute(async()=>assert.fail('Not-yet-due work must not execute'));assert.equal((await read(id)).attempts,0);
    } finally {await holder.query('ROLLBACK');holder.release();}
    await due(id);await execute(complete);assert.equal((await read(id)).status,'completed');
  });
  await check('four-interrupted-workers-have-explicit-exhausted-outcome',async()=>{
    const id=await enqueue('05');let last;
    for(let n=1;n<=4;n++) {
      last=await work.claimSnapshotWork('native','2000-02-01');assert.equal(last.id,id);
      await queueWrite("update daily_snapshot_work set lease_until=clock_timestamp()-interval '1 second' where id=$1",[id]);
    }
    assert.equal(await work.claimSnapshotWork('native','2000-02-01'),null);
    const row=await read(id);assert.equal(row.status,'failed');assert.equal(row.attempts,4);assert.equal(row.reason,'worker_interrupted_retry_exhausted');assert.equal(row.leaseUntil,null);
    assert.equal(await work.finishSnapshotWork(last,'completed',null),false);
    await requeueSnapshotWork(admin,scope(id),{reason:'lease_interruption_reviewed',expectedGeneration:row.generation});await execute(complete);
  });
}
