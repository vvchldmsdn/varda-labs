import "server-only";
import { resolveCurrentTenantContext } from "./current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { RESEARCH_DETAIL_HEADERS } from "@/lib/research-detail-query";

export async function resolveResearchDetailContext(query: Record<string, string | string[] | undefined>) {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) return { ok: false as const, response: Response.json({ error: "authentication_required" }, { status: 401, headers: RESEARCH_DETAIL_HEADERS }) };
  const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({ account: query.account, scope: query.scope, tenantContext: resolution.tenantContext });
  if (context.state !== "ready" || context.resolution.state !== "resolved") return { ok: false as const, response: Response.json({ error: "scope_unavailable" }, { status: 403, headers: RESEARCH_DETAIL_HEADERS }) };
  return { ok: true as const, tenantContext: resolution.tenantContext, selectedScope: context.resolution.scope, scopeCatalog: context.catalog.scopes };
}
