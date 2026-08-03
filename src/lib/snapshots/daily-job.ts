import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, appUsers } from "@/db/schema";
import type { TenantContext } from "@/lib/session-resolver-contract";
import {
  DailySnapshotRequestError,
  runDailySnapshot,
  type SnapshotAccount,
} from "@/lib/snapshots/daily";
import {
  buildDailySnapshotJobResult,
  type DailySnapshotJobResult,
  type DailySnapshotTenantResult,
} from "@/lib/snapshots/daily-job-result";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const SNAPSHOT_ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;

type DailySnapshotJobOptions = {
  dryRun?: boolean;
  snapshotDate?: string;
  account?: SnapshotAccount;
  now?: Date;
};

export async function runDailySnapshotJob(
  options: DailySnapshotJobOptions = {},
): Promise<DailySnapshotJobResult> {
  const dryRun = options.dryRun ?? true;
  const requestedAccount = options.account ?? "all";
  const snapshotDate =
    options.snapshotDate ?? resolveSnapshotCycle(options.now).snapshotDate;
  const targets = await loadActiveSnapshotTenantContexts();

  if (targets.length === 0) {
    throw new DailySnapshotRequestError(
      "no_active_snapshot_targets",
      "No active portfolio owners are eligible for the daily snapshot job",
      {},
      409,
    );
  }

  const results: DailySnapshotTenantResult[] = [];
  for (const tenantContext of targets) {
    try {
      const result = await runDailySnapshot({
        tenantContext,
        dryRun,
        snapshotDate,
        account: requestedAccount,
        now: options.now,
      });
      results.push({
        ownerUserId: tenantContext.ownerUserId,
        status: result.writeReady ? (dryRun ? "ready" : "written") : "blocked",
        result,
      });
    } catch (error) {
      if (!(error instanceof DailySnapshotRequestError)) throw error;
      results.push({
        ownerUserId: tenantContext.ownerUserId,
        status: "failed",
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        },
      });
    }
  }

  return buildDailySnapshotJobResult({
    dryRun,
    snapshotDate,
    requestedAccount,
    targets: results,
  });
}

async function loadActiveSnapshotTenantContexts(): Promise<TenantContext[]> {
  const rows = await db
    .selectDistinct({
      ownerUserId: appUsers.id,
      role: appUsers.role,
    })
    .from(appUsers)
    .innerJoin(
      accounts,
      and(
        eq(accounts.canonicalOwnerUserId, appUsers.id),
        eq(accounts.isActive, true),
        inArray(accounts.code, SNAPSHOT_ACCOUNT_CODES),
      ),
    )
    .where(
      and(
        eq(appUsers.status, "active"),
        inArray(appUsers.role, ["user", "admin"]),
      ),
    )
    .orderBy(asc(appUsers.id));

  return rows.map((row) => ({
    ownerUserId: row.ownerUserId,
    role: row.role as TenantContext["role"],
  }));
}
