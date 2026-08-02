import "server-only";

import { and, asc, eq, inArray, max } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, dailyPositionSnapshots } from "@/db/schema";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  parseTenantPositionSnapshotDateQuery,
  projectTenantPositionSnapshotRows,
  type TenantPositionSnapshotReadResult,
} from "@/lib/tenant-position-snapshot-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantPositionSnapshotQueryResult =
  | TenantPositionSnapshotReadResult
  | Readonly<{ state: "invalid_request" }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPositionSnapshots({
  tenantContext,
  scope,
  requestedSnapshotDate,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
  requestedSnapshotDate?: string;
}): Promise<TenantPositionSnapshotQueryResult> {
  if (
    requestedSnapshotDate !== undefined &&
    parseTenantPositionSnapshotDateQuery(requestedSnapshotDate) !==
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
      eq(dailyPositionSnapshots.account, accounts.code),
      eq(dailyPositionSnapshots.isSample, false),
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
      return projectTenantPositionSnapshotRows({
        accountRows,
        rows: [],
        scope,
        snapshotDate: null,
      });
    }

    const rows = await db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        source: dailyPositionSnapshots.source,
        isSample: dailyPositionSnapshots.isSample,
        assetId: dailyPositionSnapshots.assetId,
        legacyAssetId: dailyPositionSnapshots.legacyAssetId,
        snapshotAccountId: dailyPositionSnapshots.accountId,
        ownedAccountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountSortOrder: accounts.sortOrder,
        legacyAccountCode: dailyPositionSnapshots.account,
        assetName: dailyPositionSnapshots.assetName,
        ticker: dailyPositionSnapshots.ticker,
        assetType: dailyPositionSnapshots.assetType,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        quantity: dailyPositionSnapshots.quantity,
        currentPrice: dailyPositionSnapshots.currentPrice,
        closePrice: dailyPositionSnapshots.closePrice,
        marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        currentWeight: dailyPositionSnapshots.currentWeight,
        targetWeight: dailyPositionSnapshots.targetWeight,
        belowMa: dailyPositionSnapshots.belowMa,
        priceSource: dailyPositionSnapshots.priceSource,
        priceBasis: dailyPositionSnapshots.priceBasis,
      })
      .from(dailyPositionSnapshots)
      .innerJoin(
        accounts,
        eq(dailyPositionSnapshots.accountId, accounts.id),
      )
      .where(
        and(
          ...snapshotPredicates,
          eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
        ),
      )
      .orderBy(
        asc(accounts.sortOrder),
        asc(accounts.code),
        asc(dailyPositionSnapshots.assetName),
        asc(dailyPositionSnapshots.ticker),
        asc(dailyPositionSnapshots.legacyAssetId),
      );

    return projectTenantPositionSnapshotRows({
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
    .select({ snapshotDate: max(dailyPositionSnapshots.snapshotDate) })
    .from(dailyPositionSnapshots)
    .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
    .where(and(...predicates));

  return rows[0]?.snapshotDate ?? null;
}
