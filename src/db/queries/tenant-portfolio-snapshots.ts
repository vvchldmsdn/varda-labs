import "server-only";

import { and, asc, eq, inArray, max } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, dailyPortfolioSnapshots } from "@/db/schema";
import { loadOwnedActiveSnapshotAccounts } from "@/db/queries/tenant-snapshot-accounts";
import {
  projectTenantPortfolioSnapshotRows,
  type TenantPortfolioSnapshotReadResult,
} from "@/lib/tenant-portfolio-snapshot-read-model";
import { parseTenantSnapshotDateQuery } from "@/lib/tenant-snapshot-date-query";
import type { TenantContext } from "@/lib/session-resolver-contract";
import {
  tenantSnapshotScopeMatchesAccount,
  type TenantSnapshotScope,
} from "@/lib/tenant-snapshot-scope";

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
  scope: TenantSnapshotScope;
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
    const accountRows = (await loadOwnedActiveSnapshotAccounts(tenantContext)).filter(
      (account) => tenantSnapshotScopeMatchesAccount(scope, account),
    );
    if (accountRows.length === 0) {
      return projectTenantPortfolioSnapshotRows({
        accountRows,
        rows: [],
        scope,
        snapshotDate: requestedSnapshotDate ?? null,
      });
    }
    const accountIds = accountRows.map((account) => account.accountId);
    const snapshotPredicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.id, accountIds),
      eq(dailyPortfolioSnapshots.account, accounts.code),
      eq(dailyPortfolioSnapshots.isSample, false),
    ];

    const snapshotDate =
      requestedSnapshotDate === undefined
        ? await findLatestOwnedSnapshotDate(snapshotPredicates)
        : requestedSnapshotDate;

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
