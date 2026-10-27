import "server-only";
import { sqlClient } from "@/db/client";
import { readActivityIdentity } from "@/lib/auth/member-activity-identity";
import type { ActivityFeature } from "@/lib/member-activity";

// These operational aggregates have no tenant-role grants. Every exported entry
// obtains server-owned authority before using the existing privileged SQL client.
export async function recordMemberActivity(feature: ActivityFeature): Promise<void> {
  const identity = await readActivityIdentity();
  if (!identity) return;
  await sqlClient.transaction(tx => [
    tx.query("select set_config('lock_timeout', '2000', true), set_config('statement_timeout', '4000', true)"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`member_activity:${identity.ownerUserId}`]),
    tx.query(RECORD_ACTIVITY_SQL, [identity.ownerUserId, identity.name, identity.email, feature]),
    tx.query("delete from member_activity_daily where activity_date < (now() at time zone 'Asia/Seoul')::date - 89"),
  ], { isolationLevel: "ReadCommitted" });
}
export type MemberActivityRow = { id: string; name: string | null; email: string | null; lastSeen: string | null; visits: number; activeDays: number; features: { feature: string; views: number }[] };
export type MemberActivityReport = { total: number; observed: number; returning: number; recent: number; page: number; rows: MemberActivityRow[] };
export async function getMemberActivityReport(page = 1): Promise<MemberActivityReport | null> {
  if (!(await readActivityIdentity())?.isAdmin) return null;
  const safePage = Math.min(10000, Math.max(1, Math.floor(page) || 1));
  const [summary, rows] = await sqlClient.transaction(tx => [
    tx.query(`${REPORT_CTE} select count(*)::int as total, count(*) filter(where visits > 0)::int as observed, count(*) filter(where visits > 1)::int as returning, count(*) filter(where last_seen > now() - interval '24 hours')::int as recent from members`),
    tx.query(`${REPORT_CTE} select * from members order by last_seen desc nulls last, id limit 50 offset $1`, [(safePage - 1) * 50]),
  ], { readOnly: true, isolationLevel: "RepeatableRead" });
  return { ...summary[0], page: safePage, rows: rows.map(row => ({ id: row.id, name: row.display_name, email: row.email, lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null, visits: Number(row.visits), activeDays: Number(row.active_days), features: row.features ?? [] })) } as MemberActivityReport;
}
export const REPORT_CTE = `with recent as (
 select owner_user_id, sum(visits)::int as visits, count(distinct activity_date)::int as active_days
 from member_activity_daily where activity_date >= (now() at time zone 'Asia/Seoul')::date - 89 group by owner_user_id
), feature_counts as (
 select owner_user_id, feature, sum(views)::int as views from member_activity_daily
 where activity_date >= (now() at time zone 'Asia/Seoul')::date - 89 group by owner_user_id, feature
), features as (
 select owner_user_id, jsonb_agg(jsonb_build_object('feature', feature, 'views', views) order by views desc, feature) as features from feature_counts group by owner_user_id
), members as (
 select u.id, p.display_name, p.email, p.last_seen, coalesce(r.visits,0) as visits, coalesce(r.active_days,0) as active_days, f.features
 from app_users u left join member_activity_profiles p on p.owner_user_id=u.id
 left join recent r on r.owner_user_id=u.id left join features f on f.owner_user_id=u.id where u.status='active'
)`;
export const RECORD_ACTIVITY_SQL = `with previous as materialized (
 select last_seen from member_activity_profiles where owner_user_id=$1::uuid
), accepted as materialized (
 select 1 where exists(select 1 from app_users where id=$1::uuid and status='active')
 and not exists(select 1 from member_activity_daily where owner_user_id=$1::uuid and activity_date=(now() at time zone 'Asia/Seoul')::date and feature=$4 and last_seen > now()-interval '60 seconds')
), profile as (
 insert into member_activity_profiles(owner_user_id, display_name, email, first_seen, last_seen)
 select $1::uuid, $2, $3, now(), now() from accepted
 on conflict(owner_user_id) do update set display_name=coalesce(excluded.display_name,member_activity_profiles.display_name), email=coalesce(excluded.email,member_activity_profiles.email), last_seen=excluded.last_seen
 returning owner_user_id
)
insert into member_activity_daily(owner_user_id, activity_date, feature, views, visits, last_seen)
select owner_user_id, (now() at time zone 'Asia/Seoul')::date, $4, 1,
 case when not exists(select 1 from previous where last_seen > now()-interval '30 minutes') then 1 else 0 end, now() from profile
on conflict(owner_user_id,activity_date,feature) do update set views=member_activity_daily.views+1, visits=member_activity_daily.visits+excluded.visits, last_seen=excluded.last_seen`;
