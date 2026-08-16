import "server-only";

import { loadTenantPortfolioGroupMemberships } from "@/db/queries/tenant-group-reads";
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

  const memberships = await loadTenantPortfolioGroupMemberships({
    mode: "effective",
    portfolioGroupId: scope.portfolioGroupId,
    serviceDate,
    tenantContext,
  });

  return Object.freeze({
    includesAllOwnedAccounts: false,
    wholeAccountIds: Object.freeze(
      [...new Set(memberships.accountMemberships.map((row) => row.targetId))],
    ),
    directAssetIds: Object.freeze(
      [...new Set(memberships.assetMemberships.map((row) => row.targetId))],
    ),
  });
}
