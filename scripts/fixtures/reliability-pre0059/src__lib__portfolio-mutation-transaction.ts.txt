import "server-only";

import { sqlClient } from "@/db/client";

/** Every writer changing active account/holding/group membership uses this lock. */
export async function runPortfolioMutation(
  ownerUserId: string,
  query: string,
  parameters: unknown[],
): Promise<Record<string, unknown>[]> {
  const results = await sqlClient.transaction((transaction) => [
    transaction.query("set local lock_timeout = '2s'"),
    transaction.query("set local statement_timeout = '8s'"),
    // A separate statement is essential: READ COMMITTED must take the mutation
    // snapshot after a preceding owner mutation has committed and released this lock.
    transaction.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `varda.portfolio_mutation.v1:${ownerUserId}`,
    ]),
    transaction.query(query, parameters),
  ], { isolationLevel: "ReadCommitted" });
  return results[3] ?? [];
}
