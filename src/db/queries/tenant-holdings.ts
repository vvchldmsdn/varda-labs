import "server-only";

import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assets,
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
} from "@/db/schema";
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
      const membershipTargets = await getActivePortfolioGroupMembershipTargets({
        portfolioGroupId: scope.portfolioGroupId,
        serviceDate,
        tenantContext,
      });
      const membershipPredicate =
        membershipTargets.accountIds.length > 0 &&
        membershipTargets.assetIds.length > 0
          ? or(
              inArray(accounts.id, membershipTargets.accountIds),
              inArray(assets.id, membershipTargets.assetIds),
            )
          : membershipTargets.accountIds.length > 0
            ? inArray(accounts.id, membershipTargets.accountIds)
            : membershipTargets.assetIds.length > 0
              ? inArray(assets.id, membershipTargets.assetIds)
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
        currentPrice: assets.currentPrice,
        priceSource: assets.priceSource,
        priceAsOf: assets.priceAsOf,
        priceStatus: assets.priceStatus,
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

async function getActivePortfolioGroupMembershipTargets({
  portfolioGroupId,
  serviceDate,
  tenantContext,
}: {
  portfolioGroupId: string;
  serviceDate: string;
  tenantContext: TenantContext;
}) {
  const [accountRows, assetRows] = await Promise.all([
    db
      .selectDistinct({ accountId: portfolioGroupAccountMemberships.accountId })
      .from(portfolioGroupAccountMemberships)
      .where(
        and(
          eq(
            portfolioGroupAccountMemberships.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(
            portfolioGroupAccountMemberships.portfolioGroupId,
            portfolioGroupId,
          ),
          lte(portfolioGroupAccountMemberships.validFrom, serviceDate),
          or(
            isNull(portfolioGroupAccountMemberships.validTo),
            gt(portfolioGroupAccountMemberships.validTo, serviceDate),
          ),
        ),
      ),
    db
      .selectDistinct({ assetId: portfolioGroupAssetMemberships.assetId })
      .from(portfolioGroupAssetMemberships)
      .where(
        and(
          eq(
            portfolioGroupAssetMemberships.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(
            portfolioGroupAssetMemberships.portfolioGroupId,
            portfolioGroupId,
          ),
          lte(portfolioGroupAssetMemberships.validFrom, serviceDate),
          or(
            isNull(portfolioGroupAssetMemberships.validTo),
            gt(portfolioGroupAssetMemberships.validTo, serviceDate),
          ),
        ),
      ),
  ]);

  return Object.freeze({
    accountIds: Object.freeze(accountRows.map((row) => row.accountId)),
    assetIds: Object.freeze(assetRows.map((row) => row.assetId)),
  });
}
