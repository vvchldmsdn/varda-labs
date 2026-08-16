import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { accounts, assets } from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import {
  projectTenantHoldingRows,
  type TenantHoldingReadResult,
} from "@/lib/tenant-holding-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantHoldingQueryResult =
  | TenantHoldingReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantHoldings({
  tenantContext,
  serviceDate,
  scope,
}: {
  tenantContext: TenantContext;
  serviceDate: string;
  scope: PortfolioAnalysisScope;
}): Promise<TenantHoldingQueryResult> {
  try {
    const predicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(assets.account, accounts.code),
    ];
    if (scope.kind === "account") {
      predicates.push(eq(accounts.id, scope.accountId));
    }
    if (scope.kind === "portfolio_group") {
      const membershipTargets = await getPortfolioAnalysisScopeTargets({
        scope,
        serviceDate,
        tenantContext,
      });
      const membershipPredicate =
        membershipTargets.wholeAccountIds.length > 0 &&
        membershipTargets.directAssetIds.length > 0
          ? or(
              inArray(accounts.id, membershipTargets.wholeAccountIds),
              inArray(assets.id, membershipTargets.directAssetIds),
            )
          : membershipTargets.wholeAccountIds.length > 0
            ? inArray(accounts.id, membershipTargets.wholeAccountIds)
            : membershipTargets.directAssetIds.length > 0
              ? inArray(assets.id, membershipTargets.directAssetIds)
              : null;
      if (!membershipPredicate) {
        return projectTenantHoldingRows([], scope);
      }
      predicates.push(membershipPredicate);
    }

    const rows = await db
      .select({
        assetId: assets.id,
        assetAccountId: assets.accountId,
        ownedAccountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountSortOrder: accounts.sortOrder,
        legacyAccountCode: assets.account,
        name: assets.name,
        ticker: assets.ticker,
        assetType: assets.assetType,
        market: assets.market,
        currency: assets.currency,
        quantity: assets.quantity,
        averageCost: assets.averageCost,
        currentPrice: assets.currentPrice,
        priceSource: assets.priceSource,
        priceAsOf: assets.priceAsOf,
        priceStatus: assets.priceStatus,
        updatedAt: assets.updatedAt,
      })
      .from(assets)
      .innerJoin(accounts, eq(assets.accountId, accounts.id))
      .where(and(...predicates))
      .orderBy(
        asc(accounts.sortOrder),
        asc(accounts.code),
        asc(assets.name),
        asc(assets.ticker),
      );

    return projectTenantHoldingRows(rows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
