import "server-only";

import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
} from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type PortfolioAnalysisScopeTargets = Readonly<{
  includesAllOwnedAccounts: boolean;
  wholeAccountIds: readonly string[];
  directAssetIds: readonly string[];
}>;

export async function getPortfolioAnalysisScopeTargets({
  scope,
  serviceDate,
  tenantContext,
}: {
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  tenantContext: TenantContext;
}): Promise<PortfolioAnalysisScopeTargets> {
  if (scope.kind === "all") {
    return Object.freeze({
      includesAllOwnedAccounts: true,
      wholeAccountIds: Object.freeze([]),
      directAssetIds: Object.freeze([]),
    });
  }

  if (scope.kind === "account") {
    return Object.freeze({
      includesAllOwnedAccounts: false,
      wholeAccountIds: Object.freeze([scope.accountId]),
      directAssetIds: Object.freeze([]),
    });
  }

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
            scope.portfolioGroupId,
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
            scope.portfolioGroupId,
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
    includesAllOwnedAccounts: false,
    wholeAccountIds: Object.freeze(accountRows.map((row) => row.accountId)),
    directAssetIds: Object.freeze(assetRows.map((row) => row.assetId)),
  });
}
