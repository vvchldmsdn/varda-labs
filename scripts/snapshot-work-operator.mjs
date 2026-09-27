import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const REQUEUE_REASONS=['evidence_restored','transient_issue_resolved','lease_interruption_reviewed'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateScope(scope) {
  assert.ok(uuid.test(scope.workId)&&uuid.test(scope.ownerId)&&uuid.test(scope.accountId),'exact_work_owner_account_required');
  assert.ok(Number.isSafeInteger(scope.revision)&&scope.revision>=0,'exact_revision_required');
}
export function validateLocalConnectionFile(value) {
  assert.equal(value.purpose,'cairn-reliability-isolated-postgres','isolated_target_required');
  const c=value.connection;
  assert.ok(c&&c.host==='127.0.0.1'&&c.user==='rc_admin'&&c.ssl===false,'local_target_required');
  assert.ok(Number.isSafeInteger(c.port)&&c.port>=1024&&c.port<=65535,'local_port_required');
  assert.ok(['postgres','reliability_empty'].includes(c.database),'isolated_database_required');
  assert.equal(typeof c.password,'string','connection_file_password_required');
  return {host:c.host,user:c.user,port:c.port,database:c.database,password:c.password,ssl:false,connectionTimeoutMillis:5000,statement_timeout:8000};
}
async function verifyLocalServer(client) {
  const {rows:[server]}=await client.query("select inet_server_addr()::text as address,session_user as role,current_database() as database");
  assert.ok(['127.0.0.1','::1'].includes(server?.address)&&server.role==='rc_admin'&&['postgres','reliability_empty'].includes(server.database),'local_server_identity_mismatch');
}
const scopedQuery=`select w.id,w.canonical_owner_user_id as "ownerId",w.account_id as "accountId",w.snapshot_date::text as "snapshotDate",w.stage,w.revision,w.generation,w.status,w.attempts,w.reason,w.next_attempt_at as "nextAttemptAt",w.lease_until as "leaseUntil",
  a.is_active and u.status='active' and u.role in('user','admin') and ((w.stage='native' and a.native_state is not null) or (w.stage='legacy' and a.native_state is null)) as eligible,
  coalesce((select max(marker_sequence) from native_ledger_revisions r where r.account_id=w.account_id and r.canonical_owner_user_id=w.canonical_owner_user_id and r.affected_at<=(w.snapshot_date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours'),0) as "effectiveRevision"
  from daily_snapshot_work w join accounts a on a.id=w.account_id and a.canonical_owner_user_id=w.canonical_owner_user_id join app_users u on u.id=w.canonical_owner_user_id
  where w.id=$1::uuid and w.canonical_owner_user_id=$2::uuid and w.account_id=$3::uuid and w.revision=$4`;
const parameters=scope=>[scope.workId,scope.ownerId,scope.accountId,scope.revision];
export async function inspectSnapshotWork(pool,scope) {
  validateScope(scope);const client=await pool.connect();
  try {
    await verifyLocalServer(client);const row=(await client.query(scopedQuery,parameters(scope))).rows[0];
    if(!row) return null;
    const nextAction=!row.eligible||Number(row.effectiveRevision)!==scope.revision ? 'review_changed_account_or_revision' : row.status==='completed' ? 'none' : row.status==='blocked' ? 'restore_cutoff_evidence_then_review_requeue' : row.attempts>=4 ? 'review_exhausted_failure_then_requeue' : row.status==='running' ? 'wait_for_lease_or_completion' : 'wait_for_next_due_retry';
    return {...row,nextAction};
  }
  finally {client.release();}
}
export async function requeueSnapshotWork(pool,scope,{reason,expectedGeneration}) {
  validateScope(scope);
  assert.ok(REQUEUE_REASONS.includes(reason),'reviewed_reason_required');
  assert.ok(Number.isSafeInteger(expectedGeneration)&&expectedGeneration>=0,'exact_generation_required');
  const client=await pool.connect();
  try {
    await verifyLocalServer(client);await client.query("BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='8s';");
    await client.query("select set_config('app.trade_reliability_version','0059',true)");
    await client.query('select assert_trade_reliability_write(false)');
    const row=(await client.query(`${scopedQuery} for update of w,a`,parameters(scope))).rows[0];
    assert.ok(row,'work_scope_mismatch');
    assert.ok(row.eligible&&Number(row.effectiveRevision)===scope.revision,'work_revision_or_account_changed');
    assert.equal(row.generation,expectedGeneration,'work_generation_changed');
    assert.ok(['blocked','failed'].includes(row.status)&&!row.leaseUntil,'work_not_requeueable');
    await client.query(`insert into market_data_sync_runs(job_type,mode,status,started_at,finished_at,source,requested_count,success_count,failed_count,skipped_count,metadata_json)
      values('snapshot_work_requeue','operator','completed',clock_timestamp(),clock_timestamp(),'cairn_snapshot_operator',1,1,0,0,$1::jsonb)`,[JSON.stringify({workId:row.id,ownerId:row.ownerId,accountId:row.accountId,snapshotDate:row.snapshotDate,stage:row.stage,revision:row.revision,priorGeneration:row.generation,priorStatus:row.status,priorAttempts:row.attempts,priorReason:row.reason,reason,secretsIncluded:false})]);
    const result=(await client.query(`update daily_snapshot_work set status='pending',attempts=0,generation=generation+1,reason=$2,next_attempt_at=clock_timestamp(),lease_until=null,finished_at=null,updated_at=clock_timestamp() where id=$1::uuid returning id,status,generation`,[row.id,`operator_requeue:${reason}`])).rows[0];
    await client.query('COMMIT');return result;
  } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client.release();}
}

async function main(args) {
  assert.ok(args.length%2===0,'named_arguments_required');
  const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));
  const allowed=['--connection-file','--action','--work-id','--owner-id','--account-id','--revision','--generation','--reason'];
  assert.ok(Object.keys(options).every(key=>allowed.includes(key)),'unknown_argument');
  assert.ok(path.isAbsolute(options['--connection-file']??''),'absolute_connection_file_required');
  const config=validateLocalConnectionFile(JSON.parse(await readFile(options['--connection-file'],'utf8')));
  const scope={workId:options['--work-id'],ownerId:options['--owner-id'],accountId:options['--account-id'],revision:Number(options['--revision'])};
  assert.ok(['inspect','requeue'].includes(options['--action']),'action_required');
  const {Pool}=await import('pg');const pool=new Pool(config);
  try {
    const result=options['--action']==='inspect' ? await inspectSnapshotWork(pool,scope) : await requeueSnapshotWork(pool,scope,{reason:options['--reason'],expectedGeneration:Number(options['--generation'])});
    console.log(JSON.stringify({status:result?'ok':'not_found',work:result}));
  } finally {await pool.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(()=>{console.error('Snapshot operator stopped: check the isolated target, exact work scope, generation and reviewed reason. No connection details are printed.');process.exitCode=1;});
}
