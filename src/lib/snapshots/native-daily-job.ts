import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, appUsers } from "@/db/schema";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { saveNativeSnapshots } from "@/db/queries/native-portfolio-snapshots";
import { buildTrackedCurrencyPortfolio } from "@/lib/currency-tracked-portfolio";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Existing scheduler, separate evidence namespace. Captures observed values now;
 * it does not backdate current quantities or overwrite an earlier daily record. */
export async function runNativeDailySnapshotJob({ dryRun = true }: { dryRun?: boolean } = {}) {
  const targets = await db.select({ accountId: accounts.id, code: accounts.code, name: accounts.name, ownerUserId: appUsers.id, role: appUsers.role })
    .from(accounts).innerJoin(appUsers, eq(accounts.canonicalOwnerUserId, appUsers.id))
    .where(and(eq(accounts.isActive, true), isNotNull(accounts.nativeState), eq(appUsers.status, "active"), inArray(appUsers.role, ["user", "admin"])))
    .orderBy(asc(appUsers.id), asc(accounts.id));
  const owners = Map.groupBy(targets, row => row.ownerUserId);
  const results = await mapWithConcurrency([...owners.values()], 2, async group => {
    const asOf = new Date();
    return mapWithConcurrency(group, 2, async row => {
      try {
        const tenant: TenantContext = { ownerUserId: row.ownerUserId, role: row.role as TenantContext["role"] };
        const evidence = await getTrackedCurrencyEvidence(tenant, { kind: "account", key: `account:${row.accountId}`, accountId: row.accountId, accountCode: row.code, label: row.name }, "USD", { asOf, collect: false });
        const ready = (["KRW", "USD"] as const).some(reporting => buildTrackedCurrencyPortfolio({ ...evidence, reporting }).current?.complete);
        if (!ready) return { status: "blocked", created: 0 };
        return dryRun ? { status: "ready", created: 0 } : await saveNativeSnapshots(tenant, evidence);
      } catch {
        // One missing provider observation/account cannot suppress other owners.
        return { status: "failed", created: 0 };
      }
    });
  });
  const flat = results.flat();
  return { status: flat.some(row => row.status !== "ready") ? "partial" as const : "completed" as const, dryRun,
    targetCount: targets.length, created: flat.reduce((sum, row) => sum + row.created, 0),
    blockedCount: flat.filter(row => !["ready", "failed"].includes(row.status)).length,
    failedCount: flat.filter(row => row.status === "failed").length };
}
