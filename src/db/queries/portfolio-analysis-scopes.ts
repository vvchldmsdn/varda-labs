import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { loadActiveTenantPortfolioGroups } from "@/db/queries/tenant-group-reads";
import { accounts } from "@/db/schema";
import {
  buildPortfolioAnalysisScopeCatalog,
  resolvePortfolioAnalysisScope,
  type PortfolioAnalysisScopeCatalog,
  type PortfolioAnalysisScopeCatalogError,
  type PortfolioAnalysisScopeResolution,
} from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantPortfolioAnalysisScopeContext = Readonly<{
  state: "ready";
  catalog: PortfolioAnalysisScopeCatalog;
  resolution: PortfolioAnalysisScopeResolution;
}>;

export type TenantPortfolioAnalysisScopeContextResult =
  | TenantPortfolioAnalysisScopeContext
  | Readonly<{
      state: "integrity_error";
      reason: PortfolioAnalysisScopeCatalogError["reason"];
    }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPortfolioAnalysisScopeContext({
  account,
  scope,
  tenantContext,
}: {
  account?: string | readonly string[] | null;
  scope?: string | readonly string[] | null;
  tenantContext: TenantContext;
}): Promise<TenantPortfolioAnalysisScopeContextResult> {
  try {
    const [ownedAccounts, ownedPortfolioGroups] = await Promise.all([
      db
        .select({
          id: accounts.id,
          code: accounts.code,
          name: accounts.name,
          isActive: accounts.isActive,
          sortOrder: accounts.sortOrder,
        })
        .from(accounts)
        .where(
          and(
            eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(accounts.isActive, true),
          ),
        )
        .orderBy(asc(accounts.sortOrder), asc(accounts.name), asc(accounts.code)),
      loadActiveTenantPortfolioGroups(tenantContext),
    ]);

    const catalog = buildPortfolioAnalysisScopeCatalog({
      accounts: ownedAccounts,
      portfolioGroups: ownedPortfolioGroups.map((group) => ({
        ...group,
        isActive: true,
      })),
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
