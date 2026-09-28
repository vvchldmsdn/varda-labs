import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Disposable cluster only. These sentinels exercise preservation, not fabricated
// production history or a substitute for the existing actual replay-writer tests.
export async function prepareCutoffUpgradeAudit(db) {
 const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account='99999999-9999-4999-8999-999999999999';
 // Match the read-only verified production 0059 state, inside this new cluster.
 await db.query("update trade_reliability_runtime set mode='compatible',reason='isolated 0060 upgrade rehearsal' where singleton");
 const tx=await db.connect();
 try {
  await tx.query('BEGIN');await tx.query("select set_config('app.trade_reliability_version','0059',true)");
  await tx.query("insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,reason,effective_entries) values($1,$2,$3,2,'2026-08-01','synthetic upgrade sentinel',$4)",[owner,account,randomUUID(),JSON.stringify([1,2].map(sequence=>({id:randomUUID(),operationId:randomUUID(),data:{state:{sequence},synthetic:true}})))]);
  await tx.query('insert into native_operation_cancellations(canonical_owner_user_id,operation_id) values($1,$2)',[owner,randomUUID()]);
  await tx.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,total_market_value,native_evidence) values($1,$2,'rc-legacy','2026-08-01','native_ledger_cutoff_v2',12345,'{\"synthetic\":true,\"availableCurrencies\":[\"KRW\"]}')",[owner,account]);
  await tx.query('COMMIT');
 } catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}
 const capture=async()=>{
  const data={};
  for(const table of ['accounts','assets','event_ledger_entries','native_ledger_revisions','native_operation_cancellations','daily_portfolio_snapshots','daily_position_snapshots','trade_reliability_runtime']) data[table]=(await db.query(`select to_jsonb(t) data from ${table} t order by to_jsonb(t)::text`)).rows;
  data.functions=(await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('apply_native_trade_revision','cancel_native_operation','assert_trade_reliability_write','apply_native_portfolio_tenant_mutation') order by 1")).rows;
  return data;
 };
 const before=await capture();
 return async()=>assert.deepEqual(await capture(),before,'0060 must preserve existing financial data and 0059 writer/paused guards');
}
