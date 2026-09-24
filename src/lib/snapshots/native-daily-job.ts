import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, appUsers } from "@/db/schema";
import { readNativeCutoffEvidence } from "@/db/queries/native-cutoff-evidence";
import { saveNativeCutoffSnapshots } from "@/db/queries/native-portfolio-snapshots";
import { resolveSnapshotCycle } from "./market-calendar";
import { buildTrackedCurrencyPortfolio } from "@/lib/currency-tracked-portfolio";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Reconstruct the selected 07:00 cutoff, independently of worker delay. */
export async function runNativeDailySnapshotJob({ dryRun = true, now = new Date(), snapshotDate = resolveSnapshotCycle(now).snapshotDate }: { dryRun?: boolean; now?: Date; snapshotDate?: string } = {}) {
  const targets = await db.select({ accountId: accounts.id, code: accounts.code, name: accounts.name, ownerUserId: appUsers.id, role: appUsers.role })
    .from(accounts).innerJoin(appUsers, eq(accounts.canonicalOwnerUserId, appUsers.id))
    .where(and(isNotNull(accounts.nativeState), eq(appUsers.status, "active"), inArray(appUsers.role, ["user", "admin"])))
    .orderBy(asc(appUsers.id), asc(accounts.id));
  const owners = Map.groupBy(targets, row => row.ownerUserId);
  const results = await mapWithConcurrency([...owners.values()], 2, async group => {
    const asOf = now;
    return mapWithConcurrency(group, 2, async row => {
      try {
        const tenant: TenantContext = { ownerUserId: row.ownerUserId, role: row.role as TenantContext["role"] };
        const evidence = await readNativeCutoffEvidence(tenant, row.accountId, snapshotDate, asOf.toISOString());
        if (!evidence) return { status: "blocked", created: 0 };
        const ready = (["KRW", "USD"] as const).some(reporting => buildTrackedCurrencyPortfolio({ ...evidence, reporting }).current?.complete);
        if (!ready) return { status: "blocked", created: 0 };
        return dryRun ? { status: "ready", created: 0 } : await saveNativeCutoffSnapshots(tenant, evidence, snapshotDate, asOf.toISOString());
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
