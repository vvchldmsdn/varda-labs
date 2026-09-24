import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { brokerRecoverySnapshotPredicate, brokerRecoveryBaselinePredicate } from '../src/db/queries/broker-recovery-snapshot-scope.ts';
import { importWithPorts } from './helpers/import-with-ports.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner = id(1), otherOwner=id(2), brokerage=id(11), isa=id(12), otherAccount=id(21);
const recorded='2026-07-20T10:00:00Z';

describe('broker recovery historical evidence admission', () => {
  it('excludes old observations only in the recovered owner/scope, preserving original rows and admitting new evidence', async () => {
    const pg = new PGlite();
    try {
      await pg.exec(`create table broker_recovery_batches(canonical_owner_user_id uuid,account_id uuid,manifest jsonb,recorded_at timestamptz);
        create table daily_position_snapshots(id text,canonical_owner_user_id uuid,account_id uuid,account text,snapshot_date date,captured_at timestamptz,created_at timestamptz,source text default 'test',is_sample boolean default false);`);
      await pg.query('insert into broker_recovery_batches values($1,$2,$3,$4)',[owner,brokerage,JSON.stringify({trades:[{tradeDate:'2026-07-16'},{tradeDate:'2026-07-17'}]}),recorded]);
      const seeds=[
        ['before',owner,brokerage,'brokerage','2026-07-15','2026-07-15T08:00:00Z'],
        ['stale',owner,brokerage,'brokerage','2026-07-16','2026-07-16T08:00:00Z'],
        ['boundary',owner,brokerage,'brokerage','2026-07-20',recorded],
        ['fresh',owner,brokerage,'brokerage','2026-07-21','2026-07-21T08:00:00Z'],
        ['other-account',owner,isa,'isa','2026-07-16','2026-07-16T08:00:00Z'],
        ['other-owner',otherOwner,otherAccount,'brokerage','2026-07-16','2026-07-16T08:00:00Z'],
        ['aggregate',owner,null,'all','2026-07-16','2026-07-16T08:00:00Z'],
        ['missing-capture',owner,brokerage,'brokerage','2026-07-16',null],
      ];
      for(const row of seeds) await pg.query('insert into daily_position_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,captured_at,created_at) values($1,$2,$3,$4,$5,$6,$7)',[...row,'2026-07-16T08:00:00Z']);
      const read=async(scope)=>{
        const q=new PgDialect().sqlToQuery(brokerRecoverySnapshotPredicate('daily_position_snapshots',scope));
        return (await pg.query(`select id from daily_position_snapshots where ${q.sql} order by id`,q.params)).rows.map(row=>row.id);
      };
      assert.deepEqual(await read(),['before','fresh','other-account','other-owner']);
      assert.deepEqual(await read([brokerage,isa]),['before','fresh','other-owner']);
      assert.deepEqual(await read([isa]),['before','fresh','other-account','other-owner']);
      assert.equal((await pg.query('select count(*)::int n from daily_position_snapshots')).rows[0].n,8);
      const baseline=new PgDialect().sqlToQuery(brokerRecoveryBaselinePredicate('2026-07-22'));
      assert.deepEqual((await pg.query(`select id from daily_position_snapshots where ${baseline.sql} order by id`,baseline.params)).rows.map(row=>row.id),['fresh','other-account','other-owner']);
      await pg.query("insert into daily_position_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,captured_at,created_at) values('fresh-other-account',$1,$2,'isa','2026-07-22','2026-07-22T08:00:00Z','2026-07-22T08:00:00Z')",[owner,isa]);
      assert.ok((await read([isa])).includes('fresh-other-account'));
      assert.ok(!(await read([brokerage,isa])).includes('fresh-other-account'));
      await pg.query("insert into daily_position_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,captured_at,created_at) values('corrected-account',$1,$2,'brokerage','2026-07-22','2026-07-22T08:00:00Z','2026-07-22T08:00:00Z')",[owner,brokerage]);
      assert.ok((await read([brokerage,isa])).includes('fresh-other-account'));
      // A subsequent correction invalidates observations captured before that correction too.
      await pg.query('insert into broker_recovery_batches values($1,$2,$3,$4)',[owner,brokerage,JSON.stringify({trades:[{tradeDate:'2026-07-21'}]}),'2026-07-22T08:00:00Z']);
      assert.deepEqual(await read(),['before','fresh-other-account','other-account','other-owner']);
      assert.throws(()=>brokerRecoverySnapshotPredicate('daily_position_snapshots',["x');drop table x;--"]),/scope/);
    } finally { await pg.close(); }
  });

  it('runs the actual History and snapshot API reads under tenant RLS without silently selecting stale dates', async () => {
    const pg = new PGlite();
    try {
      const [schema]=await importWithPorts(['src/db/schema.ts'],{});
      for(const table of [schema.accounts,schema.assets,schema.dailyPortfolioSnapshots,schema.dailyPositionSnapshots]) {
        await pg.exec(`create table ${getTableName(table)} (${Object.values(getTableColumns(table)).map(c=>`"${c.name}" ${c.getSQLType()}`).join(',')})`);
      }
      await pg.exec(`create table broker_recovery_batches(canonical_owner_user_id uuid,account_id uuid,manifest jsonb,recorded_at timestamptz);
        create role snapshot_recovery_test;
        grant select on accounts,assets,daily_portfolio_snapshots,daily_position_snapshots,broker_recovery_batches to snapshot_recovery_test;`);
      for(const table of ['accounts','assets','daily_portfolio_snapshots','daily_position_snapshots','broker_recovery_batches']) {
        await pg.exec(`alter table ${table} enable row level security;create policy owner_read on ${table} for select to snapshot_recovery_test using(canonical_owner_user_id=current_setting('app.current_user_id')::uuid)`);
      }
      for(const [a,o,code] of [[brokerage,owner,'brokerage'],[isa,owner,'isa'],[otherAccount,otherOwner,'brokerage']]) {
        await pg.query('insert into accounts(id,canonical_owner_user_id,code,name,sort_order,is_active) values($1,$2,$3,$3,1,true)',[a,o,code]);
        for(const day of ['2026-07-15','2026-07-16']) {
          await pg.query(`insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,source,is_sample,total_market_value,captured_at,created_at) values($1,$2,$3,$4,$5,'varda_manual_daily_snapshot',false,100,'2026-07-17T08:00:00Z','2026-07-17T08:00:00Z')`,[id(Number(a.slice(-2))*100+Number(day.slice(-2))),o,a,code,day]);
        }
      }
      await pg.query(`insert into daily_position_snapshots(id,canonical_owner_user_id,account_id,account,asset_id,asset_name,ticker,snapshot_date,source,is_sample,captured_at,created_at) values($1,$2,$3,'brokerage',$4,'Synthetic holding','TEST','2026-07-16','varda_manual_daily_snapshot',false,'2026-07-17T08:00:00Z','2026-07-17T08:00:00Z')`,[id(90),owner,brokerage,id(91)]);
      await pg.query('insert into broker_recovery_batches values($1,$2,$3,$4)',[owner,brokerage,JSON.stringify({trades:[{tradeDate:'2026-07-16'}]}),recorded]);
      const runTenantReadTransaction=(o,build)=>pg.transaction(async tx=>{
        await tx.exec('set local role snapshot_recovery_test');await tx.query("select set_config('app.current_user_id',$1,true)",[o]);
        return Promise.all(build({query:async(q,p)=>(await tx.query(q,p)).rows}));
      });
      const [history,portfolio,position]=await importWithPorts(['src/db/queries/tenant-history-snapshots.ts','src/db/queries/tenant-portfolio-snapshots.ts','src/db/queries/tenant-position-snapshots.ts'],{
        '@/db/tenant-transaction-context':{runTenantReadTransaction},
        '@/db/queries/tenant-snapshot-accounts':{loadOwnedActiveSnapshotAccounts:async()=>[{accountId:brokerage,accountCode:'brokerage',accountName:'Brokerage',accountSortOrder:1}]},
      });
      const all=await history.loadTenantHistoryPortfolioRows({tenantContext:{ownerUserId:owner}});
      assert.deepEqual(all.map(row=>row.snapshotDate),['2026-07-15','2026-07-15']);
      const unaffected=await history.loadTenantHistoryPortfolioRows({tenantContext:{ownerUserId:owner},accountIds:[isa]});
      assert.deepEqual(unaffected.map(row=>row.snapshotDate),['2026-07-15','2026-07-16']);
      const other=await history.loadTenantHistoryPortfolioRows({tenantContext:{ownerUserId:otherOwner}});
      assert.deepEqual(other.map(row=>row.snapshotDate),['2026-07-15','2026-07-16']);
      const latest=await portfolio.getReadOnlyTenantPortfolioSnapshots({tenantContext:{ownerUserId:owner},scope:{kind:'account',accountId:brokerage,accountCode:'brokerage'}});
      assert.equal(latest.state,'no_data');
      assert.equal(latest.snapshotDate,'2026-07-16');
      const positionLatest=await position.getReadOnlyTenantPositionSnapshots({tenantContext:{ownerUserId:owner},scope:{kind:'account',accountId:brokerage,accountCode:'brokerage'}});
      assert.equal(positionLatest.state,'no_data');
      assert.equal(positionLatest.snapshotDate,'2026-07-16');
      const detailArgs={tenantContext:{ownerUserId:owner},accountId:brokerage,account:'brokerage',snapshotDate:'2026-07-16',source:'varda_manual_daily_snapshot',limit:100};
      assert.deepEqual(await history.loadTenantHistoryPositionDetailRows(detailArgs),[]);
      assert.deepEqual(await history.loadTenantHistoryPositionComparisonRows(detailArgs),[]);
      assert.deepEqual(await history.loadTenantHistoryGroupPositionRows({tenantContext:{ownerUserId:owner},accountIds:[brokerage],assetIds:[],earliestMembershipDate:'2026-07-01'}),[]);

    } finally { await pg.close(); }
  });
});
