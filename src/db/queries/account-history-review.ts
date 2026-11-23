import "server-only";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type ReviewedHistoryPoint = {
  date: string;
  valueKrw: number | null;
  dailyReturnPct: number | null;
  returnPct: number | null;
  segment: string | null;
  estimated: boolean;
};
export type AccountHistoryReview = {
  source: "broker_account_review_v1";
  currency: "KRW";
  basis: "reviewed_holdings_excluding_cash";
  startDate: string;
  endDate: string;
  excludedLabels: string[];
  usesEstimates: boolean;
  points: ReviewedHistoryPoint[];
};

// Pick the latest publication before restricting the request window so an older
// estimate cannot silently reappear while a corrected interval is selected.
// A later revision starts at the earliest possibly affected service day. This
// includes an original execution replaced by a backdated edit. Native date-only
// records encode their effective date at midday, not an observed execution time.
export const ACCOUNT_HISTORY_REVIEW_SQL = `
with selected as (
  select r.canonical_owner_user_id, r.account_id, r.captured_revision, r.created_at,
    r.start_date,r.end_date,r.excluded_labels,r.points
  from public.account_history_reviews r
  join public.accounts a on a.id=r.account_id and a.canonical_owner_user_id=r.canonical_owner_user_id and a.is_active
  where r.account_id=$2::uuid and r.canonical_owner_user_id=$1::uuid
    and r.canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid
  order by r.created_at desc,r.evidence_hash desc limit 1
), guarded as (
  select s.*,least(
    (select min((((v.affected_at - case when e.native_data#>>'{request,event,dateEvidence,precision}'='date_only'
      or e.id is null then interval '12 hours' else interval '0 hours' end) at time zone 'Asia/Seoul')-interval '7 hours')::date)
     from public.native_ledger_revisions v left join public.event_ledger_entries e on e.account_id=v.account_id and
       e.canonical_owner_user_id=v.canonical_owner_user_id and e.native_sequence=v.marker_sequence and e.native_operation_id=v.operation_id
       and not e.is_sample
     where v.account_id=s.account_id and v.canonical_owner_user_id=s.canonical_owner_user_id and v.marker_sequence>s.captured_revision),
    (select min(t.event_date) from public.event_ledger_entries t where t.account_id=s.account_id
      and t.canonical_owner_user_id=s.canonical_owner_user_id and not t.is_sample and t.native_data is null
      and t.event_type in ('buy','sell','split') and coalesce(t.recorded_at,t.created_at)>s.created_at),
    (select min((b.trade->>'tradeDate')::date) from public.broker_recovery_batches batch
      cross join lateral jsonb_array_elements(batch.manifest->'trades') b(trade)
      where batch.account_id=s.account_id and batch.canonical_owner_user_id=s.canonical_owner_user_id
      and batch.recorded_at>s.created_at)
    ) as invalid_from
  from selected s where s.start_date<=$4::date and s.end_date>=$3::date
)
select g.start_date::text as start_date,least(g.end_date,g.invalid_from-1)::text as end_date,g.excluded_labels,
  jsonb_agg(p.value order by p.ordinality) as points
from guarded g cross join lateral jsonb_array_elements(g.points) with ordinality p(value,ordinality)
where p.value->>'date' between greatest(g.start_date,$3::date)::text and least(g.end_date,g.invalid_from-1,$4::date)::text
group by g.start_date,g.end_date,g.invalid_from,g.excluded_labels`;

const isDate = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)
  && Number.isFinite(Date.parse(x)) && new Date(x + "T00:00:00Z").toISOString().slice(0, 10) === x;
const numberOrNull = (x: unknown) => x === null || typeof x === "number" && Number.isFinite(x);

export function projectAccountHistoryReview(row: Readonly<Record<string, unknown>> | undefined): AccountHistoryReview | null {
  if (!row || !isDate(row.start_date) || !isDate(row.end_date) || row.start_date > row.end_date
    || !Array.isArray(row.excluded_labels) || !row.excluded_labels.every(label => typeof label === "string" && label.length > 0 && label.length <= 120)
    || !Array.isArray(row.points) || !row.points.length || row.points.length > 366) return null;
  const points: ReviewedHistoryPoint[] = [];
  for (const p of row.points) {
    if (!p || !isDate(p.date) || p.date < row.start_date || p.date > row.end_date ||
      (points.length && Date.parse(p.date) - Date.parse(points.at(-1)!.date) !== 86_400_000) ||
      !numberOrNull(p.valueKrw) || p.valueKrw !== null && p.valueKrw <= 0 || !numberOrNull(p.returnPct) ||
      !numberOrNull(p.dailyReturnPct) || typeof p.estimated !== "boolean" ||
      (p.segment !== null && (!isDate(p.segment) || p.segment > p.date)) ||
      (p.valueKrw === null && (p.returnPct !== null || p.dailyReturnPct !== null)) ||
      (p.returnPct !== null && p.segment === null)) return null;
    points.push({date:p.date,valueKrw:p.valueKrw,returnPct:p.returnPct,dailyReturnPct:p.dailyReturnPct,segment:p.segment,estimated:p.estimated});
  }
  return {source:"broker_account_review_v1",basis:"reviewed_holdings_excluding_cash",currency:"KRW",
    startDate:row.start_date,endDate:row.end_date,excludedLabels:row.excluded_labels,
    usesEstimates:points.some(point=>point.estimated),points};
}

export async function readAccountHistoryReview(tenant: TenantContext, accountId: string, range?: {start:string;end:string}) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(accountId) ||
    (range && (!isDate(range.start) || !isDate(range.end) || range.start > range.end))) return null;
  const [rows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [
    tx.query(ACCOUNT_HISTORY_REVIEW_SQL,[tenant.ownerUserId,accountId,range?.start ?? "0001-01-01",range?.end ?? "9999-12-31"]),
  ]);
  return projectAccountHistoryReview(rows[0]);
}
