import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';

it('historical retry resolves an operation committed between preflight and replay reads', async () => {
  const pg=new PGlite();
  try {
    await pg.exec('CREATE ROLE varda_tenant_app');
    for(const {tag} of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries) await pg.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
    await pg.exec('GRANT USAGE ON SCHEMA public TO varda_tenant_app');
    const owner=randomUUID(),account=randomUUID(),asset=randomUUID();
    await pg.query("insert into app_users(id,status,role) values($1,'active','user')",[owner]);
    await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'retry','Synthetic retry','brokerage','USD')",[account,owner]);
    await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'retry','Synthetic unit','RETRY','us','USD','stock',10,100)",[asset,owner,account]);
    let beforeHistory;
    const transport={transaction:async build=>{
      const commands=build({query:(text,params=[])=>({text,params})});
      if(beforeHistory&&commands.some(row=>row.text.includes('from effective_native_ledger_entries'))) {
        const action=beforeHistory;beforeHistory=null;await action();
      }
      return pg.transaction(async tx=>{
        await tx.exec('set local role varda_tenant_app');
        const rows=[];for(const q of commands)rows.push((await tx.query(q.text,q.params)).rows);return rows;
      });
    }};
    const [ledger]=await importWithPorts(['src/db/queries/native-portfolio-ledger.ts'],{'@/db/tenant-client':{getTenantSqlClient:()=>transport}});
    const tenant={ownerUserId:owner,role:'user'},write=input=>ledger.writeNativeMutation(tenant,input);
    assert.equal((await write({operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:'2026-08-01T00:00:00Z',cash:{KRW:'0',USD:'1000'},positions:[{assetId:asset,currency:'USD',quantity:'10',costLots:null}]}})).status,'created');
    assert.equal((await write({operationId:randomUUID(),accountId:account,expectedSequence:0,event:{type:'sell',at:'2026-08-03T00:00:00Z',assetId:asset,currency:'USD',quantity:'3',settlement:{currency:'USD',amount:'330'},fee:{currency:'USD',amount:'0'},tax:{currency:'USD',amount:'0'}}})).status,'created');
    await pg.query("select set_trade_reliability_mode('compatible','Synthetic race rehearsal')");
    const request={operationId:randomUUID(),accountId:account,expectedSequence:1,event:{type:'buy',at:'2026-08-02T00:00:00Z',assetId:asset,currency:'USD',quantity:'2',settlement:{currency:'USD',amount:'200'},fee:{currency:'USD',amount:'0'},tax:{currency:'USD',amount:'0'}},history:{reason:'Synthetic missing trade',notInOpening:true}};
    // The outer request has already completed its exact-op preflight. Commit
    // the same operation before its full history query: the formerly flaky gap.
    beforeHistory=async()=>assert.equal((await write(request)).status,'created');
    const retry=await write(request);
    assert.deepEqual(retry,{status:'existing'},`race result: ${JSON.stringify(retry)}`);
    assert.equal((await write({...request,event:{...request.event,quantity:'3'}})).status,'conflict');
    const value=await ledger.readNativeLedger(tenant,account);
    assert.equal(value.accounts[0].state.positions[0].quantity,'9');
    assert.equal(value.accounts[0].state.cash.USD,'1130');
    assert.equal((await pg.query('select count(*)::int n from native_ledger_revisions where account_id=$1',[account])).rows[0].n,1);
    assert.equal((await pg.query('select count(*)::int n from event_ledger_entries where native_operation_id=$1',[request.operationId])).rows[0].n,1);
  } finally {await pg.close();}
});
