import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';

test('reviewed history stays in one account, replays the latest review, stops at a retroactive change and erases with its account', async () => {
  const db=new PGlite();
  const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
  const account='00000000-0000-4000-8000-000000000003', second='00000000-0000-4000-8000-000000000004';
  const days=['2026-09-13','2026-09-14','2026-09-15'];
  const points=days.map((date,i)=>({date,valueKrw:100+i,dailyReturnPct:i===0?null:1,returnPct:i,estimated:i>0,segment:days[0]}));
  const [reader]=await importWithPorts(['src/db/queries/account-history-review.ts'],{'@/db/tenant-transaction-context':{runTenantReadTransaction:()=>assert.fail('unexpected unbounded transaction')}});
  try {
    await db.exec(`create role varda_tenant_app;
      create table accounts(id uuid primary key,canonical_owner_user_id uuid not null, is_active boolean,unique(id,canonical_owner_user_id));
      create table native_ledger_revisions(account_id uuid,canonical_owner_user_id uuid,operation_id uuid,affected_at timestamptz,marker_sequence int);
      create table event_ledger_entries(id uuid,account_id uuid,canonical_owner_user_id uuid,native_operation_id uuid,native_sequence int,native_data jsonb,is_sample boolean,event_type text,event_date date,recorded_at timestamptz,created_at timestamptz);
      create table broker_recovery_batches(account_id uuid,canonical_owner_user_id uuid,recorded_at timestamptz,manifest jsonb);
      grant select on accounts,native_ledger_revisions,event_ledger_entries,broker_recovery_batches to varda_tenant_app;`);
    await db.exec(readFileSync(new URL('../drizzle/0066_account_history_reviews.sql',import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
    await db.query('insert into accounts values($1,$2,true),($3,$4,true)',[account,owner,second,other]);
    const put="insert into account_history_reviews(canonical_owner_user_id,account_id,evidence_hash,captured_revision,start_date,end_date,excluded_labels,points,evidence) values($1,$2,$3,3,'2026-09-13','2026-09-15',array['예외 종목'],$4::jsonb,$5::jsonb)";
    const required=JSON.stringify({version:1,basis:'reviewed_holdings_excluding_cash',currency:'KRW'});
    await db.query(put,[owner,account,'a'.repeat(64),JSON.stringify(points),required]);
    await assert.rejects(db.query(put,[owner,account,'a'.repeat(64),JSON.stringify(points),required]),e=>e.code==='23505');
    await assert.rejects(db.query(put,[other,account,'c'.repeat(64),JSON.stringify(points),required]),e=>e.code==='23503');
    await assert.rejects(db.query('update account_history_reviews set points=points'),/immutable/);
    await assert.rejects(db.query('delete from account_history_reviews'),/immutable/);
    await db.exec('set role varda_tenant_app');
    const get=async(id,target=account)=>{await db.query("select set_config('app.current_user_id',$1,false)",[id]);return reader.projectAccountHistoryReview((await db.query(reader.ACCOUNT_HISTORY_REVIEW_SQL,[id,target,days[0],days[2]])).rows[0]);};
    assert.deepEqual((await get(owner)).points,points);
    assert.equal(await get(other),null);assert.equal(await get(owner,second),null);
    await assert.rejects(db.query('select evidence from account_history_reviews'),e=>e.code==='42501');
    await assert.rejects(db.query(put,[owner,account,'d'.repeat(64),JSON.stringify(points),required]),e=>e.code==='42501');
    await db.exec('reset role');
    // A later trade strictly after the range preserves the full result.
    await db.query("insert into native_ledger_revisions values($1,$2,null,'2026-09-20T11:00Z',4)",[account,owner]);
    assert.equal((await get(owner)).points.length,3);
    await db.query("insert into native_ledger_revisions values($1,$2,null,'2026-09-14T13:00Z',5)",[second,other]);
    assert.equal((await get(owner)).points.length,3);
    const operation='00000000-0000-4000-8000-000000000005';
    const event='00000000-0000-4000-8000-000000000006';
    const expectThroughCutoff=async(write,lastCutoff)=>{
      await db.exec('begin');
      try {
        await write();
        const review=await get(owner);
        assert.equal(review.endDate,lastCutoff);
        assert.deepEqual(review.points,points.filter(point=>point.date<=lastCutoff));
      } finally {await db.exec('rollback');}
    };
    for (const [affectedAt,lastCutoff] of [
      ['2026-09-14T06:59:59+09:00',days[0]],
      ['2026-09-14T07:00:00+09:00',days[1]],
    ]) {
      await expectThroughCutoff(async()=>{
        await db.query("insert into event_ledger_entries(id,account_id,canonical_owner_user_id,native_operation_id,native_sequence,native_data,is_sample) values($1,$2,$3,$4,6,'{}',false)",[event,account,owner,operation]);
        await db.query('insert into native_ledger_revisions values($1,$2,$3,$4,6)',[account,owner,operation,affectedAt]);
      },lastCutoff);
    }
    await expectThroughCutoff(()=>db.query("insert into event_ledger_entries(account_id,canonical_owner_user_id,is_sample,event_type,event_date,recorded_at) values($1,$2,false,'buy','2026-09-14',clock_timestamp()+interval '1 second')",[account,owner]),days[1]);
    await expectThroughCutoff(()=>db.query("insert into broker_recovery_batches values($1,$2,clock_timestamp()+interval '1 second',$3::jsonb)",[account,owner,JSON.stringify({trades:[{tradeDate:days[1]}]})]),days[1]);
    // An orphan revision still uses the conservative inferred time.
    await db.query("insert into native_ledger_revisions values($1,$2,null,'2026-09-14T13:00Z',6)",[account,owner]);
    assert.deepEqual((await get(owner)).points,points.slice(0,2));
    await db.query("delete from accounts where id=$1",[account]);
    assert.equal((await db.query('select count(*)::int n from account_history_reviews')).rows[0].n,0);
  } finally {await db.close();}
});
