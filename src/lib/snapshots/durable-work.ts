import { holdingsPortfolioSql } from "@/lib/portfolio-presentation-policy";
import "server-only";
import { snapshotWorkRevisionCutoffSql } from "./holdings-revision-policy";
import { sqlClient } from "@/db/client";
import {snapshotFence,snapshotDeadline} from "./write-context";
export {snapshotFence,snapshotDeadline} from "./write-context";
export const SNAPSHOT_RETRY_POLICY = { lookbackDays:3, maxTasks:30, maxDiscovery:300, maxAttempts:4, leaseSeconds:90, timeBudgetMs:60000 } as const;
export type SnapshotWork = { id:string; ownerUserId:string; accountId:string; code:string; role:"user"|"admin"; snapshotDate:string; revision:number; generation:number };
async function queueWrite(query:string,parameters:unknown[]) {
  const results=await sqlClient.transaction(tx=>[
    tx.query("select set_config('app.trade_reliability_version','0059',true)"),
    tx.query("select assert_trade_reliability_write(false)"),
    tx.query(query,parameters),
  ]);
  return results.at(-1)??[];
}
export async function discoverSnapshotWork(stage:"legacy"|"native", snapshotDate:string) {
  const rows=await queueWrite(`with candidates as materialized (select a.canonical_owner_user_id,a.id as account_id,d::date as snapshot_date,$1 as stage,coalesce(r.revision,0) as revision
   from accounts a join app_users u on u.id=a.canonical_owner_user_id
   cross join generate_series($2::date-2,$2::date,interval '1 day') d
   left join lateral(select max(marker_sequence) revision from native_ledger_revisions where account_id=a.id and canonical_owner_user_id=u.id and affected_at<=(d::date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours') r on true
   where u.status='active' and u.role in('user','admin') and a.is_active
    and (($1='native' and (a.native_state is not null and not ${holdingsPortfolioSql("a")}) and (a.native_state->>'startedAt')::timestamptz<(d::date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours')
     or ($1='legacy' and ${holdingsPortfolioSql("a")} and a.account_type<>'cash' and exists(select 1 from assets h where h.account_id=a.id and h.canonical_owner_user_id=u.id and h.archived_at is null and coalesce(h.asset_type,'etf') in('etf','stock','pension','commodity') and (h.quantity>0 or h.fractional_krw_value>0))))
   ), missing as materialized (
    select c.* from candidates c where not exists(select 1 from daily_snapshot_work w where w.account_id=c.account_id and w.snapshot_date=c.snapshot_date and w.stage=c.stage and w.revision=c.revision)
   ), inserted as (
    insert into daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage,revision)
    select * from missing order by snapshot_date,account_id limit 300 on conflict do nothing returning id
   ) select ((select count(*) from missing)-(select count(*) from inserted))::int as deferred`,[stage,snapshotDate]);
  return Number(rows[0]?.deferred ?? 0);
}
export async function claimSnapshotWork(stage:"legacy"|"native", snapshotDate:string):Promise<SnapshotWork|null> {
  // A worker that disappears on its final reserved attempt must not remain
  // "running" forever. Keep the exhausted row for explicit operator recovery.
  await queueWrite(`update daily_snapshot_work set status='failed',reason='worker_interrupted_retry_exhausted',lease_until=null,next_attempt_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp()
    where stage=$1 and snapshot_date<=$2::date and status='running' and attempts>=4 and lease_until<clock_timestamp()`,[stage,snapshotDate]);
  const rows=await queueWrite(`with due as materialized (
    select w.id from daily_snapshot_work w join accounts a on a.id=w.account_id join app_users u on u.id=w.canonical_owner_user_id
    where stage=$1 and snapshot_date<=$2::date and attempts<4 and a.is_active and u.status='active' and u.role in('user','admin') and (($1='native' and (a.native_state is not null and not ${holdingsPortfolioSql("a")})) or ($1='legacy' and ${holdingsPortfolioSql("a")}))
     and w.status not in ('completed','blocked') and (w.status<>'running' or lease_until<clock_timestamp())
     and (next_attempt_at is null or next_attempt_at<=clock_timestamp())
     and revision=coalesce((select max(marker_sequence) from native_ledger_revisions r where r.account_id=a.id and r.canonical_owner_user_id=w.canonical_owner_user_id and r.affected_at<=${snapshotWorkRevisionCutoffSql("w")}),0)
    order by snapshot_date,w.id limit 1 for update of w skip locked
   ), claimed as(update daily_snapshot_work set status='running',generation=generation+1,attempts=attempts+1,started_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() where id in(select id from due) returning *)
   select c.id,c.canonical_owner_user_id as "ownerUserId",c.account_id as "accountId",a.code,u.role,c.snapshot_date::text as "snapshotDate",c.revision,c.generation from claimed c join accounts a on a.id=c.account_id join app_users u on u.id=c.canonical_owner_user_id`,[stage,snapshotDate]);
  return (rows[0] as SnapshotWork|undefined) ?? null;
}
export async function finishSnapshotWork(work:SnapshotWork,status:"completed"|"blocked"|"failed"|"deferred",reason:string|null) {
  // Claim reserves one failure slot so crashes are bounded. A successful run,
  // absent evidence, or lock contention refunds that reservation; only a real
  // failure/interrupted worker consumes it. Park absent evidence until reviewed.
  const rows=await queueWrite(`update daily_snapshot_work set status=case when $3='deferred' then 'pending' else $3 end,reason=$4,finished_at=clock_timestamp(),lease_until=null,
   attempts=greatest(0,attempts-case when $3='failed' then 0 else 1 end),
   next_attempt_at=case when $3 in ('completed','blocked') then null when $3='deferred' then clock_timestamp()+interval '1 minute' when attempts>=4 then null else clock_timestamp()+interval '5 minutes'*power(2,attempts-1) end,updated_at=clock_timestamp()
   where id=$1::uuid and generation=$2 and status='running' and lease_until>clock_timestamp() returning id`,[work.id,work.generation,status,reason]);
  return rows.length===1;
}
export function isSnapshotLockContention(error:unknown) {
  let value:unknown=error;
  for(let depth=0;depth<4 && value && typeof value==='object';depth++) {
    if('code' in value && value.code==='55P03') return true;
    value='cause' in value ? value.cause : null;
  }
  return false;
}
export async function runSnapshotWork(stage:"legacy"|"native",snapshotDate:string,execute:(work:SnapshotWork)=>Promise<{status:"completed"|"blocked"|"deferred";reason?:string}>,options:{discover?:boolean}={}) {
  const deferred=options.discover===false ? 0 : await discoverSnapshotWork(stage,snapshotDate);
  const deadline=Math.min(snapshotDeadline.getStore()??Infinity,Date.now()+SNAPSHOT_RETRY_POLICY.timeBudgetMs);
  for(let count=0;count<SNAPSHOT_RETRY_POLICY.maxTasks && Date.now()<deadline;count++) {
    const work=await claimSnapshotWork(stage,snapshotDate); if(!work) break;
    try { const result=await snapshotFence.run(work,()=>execute(work)); await finishSnapshotWork(work,result.status,result.reason??null); }
    catch(error) { await finishSnapshotWork(work,isSnapshotLockContention(error) ? "deferred" : "failed",isSnapshotLockContention(error) ? "snapshot_lock_busy" : "snapshot_write_failed"); }
  }
  const rows=await sqlClient.query(`select w.status,count(*)::int as count,count(*) filter(where w.attempts>=4)::int as exhausted from daily_snapshot_work w join accounts a on a.id=w.account_id join app_users u on u.id=w.canonical_owner_user_id
    where stage=$1 and snapshot_date<=$2::date and (snapshot_date >= $2::date-2 or w.status<>'completed') and a.is_active and u.status='active' and u.role in('user','admin') and (($1='native' and (a.native_state is not null and not ${holdingsPortfolioSql("a")})) or ($1='legacy' and ${holdingsPortfolioSql("a")}))
    and w.revision=coalesce((select max(marker_sequence) from native_ledger_revisions r where r.account_id=a.id and r.canonical_owner_user_id=w.canonical_owner_user_id and r.affected_at<=${snapshotWorkRevisionCutoffSql("w")}),0)
    group by w.status`,[stage,snapshotDate]);
  const counts=Object.fromEntries(rows.map(r=>[String(r.status),Number(r.count)]));
  return {targetCount:deferred+rows.reduce((sum,r)=>sum+Number(r.count),0),writtenCount:counts.completed??0,failedCount:counts.failed??0,blockedCount:deferred+(counts.blocked??0)+(counts.pending??0)+(counts.running??0),exhaustedCount:rows.reduce((sum,r)=>sum+Number(r.exhausted??0),0),evidenceBlockedCount:counts.blocked??0};
}
