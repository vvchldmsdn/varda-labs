import { holdingsPortfolioSql } from "@/lib/portfolio-presentation-policy";
import "server-only";

import { sql, and, asc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";

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
import { runSnapshotWork } from "./durable-work";

type DailySnapshotJobOptions = {
  dryRun?: boolean;
  snapshotDate?: string;
  now?: Date;
  durable?:boolean;
  discover?:boolean;
};

export async function runDailySnapshotJob(
  options: DailySnapshotJobOptions = {},
): Promise<DailySnapshotJobResult> {
  const dryRun = options.dryRun ?? true;
  const requestedAccount = ALL_SNAPSHOT_ACCOUNTS;
  const snapshotDate =
    options.snapshotDate ?? resolveSnapshotCycle(options.now).snapshotDate;
  if(options.durable && !dryRun) {
    const totals=await runSnapshotWork("legacy",snapshotDate,async work=>{
      // The shared writer first repairs an invalidated ledger revision. A row
      // count alone cannot certify that a previously completed valuation is valid.
      // No operator unchanged-holdings authorization is manufactured. The
      // ordinary cutoff guard must admit the historical evidence on its own.
      try { await runDailySnapshot({tenantContext:{ownerUserId:work.ownerUserId,role:work.role},account:work.code,snapshotDate:work.snapshotDate,dryRun:false}); return {status:"completed"}; }
      catch(error) { if(error instanceof DailySnapshotRequestError) return {status:"blocked",reason:error.code}; throw error; }
    },{discover:options.discover});
    return {...buildDailySnapshotJobResult({dryRun,snapshotDate,requestedAccount,targets:[]}),...totals,ok:totals.failedCount===0&&totals.blockedCount===0,writeReady:totals.failedCount===0&&totals.blockedCount===0};
  }
  const targets = await loadActiveSnapshotTenantContexts();

  const results = await mapWithConcurrency(
    targets,
    2,
    async (target): Promise<DailySnapshotTenantResult> => {
      const tenantContext={ownerUserId:target.ownerUserId,role:target.role};
      try {
        const result = await runDailySnapshot({
          tenantContext,
          dryRun,
          snapshotDate,
          account: target.code,
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
        return {
          ownerUserId: tenantContext.ownerUserId,
          status: "failed",
          error: {
            code: error instanceof DailySnapshotRequestError ? error.code : "snapshot_write_failed",
            message: "Snapshot could not be completed",
            statusCode: error instanceof DailySnapshotRequestError ? error.statusCode : 500,
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

async function loadActiveSnapshotTenantContexts(): Promise<(TenantContext & {code:string})[]> {
  const rows = await db
    .selectDistinct({
      ownerUserId: appUsers.id,
      role: appUsers.role,
      code:accounts.code,
    })
    .from(appUsers)
    .innerJoin(
      accounts,
      and(
        eq(accounts.canonicalOwnerUserId, appUsers.id),
        eq(accounts.isActive, true),
        sql.raw(holdingsPortfolioSql("accounts")),
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
    code:row.code,
  }));
}
