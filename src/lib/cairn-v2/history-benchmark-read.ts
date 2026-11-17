import "server-only";
import { getReadOnlyTenantInvestmentLabAnalysisScopeEvidence } from "@/db/queries/investment-lab-scope-evidence";
import { getReadOnlyTenantInvestmentLabCounterfactualForScope } from "@/db/queries/investment-lab";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import type { TenantContext } from "../session-resolver-contract";
import type { PeriodAttributionRange } from "./period-attribution";
import { buildHistoryBenchmark } from "./history-benchmark";

export async function readHistoryBenchmark({ tenantContext, scope, range }: {
  tenantContext: TenantContext; scope: PortfolioAnalysisScope; range: PeriodAttributionRange;
}) {
  const evidencePromise = getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({ tenantContext, scope, includeEffectiveNativeTrades: true });
  const [evidence, source] = await Promise.all([evidencePromise,
    getReadOnlyTenantInvestmentLabCounterfactualForScope({ tenantContext, scope, evidencePromise,
      request: { startServiceDate: range.start, endServiceDate: range.end } })]);
  return buildHistoryBenchmark(source, evidence, range);
}
