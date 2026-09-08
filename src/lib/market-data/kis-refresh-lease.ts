import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sqlClient } from "@/db/client";

// Longer than the longest deployed market job (300 seconds); a terminated
// process cannot leave the provider permanently locked. No session secrets.
export const KIS_REFRESH_LEASE_SECONDS = 600;
const context = new AsyncLocalStorage<{ expiresAt: number; active: boolean }>();

export class KisRefreshLeaseBusyError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("KIS provider refresh is already running or cooling down");
    this.name = "KisRefreshLeaseBusyError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export function kisRefreshCooldownSeconds() {
  const configured = Number(process.env.KIS_JOB_COOLDOWN_SECONDS);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : 90;
}

/** The capability is private AsyncLocalStorage, never a request/form parameter. */
export async function withKisRefreshLease<T>(task: () => Promise<T>): Promise<T> {
  const existing = context.getStore();
  if (existing) {
    if (!existing.active || Date.now() >= existing.expiresAt) {
      throw new KisRefreshLeaseBusyError(1);
    }
    return task();
  }

  const runId = randomUUID();
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    // Must be a preceding statement, so the claim snapshot sees the last holder.
    transaction.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["varda.kis_provider_refresh.v1"]),
    transaction.query(CLAIM_SQL, [runId, kisRefreshCooldownSeconds(), KIS_REFRESH_LEASE_SECONDS]),
  ], { isolationLevel: "ReadCommitted" });
  const row = results[3]?.[0];
  if (row?.claimed !== true) {
    throw new KisRefreshLeaseBusyError(Number(row?.retry_after_seconds ?? 1));
  }
  const expiresAt = new Date(String(row.expires_at)).getTime();
  if (!Number.isFinite(expiresAt)) throw new Error("Invalid provider lease expiration");
  const lease = { expiresAt, active: true };
  let status = "failed";
  try {
    const value = await context.run(lease, task);
    status = "completed";
    return value;
  } finally {
    lease.active = false;
    await sqlClient.query(
      `update market_data_sync_runs set status = $2, finished_at = clock_timestamp()
       where id = $1::uuid and job_type = 'kis_provider_lease' and status = 'running'`,
      [runId, status],
    );
  }
}

const CLAIM_SQL = `
with recent as materialized (
  select status, started_at, finished_at
  from market_data_sync_runs
  where source = 'kis'
    and job_type in ('kis_provider_lease', 'asset_price_sync')
    and started_at >= statement_timestamp() - make_interval(secs => $2::integer + $3::integer)
    and metadata_json ->> 'dryRun' is distinct from 'true'
), blocking as materialized (
  select max(case when status = 'running'
    then started_at + make_interval(secs => $3::integer)
    else coalesce(finished_at, started_at) + make_interval(secs => $2::integer)
  end) as until_at from recent
), claimed as (
  insert into market_data_sync_runs (id, job_type, mode, status, started_at, source, metadata_json)
  select $1::uuid, 'kis_provider_lease', 'shared', 'running', statement_timestamp(), 'kis',
    jsonb_build_object('leaseSeconds', $3::integer)
  from blocking where until_at is null or until_at <= statement_timestamp()
  returning started_at
)
select exists(select 1 from claimed) as claimed,
  (select started_at + make_interval(secs => $3::integer) from claimed) as expires_at,
  greatest(1, ceil(extract(epoch from (blocking.until_at - statement_timestamp()))))::integer as retry_after_seconds
from blocking
`;
