import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function runSharedProcessCases({admin,connection,environment,report}) {
  const owner=randomUUID(),other=randomUUID(),children=[];
  await admin.query("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')",[owner,other]);
  // This runner only accepts its newly created loopback cluster. No deployed
  // environment is enabled; the synthetic owner is the sole admitted identity.
  await admin.query("update simulation_execution_service set enabled=true,qa_only=true,qa_owners=$1::uuid[],owner_interval_seconds=0,max_hourly=100,cleanup_succeeded_at=clock_timestamp() where id", [[owner]]);
  const tenant={...connection,user:'varda_tenant_app',max:1};
  function start(input) {
    const child=fork(fileURLToPath(new URL('./simulation-execution-process-worker.mjs',import.meta.url)),[],{env:environment,execArgv:['--no-warnings'],stdio:['ignore','ignore','ignore','ipc']});children.push(child);
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{child.kill();reject(Error('worker_timeout'));},90000);
      child.once('message',message=>{clearTimeout(timeout);if(!message.ok)reject(Error(message.code));else resolve({child,...message});});
      child.once('error',reject);child.send({connection:tenant,owner,...input});
    });
  }
  try {
    for(const model of ['economic','bootstrap']) {
      const id=randomUUID(),a=await start({action:'write',id,model});
      const b=await start({action:'read',handle:a.handle});assert.notEqual(a.pid,b.pid);assert.equal(a.hash,b.hash);assert.deepEqual(b.values,a.chart);
      a.child.kill();await new Promise(resolve=>a.child.once('exit',resolve));
      // A is gone; no source matrix/provider is present in the read worker.
      const c=await start({action:'read',handle:a.handle});assert.notEqual(a.pid,c.pid);assert.equal(c.hash,a.hash);assert.deepEqual(c.values,a.chart);
      const foreign=await start({action:'read',owner:other,handle:a.handle});assert.equal(foreign.status,404);
      const wrongCurrency=await start({action:'read',handle:{...a.handle,currency:'USD'}});assert.equal(wrongCurrency.status,409);
      const invalid=await start({action:'read',handle:a.handle,path:1000});assert.equal(invalid.status,400);
      const concurrent=await Promise.all([start({action:'write',id,model}),start({action:'write',id,model})]);assert.equal(concurrent[0].hash,a.hash);assert.equal(concurrent[1].hash,a.hash);
      assert.equal((await admin.query('select count(*)::int as n from simulation_execution_chunks where owner_user_id=$1 and execution_id=$2',[owner,id])).rows[0].n,125);
      report.cases.push({name:`${model}:A-save-B-read-A-killed-C-read-concurrent-retry`,status:'PASS'});
      await admin.query('delete from simulation_executions where owner_user_id=$1 and id=$2',[owner,id]);
    }
    const partial=await start({action:'partial',id:randomUUID()});partial.child.kill();
    assert.equal((await admin.query('select state from simulation_executions where owner_user_id=$1 and id=$2',[owner,partial.partialId])).rows[0].state,'creating');
    report.cases.push({name:'interrupted-uploader-remains-private-creating',status:'PASS'});
    report.sharedProcessExecution='PASS';
  } finally {for(const child of children) if(child.exitCode===null)child.kill();await admin.query('delete from app_users where id=any($1::uuid[])',[[owner,other]]);}
}
