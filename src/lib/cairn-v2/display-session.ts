import "server-only";
import { createHash } from "node:crypto";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import type { PortfolioAnalysisScopeCatalog } from "@/lib/portfolio-analysis-scope";

// A comparison marker, never an authorization credential. Every read/write
// still resolves the current session and tenant on the server.
export async function displaySessionBinding(tenant: TenantContext) {
  const scopes = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: tenant, scope: "all" });
  if (scopes.state !== "ready") return undefined;
  return displayBindingForScopes(tenant, scopes.catalog);
}

export function displayBindingForScopes(tenant: TenantContext, scopes: PortfolioAnalysisScopeCatalog) {
  const catalog = scopes.scopes.map(scope => JSON.stringify(scope)).sort();
  return createHash("sha256").update(JSON.stringify(["cairn-display-v1", tenant.ownerUserId, tenant.role, catalog])).digest("hex");
}
