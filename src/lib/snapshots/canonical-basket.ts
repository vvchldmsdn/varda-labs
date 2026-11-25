import "server-only";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { canonicalBasketIncludes, parseCanonicalClose } from "../cairn-v2/canonical-close";
import { CANONICAL_CLOSE_SCOPE_SQL } from "../cairn-v2/period-attribution-sql";

export async function readDailyCloseBaskets(owner: string, accounts: readonly string[], day: string) {
  const scopes = new Map<string, {
    proof: { date: string; receipt: unknown } | null;
    accepts: ReturnType<typeof canonicalBasketIncludes> | null;
  }>();
  if (!accounts.length) return scopes;
  const rows = await runTenantReadTransaction(owner, tx =>
    accounts.map(id => tx.query(CANONICAL_CLOSE_SCOPE_SQL, [id, day])));
  rows.forEach((result, index) => {
    const row = result[0];
    const proof = row && typeof row.date === "string" ? { date: row.date, receipt: row.receipt } : null;
    const policy = proof && parseCanonicalClose(proof.receipt, proof.date);
    if (row && !policy) throw new Error("invalid_canonical_close_basket");
    scopes.set(accounts[index], { proof, accepts: policy ? canonicalBasketIncludes(policy) : null });
  });
  return scopes;
}
export type DailyCloseBaskets = Awaited<ReturnType<typeof readDailyCloseBaskets>>;

// Re-read under the same owner lock as any replacement of an approved close.
// A first materialization racing a planner that saw no policy also invalidates the plan.
export const ASSERT_DAILY_CLOSE_BASKET_SQL = `select 1/(case when
  (select jsonb_build_object('date',s.date,'receipt',s.receipt) from (${CANONICAL_CLOSE_SCOPE_SQL}) s)
    is not distinct from $3::jsonb then 1 else 0 end)`;
