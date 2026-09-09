import "server-only";

import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope, type ScopedHoldingAnalysisDataReadinessQueryResult } from "@/db/queries/holding-analysis-data-readiness";
import { buildFirstPortfolioAnalysis } from "@/lib/first-portfolio-analysis";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantFirstPortfolioAnalysis(options: {
  scope: PortfolioAnalysisScope; serviceDate: string; tenantContext: TenantContext;
}) {
  // Independent existing server reads. Rendering never starts provider jobs.
  const [portfolio, readiness] = await Promise.allSettled([
    getReadOnlyTenantPortfolioStructureForScope(options),
    getReadOnlyTenantHoldingAnalysisDataReadinessForScope(options),
  ]);
  return Object.freeze({
    summary: portfolio.status === "fulfilled" ? buildFirstPortfolioAnalysis(portfolio.value) : null,
    readiness: readiness.status === "fulfilled" ? readiness.value : Object.freeze({ state: "unavailable" as const }) as ScopedHoldingAnalysisDataReadinessQueryResult,
  });
}

export type FirstPortfolioAnalysisQueryResult = Awaited<ReturnType<typeof getReadOnlyTenantFirstPortfolioAnalysis>>;
