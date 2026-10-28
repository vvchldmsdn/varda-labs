import "server-only";

import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope, type ScopedHoldingAnalysisDataReadinessQueryResult } from "@/db/queries/holding-analysis-data-readiness";
import { buildFirstPortfolioAnalysis } from "@/lib/first-portfolio-analysis";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { readFirstDayReplay } from "./first-day-replay";

export async function getReadOnlyTenantFirstPortfolioAnalysis(options: {
  scope: PortfolioAnalysisScope; serviceDate: string; tenantContext: TenantContext;
}) {
  // Independent existing server reads. Rendering never starts provider jobs.
  const portfolioRead = getReadOnlyTenantPortfolioStructureForScope(options);
  const [portfolio, readiness, replay] = await Promise.allSettled([
    portfolioRead,
    getReadOnlyTenantHoldingAnalysisDataReadinessForScope(options),
    portfolioRead.then(value => readFirstDayReplay(value, options.scope, options.tenantContext)),
  ]);
  return Object.freeze({
    summary: portfolio.status === "fulfilled" ? buildFirstPortfolioAnalysis(portfolio.value) : null,
    replay: replay.status === "fulfilled" ? replay.value : { state: "unavailable" as const, reason: "read" as const },
    readiness: readiness.status === "fulfilled" ? readiness.value : Object.freeze({ state: "unavailable" as const }) as ScopedHoldingAnalysisDataReadinessQueryResult,
  });
}

export type FirstPortfolioAnalysisQueryResult = Awaited<ReturnType<typeof getReadOnlyTenantFirstPortfolioAnalysis>>;
