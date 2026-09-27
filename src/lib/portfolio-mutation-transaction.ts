import "server-only";

import { sqlClient } from "@/db/client";
import { snapshotFence } from "@/lib/snapshots/write-context";

/** Every writer changing active account/holding/group membership uses this lock. */
export async function runPortfolioMutation(
  ownerUserId: string,
  query: string,
  parameters: unknown[],
): Promise<Record<string, unknown>[]> {
  const fence=snapshotFence.getStore();
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("select set_config('lock_timeout','2s',true),set_config('app.trade_reliability_version','0059',true)"),
    transaction.query("set local statement_timeout = '8s'"),
    // A separate statement is essential: READ COMMITTED must take the mutation
    // snapshot after a preceding owner mutation has committed and released this lock.
    transaction.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `varda.portfolio_mutation.v1:${ownerUserId}`,
    ]),
    ...(fence ? [transaction.query("select assert_daily_snapshot_fence($1::uuid,$2)",[fence.id,fence.generation])] : []),
    transaction.query(query, parameters),
  ], { isolationLevel: "ReadCommitted" });
  return results.at(-1) ?? [];
}
