import "server-only";

import { and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, appUsers, assets } from "@/db/schema";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import type { TenantContext } from "@/lib/session-resolver-contract";
import {
  DailySnapshotRequestError,
  runDailySnapshot,
} from "@/lib/snapshots/daily";
import { ALL_SNAPSHOT_ACCOUNTS } from "@/lib/snapshots/account-target";
import {
  buildDailySnapshotJobResult,
  type DailySnapshotJobResult,
  type DailySnapshotTenantResult,
} from "@/lib/snapshots/daily-job-result";
import { SNAPSHOT_INVESTMENT_ASSET_TYPES } from "@/lib/snapshots/investment-eligibility";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

type DailySnapshotJobOptions = {
  dryRun?: boolean;
  snapshotDate?: string;
  now?: Date;
};

export async function runDailySnapshotJob(
  options: DailySnapshotJobOptions = {},
): Promise<DailySnapshotJobResult> {
  const dryRun = options.dryRun ?? true;
  const requestedAccount = ALL_SNAPSHOT_ACCOUNTS;
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

  const results = await mapWithConcurrency(
    targets,
    2,
    async (tenantContext): Promise<DailySnapshotTenantResult> => {
      try {
        const result = await runDailySnapshot({
          tenantContext,
          dryRun,
          snapshotDate,
          account: requestedAccount,
          now: options.now,
        });
        return {
          ownerUserId: tenantContext.ownerUserId,
          status: result.writeReady
            ? dryRun
              ? "ready"
              : "written"
            : "blocked",
          result,
        };
      } catch (error) {
        if (!(error instanceof DailySnapshotRequestError)) throw error;
        return {
          ownerUserId: tenantContext.ownerUserId,
          status: "failed",
          error: {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          },
        };
      }
    },
  );

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
        ne(accounts.accountType, "cash"),
      ),
    )
    .innerJoin(
      assets,
      and(
        eq(assets.accountId, accounts.id),
        eq(assets.canonicalOwnerUserId, appUsers.id),
        isNull(assets.archivedAt),
        inArray(assets.assetType, SNAPSHOT_INVESTMENT_ASSET_TYPES),
        or(gt(assets.quantity, "0"), gt(assets.fractionalKrwValue, "0")),
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
