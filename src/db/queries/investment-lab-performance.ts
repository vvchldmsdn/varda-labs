import "server-only";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { resolveInvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import { getReadOnlyTenantInvestmentLabAnalysisScopeEvidence } from "./investment-lab-scope-evidence";
import { getReadOnlyTenantInvestmentLabCounterfactualForScope } from "./investment-lab";

export async function loadInvestmentLabPerformance({ query, tenantContext, selectedScope }: { query: Record<string, string | string[] | undefined>; tenantContext: TenantContext; selectedScope: PortfolioAnalysisScope }) {
  const evidencePromise = getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({ scope: selectedScope, tenantContext });
  const result = await getReadOnlyTenantInvestmentLabCounterfactualForScope({ evidencePromise, scope: selectedScope, tenantContext, fixedMixSelection: resolveInvestmentLabFixedMixSelection(query.kodexWeight), request: query.start === undefined && query.end === undefined ? undefined : { startServiceDate: query.start, endServiceDate: query.end }, requestedAnchorDate: Array.isArray(query.basketAnchor) ? "__ambiguous__" : query.basketAnchor ?? null });
  const { model, period, fountScopeAdjustment, anchorBasketScenario, anchorValueWeightScenario, anchorCurrentWeightMonthlyScenario, anchorEqualWeightMonthlyScenario, approvedTargetWeightScenario } = result;
  return { preview: false as const, model, period, fountScopeAdjustment, anchorBasketScenario, anchorValueWeightScenario, anchorCurrentWeightMonthlyScenario, anchorEqualWeightMonthlyScenario, approvedTargetWeightScenario, selectedScope };
}
export type InvestmentLabPerformanceData = Awaited<ReturnType<typeof loadInvestmentLabPerformance>>;
