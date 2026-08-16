import "server-only";

import { loadOwnedActiveSnapshotAccounts } from "@/db/queries/tenant-snapshot-accounts";
import {
  buildPortfolioAnalysisScopeCatalog,
  resolvePortfolioAnalysisScope,
  type PortfolioAnalysisScopeCatalog,
  type PortfolioAnalysisScopeCatalogError,
  type PortfolioAnalysisScopeResolution,
} from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantSnapshotScopeContextResult =
  | Readonly<{
      state: "ready";
      catalog: PortfolioAnalysisScopeCatalog;
      resolution: PortfolioAnalysisScopeResolution;
    }>
  | Readonly<{
      state: "integrity_error";
      reason: PortfolioAnalysisScopeCatalogError["reason"];
    }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantSnapshotScopeContext({
  account,
  scope,
  tenantContext,
}: {
  account?: string | readonly string[] | null;
  scope?: string | readonly string[] | null;
  tenantContext: TenantContext;
}): Promise<TenantSnapshotScopeContextResult> {
  try {
    const accountRows = await loadOwnedActiveSnapshotAccounts(tenantContext);
    const catalog = buildPortfolioAnalysisScopeCatalog({
      accounts: accountRows.map((row) => ({
        id: row.accountId,
        code: row.accountCode,
        name: row.accountName,
        isActive: true,
        sortOrder: row.accountSortOrder,
      })),
      portfolioGroups: [],
    });
    if (catalog.state === "integrity_error") {
      return Object.freeze({
        state: "integrity_error",
        reason: catalog.reason,
      });
    }

    return Object.freeze({
      state: "ready",
      catalog,
      resolution: resolvePortfolioAnalysisScope({ account, catalog, scope }),
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
