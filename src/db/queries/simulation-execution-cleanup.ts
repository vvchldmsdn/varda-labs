import "server-only";
import { randomUUID } from "node:crypto";
import { sqlClient } from "@/db/client";

/** Server job role only; never exposed through tenant query inputs. */
export async function cleanupSimulationExecutions() {
  // One end-to-end budget, including lease acquisition and durable completion.
  // Leave headroom below both the 60s lease and the route's 60s runtime limit.
  const deadline = Date.now() + 45_000;
  const signal = AbortSignal.timeout(50_000);
  const bounded = (milliseconds: number) => ({ fetchOptions: { signal: AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) } });
  const token = randomUUID();
  const claimed = await sqlClient.query(`update simulation_execution_service set cleanup_lease=$1::uuid,cleanup_lease_until=clock_timestamp()+interval '60 seconds',cleanup_started_at=clock_timestamp()
    where id and (cleanup_lease_until is null or cleanup_lease_until<clock_timestamp()) returning id`, [token], bounded(8_000));
  if (!claimed.length) return { status: "busy", removed: 0, mayHaveMore: true };
  let removed = 0, mayHaveMore = false;
  try {
  // At most 16 short transactions / 32 executions; SKIP LOCKED allows other jobs.
  for (let batch = 0; batch < 16 && Date.now() + 13_000 < deadline; batch++) {
  const [, rows] = await sqlClient.transaction(tx => [tx.query("select set_config('statement_timeout','7000',true),set_config('lock_timeout','2000',true)"),tx.query(`with selected as (
    select owner_user_id,id from simulation_executions
    where (expires_at<=clock_timestamp() or (state<>'ready' and created_at<clock_timestamp()-interval '30 minutes'))
    and exists(select 1 from simulation_execution_service where id and cleanup_lease=$1::uuid and cleanup_lease_until>clock_timestamp())
    order by expires_at,owner_user_id,id for update skip locked limit 2
  ) delete from simulation_executions e using selected s
    where e.owner_user_id=s.owner_user_id and e.id=s.id returning 1 as removed`, [token])], { isolationLevel: "ReadCommitted", ...bounded(8_000) });
    removed += rows.length; mayHaveMore = rows.length === 2;
    if (!mayHaveMore) break;
  }
  const finished = await sqlClient.query(`update simulation_execution_service set cleanup_lease=null,cleanup_lease_until=null,
    cleanup_succeeded_at=clock_timestamp(),cleanup_removed=$2,
    cleanup_backlog=(select count(*) from simulation_executions where expires_at<=clock_timestamp() or (state<>'ready' and created_at<clock_timestamp()-interval '30 minutes')),
    cleanup_oldest_expired_at=(select min(expires_at) from simulation_executions where expires_at<=clock_timestamp())
    where id and cleanup_lease=$1::uuid and cleanup_lease_until>clock_timestamp()
    returning cleanup_succeeded_at as "completedAt",cleanup_backlog as backlog,cleanup_oldest_expired_at as "oldestExpiredAt"`, [token, removed], bounded(5_000));
  if (!finished.length) throw Error("cleanup_lease_lost");
  return { status: "completed", removed, mayHaveMore: finished[0].backlog > 0, ...finished[0] };
  } catch {
    await sqlClient.query("update simulation_execution_service set cleanup_failed_at=clock_timestamp(),cleanup_lease=null,cleanup_lease_until=null where id and cleanup_lease=$1::uuid", [token], bounded(3_000)).catch(() => undefined);
    throw Error("cleanup_unavailable");
  }
}
