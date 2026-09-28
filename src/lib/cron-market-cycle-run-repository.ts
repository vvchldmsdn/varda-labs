import "server-only";

import { sqlClient } from "@/db/client";
import { CRON_MARKET_CYCLE_LIMITS } from "@/lib/cron-market-cycle";

const JOB_TYPE = "market_cycle";
const JOB_MODE = "daily";
const JOB_SOURCE = "varda_cron_market_cycle";

export type CronMarketCycleClaim =
  | { outcome: "claimed"; runId: string }
  | {
      outcome: "already_attempted" | "active_conflict" | "lock_busy";
      runId: string | null;
      status: string | null;
    };

type ClaimRow = {
  outcome: CronMarketCycleClaim["outcome"];
  run_id: string | null;
  status: string | null;
};

export async function claimCronMarketCycleRun({
  snapshotDate,
  startedAt,
  cronScheduleUtc,
  phase = "daily",
}: {
  snapshotDate: string;
  startedAt: Date;
  cronScheduleUtc: string | null;
  phase?: "daily" | "pre_cutoff";
}): Promise<CronMarketCycleClaim> {
  const activeSince = new Date(
    startedAt.getTime() -
      CRON_MARKET_CYCLE_LIMITS.activeRunLeaseMinutes * 60 * 1000,
  );
  const metadata = JSON.stringify({
    snapshotDate,
    phase,
    outcome: "claimed",
    cronScheduleUtc,
    secretsIncluded: false,
  });
  const rows = (await sqlClient.query(
    `
      with lock_attempt as materialized (
        select pg_try_advisory_xact_lock(
          hashtextextended('varda:cron:market-cycle:v1', 0)
        ) as acquired
      ),
      exact_existing as materialized (
        select id, status
        from market_data_sync_runs
        where job_type = $1
          and mode = $2
          and source = $3
          and metadata_json ->> 'snapshotDate' = $4
          and (started_at>$6::timestamptz-interval '5 minutes'
            or (select count(*) from market_data_sync_runs r where r.job_type=$1 and r.mode=$2 and r.source=$3 and r.metadata_json->>'snapshotDate'=$4)>=4)
        order by started_at desc
        limit 1
      ),
      active_existing as materialized (
        select id, status
        from market_data_sync_runs
        where job_type = $1
          and mode = $2
          and source = $3
          and status = 'running'
          and started_at >= $5::timestamptz
        order by started_at desc
        limit 1
      ),
      inserted as (
        insert into market_data_sync_runs (
          job_type,
          mode,
          status,
          started_at,
          source,
          requested_count,
          success_count,
          failed_count,
          skipped_count,
          metadata_json
        )
        select $1, $2, 'running', $6::timestamptz, $3, 0, 0, 0, 0, $7::jsonb
        from lock_attempt
        where acquired
          and not exists (select 1 from exact_existing)
          and not exists (select 1 from active_existing)
        returning id, status
      )
      select 'claimed'::text as outcome, id as run_id, status
      from inserted
      union all
      select 'already_attempted', id, status
      from exact_existing
      where not exists (select 1 from inserted)
      union all
      select 'active_conflict', id, status
      from active_existing
      where not exists (select 1 from inserted)
        and not exists (select 1 from exact_existing)
      union all
      select 'lock_busy', null::uuid, null::text
      from lock_attempt
      where not acquired
        and not exists (select 1 from inserted)
        and not exists (select 1 from exact_existing)
        and not exists (select 1 from active_existing)
      limit 1
    `,
    [
      JOB_TYPE,
      phase === "pre_cutoff" ? "pre_cutoff" : JOB_MODE,
      JOB_SOURCE,
      snapshotDate,
      activeSince.toISOString(),
      startedAt.toISOString(),
      metadata,
    ],
  )) as ClaimRow[];
  const row = rows[0];

  if (!row) {
    return { outcome: "lock_busy", runId: null, status: null };
  }
  if (row.outcome === "claimed") {
    return row.run_id
      ? { outcome: "claimed", runId: row.run_id }
      : { outcome: "lock_busy", runId: null, status: null };
  }
  return {
    outcome: row.outcome,
    runId: row.run_id,
    status: row.status,
  };
}

export async function finishCronMarketCycleRun({
  runId,
  status,
  finishedAt,
  requestedCount,
  successCount,
  failedCount,
  skippedCount,
  metadata,
  error,
}: {
  runId: string;
  status: "completed" | "blocked" | "failed";
  finishedAt: Date;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  metadata: Record<string, unknown>;
  error?: string | null;
}) {
  const rows=await sqlClient.query(`update market_data_sync_runs set status=$2,finished_at=$3::timestamptz,requested_count=$4,success_count=$5,failed_count=$6,skipped_count=$7,metadata_json=$8::jsonb,error=$9
    where id=$1::uuid and status='running' and started_at>clock_timestamp()-interval '30 minutes'
    and not exists(select 1 from market_data_sync_runs newer where newer.source=market_data_sync_runs.source and newer.mode=market_data_sync_runs.mode and newer.started_at>market_data_sync_runs.started_at)
    returning id`,[runId,status,finishedAt.toISOString(),requestedCount,successCount,failedCount,skippedCount,JSON.stringify({...metadata,secretsIncluded:false}),error??null]);
  if(rows.length!==1) throw new Error("cron_run_lease_lost");
}
