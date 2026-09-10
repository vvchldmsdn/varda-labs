import "server-only";
import type { SimulationPanel } from "@/lib/simulation-panel";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope } from "./holding-analysis-data-readiness";
import { getReadOnlySimulationHistoricalOutcomeValidation } from "./simulation-historical-outcome-validation";
import { getReadOnlySimulationInputReadiness } from "./simulation-input-readiness";
import { getReadOnlyTenantSimulationOwnerParametricFactorResearch } from "./simulation-owner-parametric-factor";
import { getReadOnlyTenantSimulationOwnerModelCalibration } from "./simulation-owner-model-calibration";
import { getReadOnlyTenantSimulationOwnerModelComparison } from "./simulation-owner-model-comparison";
import { getReadOnlyTenantSimulationOwnerResearch } from "./simulation-owner-research";
import { getReadOnlySimulationRegimeBootstrap } from "./simulation-regime-bootstrap";
import { getReadOnlySimulationRegimeHistoricalOutcomeValidation } from "./simulation-regime-historical-outcome-validation";
import { getReadOnlySimulationResearchUniversePreflight } from "./simulation-research-universe-preflight";
import { resolveSimulationPathModel } from "@/lib/simulation-model-selection";
import { buildSimulationOwnerEconomicCandidates } from "@/lib/simulation-owner-economic-candidates";
import { getReadOnlyTenantSimulationOwnerEconomicResearch, getReadOnlyTenantSimulationOwnerEconomicValidation, economicResearchPresentation } from "./simulation-owner-economic";

export async function loadSimulationDetail({ panel, query, tenantContext, selectedScope, scopeCatalog }: {
  panel: SimulationPanel; query: Record<string, string | string[] | undefined>; tenantContext: TenantContext;
  selectedScope: PortfolioAnalysisScope; scopeCatalog: readonly PortfolioAnalysisScope[];
}) {
  const unavailableSections: string[] = [];
  async function optional<T>(label: string, read: Promise<T>): Promise<T | null> {
    try { return await read; } catch { unavailableSections.push(label); return null; }
  }
  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  // Detail computations require the same owner matrix and paired baseline. They do
  // not rerender or serialize the main page, and no private result is globally cached.
  const ownerPromise = getReadOnlyTenantSimulationOwnerResearch({ endServiceDate: query.end, horizon: query.horizon, scope: selectedScope, serviceDate, tenantContext });
  const pathModel = resolveSimulationPathModel(query.model);
  if (!pathModel) throw new Error("invalid_simulation_model");
  if (pathModel === "economic") {
    const [owner, economic, economicValidation] = await Promise.all([
      ownerPromise,
      panel !== "validation" ? getReadOnlyTenantSimulationOwnerEconomicResearch({ ownerResearchPromise: ownerPromise, stateAsOfServiceDate: typeof query.end === "string" ? query.end : serviceDate }) : null,
      panel === "validation" ? getReadOnlyTenantSimulationOwnerEconomicValidation({ ownerResearchPromise: ownerPromise }) : null,
    ]);
    return {
      panel, pathModel, selectedScope, scopeCatalog,
      preservedQuery: { scope: selectedScope.key, model: pathModel, end: single(query.end), horizon: single(query.horizon), kodexWeight: single(query.kodexWeight), researchUniverse: single(query.researchUniverse) },
      economic: economic ? economicResearchPresentation(economic) : null,
      economicCandidates: panel === "weights" && economic ? buildSimulationOwnerEconomicCandidates({ economic }) : null,
      economicValidation,
      model: null, analysisDataReadiness: null, ownerParametricFactor: null, ownerModelComparison: null, ownerModelCalibration: null,
      historicalOutcomeValidation: null, regimeHistoricalOutcomeValidation: null, researchUniversePreflight: null, regime: null,
      inputPreflight: panel === "evidence" ? owner.inputPreflight : null,
      instruments: owner.execution.instruments, candidateComparison: null, walkForwardValidation: null, historicalValidation: null,
      unavailableSections,
    };
  }
  const modelPromise = panel !== "weights" ? optional("고정 종목 연구", getReadOnlySimulationInputReadiness({ includeResearch: true, endServiceDate: query.end, horizon: query.horizon, kodexWeight: query.kodexWeight })) : null;
  const factorPromise = panel === "evidence" ? getReadOnlyTenantSimulationOwnerParametricFactorResearch({ ownerResearchPromise: ownerPromise }) : null;
  const factorResult = factorPromise ? optional("환율·금리 요인 모형", factorPromise) : null;
  const [owner, reads] = await Promise.all([ownerPromise, Promise.all([
    modelPromise,
    panel === "evidence" ? optional("과거 가격 준비", getReadOnlyTenantHoldingAnalysisDataReadinessForScope({ scope: selectedScope, serviceDate, tenantContext })) : null,
    factorResult,
    panel === "evidence" ? optional("두 확률모형 비교", getReadOnlyTenantSimulationOwnerModelComparison({ ownerResearchPromise: ownerPromise, parametricFactorPromise: factorPromise! })) : null,
    panel === "evidence" ? optional("과거 결과 모형 점검", getReadOnlyTenantSimulationOwnerModelCalibration({ ownerResearchPromise: ownerPromise })) : null,
    panel === "validation" ? optional("고정 종목 과거 검증", getReadOnlySimulationHistoricalOutcomeValidation({ endServiceDate: query.end, horizon: query.horizon })) : null,
    panel === "validation" ? optional("시장 국면 과거 검증", getReadOnlySimulationRegimeHistoricalOutcomeValidation({ endServiceDate: query.end })) : null,
    panel === "evidence" ? optional("연구 종목 데이터", getReadOnlySimulationResearchUniversePreflight({ endServiceDate: query.end, researchUniverse: query.researchUniverse })) : null,
    panel === "evidence" ? optional("시장 국면 연구", getReadOnlySimulationRegimeBootstrap({ endServiceDate: query.end, kodexWeight: query.kodexWeight })) : null,
  ] as const)]);
  return {
    panel, pathModel, selectedScope, scopeCatalog,
    economic: null, economicCandidates: null, economicValidation: null,
    preservedQuery: { scope: selectedScope.key, model: pathModel, end: single(query.end), horizon: single(query.horizon), kodexWeight: single(query.kodexWeight), researchUniverse: single(query.researchUniverse) },
    model: reads[0], analysisDataReadiness: reads[1], ownerParametricFactor: reads[2], ownerModelComparison: reads[3], ownerModelCalibration: reads[4], historicalOutcomeValidation: reads[5], regimeHistoricalOutcomeValidation: reads[6], researchUniversePreflight: reads[7], regime: reads[8],
    inputPreflight: panel === "evidence" ? owner.inputPreflight : null,
    instruments: panel === "weights" ? owner.execution.instruments : [],
    candidateComparison: panel === "weights" ? owner.candidateComparison : null,
    walkForwardValidation: panel === "validation" ? owner.walkForwardValidation : null,
    historicalValidation: panel === "validation" ? owner.historicalValidation : null,
    unavailableSections,
  };
}

function single(value: string | string[] | undefined) { return typeof value === "string" ? value : null; }
type DetailResult = Awaited<ReturnType<typeof loadSimulationDetail>>;
export type SimulationDetailData = { [Key in keyof DetailResult]: DetailResult[Key] };
