import "server-only";
import { randomUUID } from "node:crypto";
import { sqlClient } from "@/db/client";
import { MARKET_COLLECTION_POLICY, normalizeCollectionJobs, type CollectionInput, type CollectionJob } from "@/lib/market-data/collection-policy";

export type ClaimedCollectionJob = CollectionJob & { claimToken: string; attempts: number };
export type CollectionPartition = { provider: "kis" } | { provider: "twelve_data"; scopeHash: string };
const KIS_PARTITION: CollectionPartition = { provider: "kis" };

function partitionPrefix(partition: CollectionPartition) {
  if (partition.provider === "kis") return "kis:";
  if (partition.provider !== "twelve_data" || !/^[a-f0-9]{64}$/.test(partition.scopeHash)) throw new Error("collection_partition_invalid");
  return `twelve_data:${partition.scopeHash}:`;
}

/** Call only after verifying session holdings/catalog or machine authority. */
export async function enqueueMarketCollection(inputs: readonly CollectionInput[]) {
  const jobs = normalizeCollectionJobs(inputs);
  return enqueueJobs(jobs);
}

/** Internal server seam; callers must resolve licensed identities before enqueueing. */
export async function enqueueProviderCollectionJobs(partition: CollectionPartition, jobs: readonly CollectionJob[]) {
  const prefix = partitionPrefix(partition);
  if (partition.provider !== "twelve_data" || jobs.length > 400 || new Set(jobs.map((job) => job.key)).size !== jobs.length || jobs.some((job) =>
    !job.key.startsWith(prefix) || job.key.length > 200 || !/^[A-Za-z0-9:._-]+$/.test(job.key) ||
    job.market !== "us" || job.currency !== "USD" || !/^[A-Z0-9][A-Z0-9.\-]{0,19}$/.test(job.ticker) ||
    !["live", "history", "fx"].includes(job.kind) ||
    (job.kind === "history" ? !validWindow(job.startDate, job.endDate) : job.startDate !== null || job.endDate !== null))) {
    throw new Error("collection_identity_invalid");
  }
  return enqueueJobs(jobs);
}

function validWindow(start: string | null, end: string | null) {
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const first = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(first) && Number.isFinite(last) && new Date(first).toISOString().slice(0, 10) === start &&
    new Date(last).toISOString().slice(0, 10) === end && last >= first && last - first < 90 * 86_400_000;
}

async function enqueueJobs(jobs: readonly CollectionJob[]) {
  if (jobs.length === 0) return { queuedCount: 0, retryAfterSeconds: 10 };
  const results = await sqlClient.transaction((tx) => [
    tx.query("set local lock_timeout = '2s'"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["varda.market_collection.enqueue.v1"]),
    tx.query(ENQUEUE_SQL, [JSON.stringify(jobs), MARKET_COLLECTION_POLICY.maximumPendingJobs]),
  ], { isolationLevel: "ReadCommitted" });
  const row = results[2]?.[0];
  if (Number(row?.accepted_count) !== jobs.length) throw new Error("collection_queue_capacity");
  return { queuedCount: jobs.length, retryAfterSeconds: MARKET_COLLECTION_POLICY.pollAfterSeconds };
}

export async function claimMarketCollection(partition: CollectionPartition = KIS_PARTITION): Promise<ClaimedCollectionJob | null> {
  const claimToken = randomUUID();
  const rows = await sqlClient.query(CLAIM_SQL, [claimToken, MARKET_COLLECTION_POLICY.jobLeaseSeconds, MARKET_COLLECTION_POLICY.maximumAttempts, partitionPrefix(partition)]);
  const row = rows[0];
  if (!row) return null;
  return { key: String(row.key), kind: row.kind as CollectionJob["kind"], ticker: String(row.ticker),
    market: row.market as CollectionJob["market"], currency: row.currency as CollectionJob["currency"],
    startDate: row.start_date_text == null ? null : String(row.start_date_text),
    endDate: row.end_date_text == null ? null : String(row.end_date_text),
    claimToken, attempts: Number(row.attempts) };
}

export async function hasReadyMarketCollection(partition: CollectionPartition = KIS_PARTITION) {
  const rows = await sqlClient.query(`select 1 from market_collection_jobs where
    ((status='pending' and available_at<=now()) or (status='running' and leased_until<=now()))
    and starts_with(key,$1) limit 1`, [partitionPrefix(partition)]);
  return rows.length > 0;
}

/** Writers must additionally enforce this token in their own write transaction. */
export async function isMarketCollectionClaimCurrent(job: ClaimedCollectionJob) {
  const rows = await sqlClient.query(`select 1 from market_collection_jobs
    where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp()`, [job.key, job.claimToken]);
  return rows.length === 1;
}

export async function maintainMarketCollection(partition: CollectionPartition = KIS_PARTITION) {
  await sqlClient.query(`update market_collection_jobs set status='failed', claim_token=null, leased_until=null,
    available_at=now()+interval '1 hour', last_code='worker_interrupted', updated_at=now()
    where status='running' and leased_until<=now() and attempts >= $1::integer and starts_with(key,$2)`, [MARKET_COLLECTION_POLICY.maximumAttempts, partitionPrefix(partition)]);
  await sqlClient.query(`delete from market_collection_jobs where key in (
    select key from market_collection_jobs where status in ('done','failed') and updated_at < now()-interval '7 days' and starts_with(key,$1)
    order by updated_at limit 500)`, [partitionPrefix(partition)]);
}

export async function finishMarketCollection(job: ClaimedCollectionJob, outcome: { ok: boolean; code: string; retryAfterSeconds?: number; deferred?: boolean }) {
  await sqlClient.query(`update market_collection_jobs set
    status = case when $3::boolean then 'done' when not $7::boolean and attempts >= $6::integer then 'failed' else 'pending' end,
    attempts = greatest(0,attempts-case when $7::boolean then 1 else 0 end),
    available_at = clock_timestamp() + make_interval(secs => $4::integer),
    completed_at = case when $3::boolean then clock_timestamp() else null end,
    claim_token = null, leased_until = null, last_code = $5,
    updated_at = clock_timestamp()
    where key = $1 and claim_token = $2::uuid and status = 'running'`,
  [job.key, job.claimToken, outcome.ok, outcome.retryAfterSeconds ?? 0, outcome.code, MARKET_COLLECTION_POLICY.maximumAttempts, outcome.deferred ?? false]);
}

/** Admin worker summary only: no ticker, account, owner or credential material. */
export async function getMarketCollectionSummary() {
  const [row] = await sqlClient.query(`select
    count(*) filter (where status = 'pending')::integer as pending,
    count(*) filter (where status = 'running')::integer as running,
    count(*) filter (where status = 'failed')::integer as failed,
    count(*) filter (where status = 'done' and completed_at > now() - interval '1 day')::integer as completed_today,
    coalesce(sum(greatest(request_count - 1, 0)), 0)::bigint as merged_requests,
    coalesce(max(extract(epoch from now() - enqueued_at)) filter (where status = 'pending'), 0)::integer as oldest_pending_seconds
    from market_collection_jobs`);
  return { pending: Number(row?.pending ?? 0), running: Number(row?.running ?? 0), failed: Number(row?.failed ?? 0),
    completedToday: Number(row?.completed_today ?? 0), mergedRequests: Number(row?.merged_requests ?? 0), oldestPendingSeconds: Number(row?.oldest_pending_seconds ?? 0) };
}

const ENQUEUE_SQL = `with input as materialized (
  select * from jsonb_to_recordset($1::jsonb) as x(key text,kind text,ticker text,market text,currency text,"startDate" date,"endDate" date)
), capacity as materialized (
  select (select count(*) from market_collection_jobs where status in ('pending','running')) +
    (select count(*) from input i where not exists(select 1 from market_collection_jobs q where q.key=i.key and q.status in ('pending','running'))) <= $2::integer as ok
), written as (
  insert into market_collection_jobs (key,kind,ticker,market,currency,start_date,end_date)
  select key,kind,ticker,market,currency,"startDate","endDate" from input where (select ok from capacity)
  on conflict (key) do update set request_count = case when market_collection_jobs.status in ('pending','running') then market_collection_jobs.request_count + 1 else 1 end,
    ticker = case when market_collection_jobs.kind='fx' and market_collection_jobs.status in ('pending','failed') and market_collection_jobs.attempts>0 then excluded.ticker else market_collection_jobs.ticker end,
    status = case when market_collection_jobs.available_at <= now() and (market_collection_jobs.status='done' and market_collection_jobs.kind in ('live','fx') or market_collection_jobs.status in ('done','failed') and coalesce(market_collection_jobs.completed_at, market_collection_jobs.updated_at) <= now()-interval '5 minutes') then 'pending' else market_collection_jobs.status end,
    enqueued_at = case when market_collection_jobs.available_at <= now() and (market_collection_jobs.status='done' and market_collection_jobs.kind in ('live','fx') or market_collection_jobs.status in ('done','failed') and coalesce(market_collection_jobs.completed_at, market_collection_jobs.updated_at) <= now()-interval '5 minutes') then now() else market_collection_jobs.enqueued_at end,
    attempts = case when market_collection_jobs.available_at <= now() and (market_collection_jobs.status='done' and market_collection_jobs.kind in ('live','fx') or market_collection_jobs.status in ('done','failed') and coalesce(market_collection_jobs.completed_at, market_collection_jobs.updated_at) <= now()-interval '5 minutes') then 0 else market_collection_jobs.attempts end
  returning key
) select count(*)::integer as accepted_count from written`;

const CLAIM_SQL = `with candidate as (
  select key from market_collection_jobs where
    (status = 'pending' and available_at <= now() or status = 'running' and leased_until <= now())
    and attempts < $3::integer
    and starts_with(key,$4)
  order by enqueued_at - case when kind in ('live','fx') then interval '30 seconds' else interval '0 seconds' end, key
  for update skip locked limit 1
) update market_collection_jobs q set status='running', claim_token=$1::uuid,
  leased_until=clock_timestamp()+make_interval(secs=>$2::integer), attempts=q.attempts+1, updated_at=clock_timestamp()
  from candidate c where q.key=c.key returning q.*,q.start_date::text as start_date_text,q.end_date::text as end_date_text`;
