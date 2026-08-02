import "server-only";

import { and, asc, eq, inArray, max } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, dailyPortfolioSnapshots } from "@/db/schema";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  projectTenantPortfolioSnapshotRows,
  type TenantPortfolioSnapshotReadResult,
} from "@/lib/tenant-portfolio-snapshot-read-model";
import { parseTenantSnapshotDateQuery } from "@/lib/tenant-snapshot-date-query";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantPortfolioSnapshotQueryResult =
  | TenantPortfolioSnapshotReadResult
  | Readonly<{ state: "invalid_request" }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPortfolioSnapshots({
  tenantContext,
  scope,
  requestedSnapshotDate,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
  requestedSnapshotDate?: string;
}): Promise<TenantPortfolioSnapshotQueryResult> {
  if (
    requestedSnapshotDate !== undefined &&
    parseTenantSnapshotDateQuery(requestedSnapshotDate) !==
      requestedSnapshotDate
  ) {
    return Object.freeze({ state: "invalid_request" });
  }

  try {
    const accountPredicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
    ];
    const snapshotPredicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
      eq(dailyPortfolioSnapshots.account, accounts.code),
      eq(dailyPortfolioSnapshots.isSample, false),
    ];
    if (scope !== "all") {
      accountPredicates.push(eq(accounts.code, scope));
      snapshotPredicates.push(eq(accounts.code, scope));
    }

    const [accountRows, snapshotDate] = await Promise.all([
      db
        .select({
          accountId: accounts.id,
          accountCode: accounts.code,
          accountName: accounts.name,
          accountSortOrder: accounts.sortOrder,
        })
        .from(accounts)
        .where(and(...accountPredicates))
        .orderBy(asc(accounts.sortOrder), asc(accounts.code)),
      requestedSnapshotDate === undefined
        ? findLatestOwnedSnapshotDate(snapshotPredicates)
        : Promise.resolve(requestedSnapshotDate),
    ]);

    if (snapshotDate === null) {
      return projectTenantPortfolioSnapshotRows({
        accountRows,
        rows: [],
        scope,
        snapshotDate: null,
      });
    }

    const rows = await db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
        isSample: dailyPortfolioSnapshots.isSample,
        snapshotAccountId: dailyPortfolioSnapshots.accountId,
        ownedAccountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountSortOrder: accounts.sortOrder,
        legacyAccountCode: dailyPortfolioSnapshots.account,
        cashValue: dailyPortfolioSnapshots.cashValue,
        investedAmount: dailyPortfolioSnapshots.investedAmount,
        totalCost: dailyPortfolioSnapshots.totalCost,
        totalMarketValue: dailyPortfolioSnapshots.totalMarketValue,
        totalPnl: dailyPortfolioSnapshots.totalPnl,
        totalReturnPct: dailyPortfolioSnapshots.totalReturnPct,
        fxRate: dailyPortfolioSnapshots.fxRate,
        usdKrw: dailyPortfolioSnapshots.usdKrw,
        krWeight: dailyPortfolioSnapshots.krWeight,
        usWeight: dailyPortfolioSnapshots.usWeight,
        usdExposurePct: dailyPortfolioSnapshots.usdExposurePct,
        numAssets: dailyPortfolioSnapshots.numAssets,
        numGroups: dailyPortfolioSnapshots.numGroups,
        topHoldingName: dailyPortfolioSnapshots.topHoldingName,
        topHoldingWeight: dailyPortfolioSnapshots.topHoldingWeight,
        capturedAt: dailyPortfolioSnapshots.capturedAt,
      })
      .from(dailyPortfolioSnapshots)
      .innerJoin(
        accounts,
        eq(dailyPortfolioSnapshots.accountId, accounts.id),
      )
      .where(
        and(
          ...snapshotPredicates,
          eq(dailyPortfolioSnapshots.snapshotDate, snapshotDate),
        ),
      )
      .orderBy(asc(accounts.sortOrder), asc(accounts.code));

    return projectTenantPortfolioSnapshotRows({
      accountRows,
      rows,
      scope,
      snapshotDate,
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

async function findLatestOwnedSnapshotDate(
  predicates: Parameters<typeof and>,
) {
  const rows = await db
    .select({ snapshotDate: max(dailyPortfolioSnapshots.snapshotDate) })
    .from(dailyPortfolioSnapshots)
    .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
    .where(and(...predicates));

  return rows[0]?.snapshotDate ?? null;
}
