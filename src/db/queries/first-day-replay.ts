import "server-only";
import { getLatestCommonPrivateOwnerRawServiceDate, getReadOnlyPrivateOwnerRawHistoryBundle } from "./simulation-owner-private-history";
import { buildSimulationOwnerInputCandidate } from "@/lib/shared-domain/simulation-owner-input-candidate";
import { buildFirstDayReplay, type FirstDayReplay } from "@/lib/first-day-replay";
import type { PortfolioStructureResult } from "@/lib/portfolio-structure";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function readFirstDayReplay(portfolio: PortfolioStructureResult, scope: PortfolioAnalysisScope, tenantContext: TenantContext): Promise<FirstDayReplay> {
  const candidate = buildSimulationOwnerInputCandidate({ portfolio, scopeKey: scope.key });
  if (candidate.status !== "ready_for_historical_preflight" || !candidate.selection) return { state: "unavailable", reason: "valuation" };
  try {
    const endServiceDate = await getLatestCommonPrivateOwnerRawServiceDate({ tenantContext, selection: candidate.selection });
    if (!endServiceDate) return { state: "unavailable", reason: "history" };
    const history = await getReadOnlyPrivateOwnerRawHistoryBundle({ tenantContext, selection: candidate.selection, endServiceDate, returnStepCount: 30 });
    // Matrix availability alone does not establish provenance admission.
    if (history.status !== "ready") return { state: "unavailable", reason: "history" };
    const result = buildFirstDayReplay(history.matrix, candidate.instruments, candidate.summary.fountExcludedHoldingCount > 0 ? ["분석 대상이 아닌 위탁 운용 자산"] : []);
    if (result.state === "ready" && candidate.summary.fountExcludedHoldingCount > 0) {
      const total = candidate.summary.currentValueKrw + candidate.summary.fountExcludedCurrentValueKrw;
      return { ...result, coveragePct: total > 0 ? result.coveragePct * candidate.summary.currentValueKrw / total : 0 };
    }
    return result;
  } catch { return { state: "unavailable", reason: "read" }; }
}
