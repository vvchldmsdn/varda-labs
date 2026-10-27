import { resolveSimulationPanel } from "@/lib/simulation-panel";
import { researchDetailQuery, RESEARCH_DETAIL_HEADERS } from "@/lib/research-detail-query";
import { resolveResearchDetailContext } from "@/lib/auth/research-detail-context";
import { loadSimulationDetail, type SimulationDetailData } from "@/db/queries/simulation-detail";
import { resolveSimulationPathModel } from "@/lib/simulation-model-selection";
import { economicResearchPresentation } from "@/db/queries/simulation-owner-economic";
import { buildSimulationOwnerEconomicCandidates } from "@/lib/simulation-owner-economic-candidates";
import { buildSimulationOwnerEconomicValidation } from "@/lib/simulation-owner-economic-validation";

export async function GET(request: Request) {
  const query = researchDetailQuery(new URL(request.url).searchParams);
  const panel = resolveSimulationPanel(query.view);
  if (!panel) return Response.json({ error: "invalid_panel" }, { status: 400, headers: RESEARCH_DETAIL_HEADERS });
  const pathModel = resolveSimulationPathModel(query.model);
  if (!pathModel) return Response.json({ error: "invalid_model" }, { status: 400, headers: RESEARCH_DETAIL_HEADERS });
  if (process.env.NODE_ENV === "development" && query.preview === "design") {
    const { buildSimulationDesignPreview } = await import("@/lib/simulation-design-preview");
    const p = buildSimulationDesignPreview(query);
    const economic = pathModel === "economic" ? (await import("@/lib/simulation-economic-design-preview")).buildSimulationEconomicDesignPreview(query, p).economic : null;
    const data: SimulationDetailData = {
      panel, pathModel, model: pathModel === "bootstrap" ? p.model : null, selectedScope: p.portfolio.selectedScope, scopeCatalog: p.portfolio.analysisScopes,
      economic: economic ? economicResearchPresentation(economic) : null,
      economicCandidates: panel === "weights" && economic ? buildSimulationOwnerEconomicCandidates({ economic }) : null,
      economicValidation: panel === "validation" && economic ? buildSimulationOwnerEconomicValidation({ execution: p.execution, availableServiceDates: [], endpoints: [], factorRows: [] }) : null,
      preservedQuery: { scope: p.portfolio.selectedScope.key, model: pathModel, end: null, horizon: typeof query.horizon === "string" ? query.horizon : null, kodexWeight: null, researchUniverse: null },
      inputPreflight: panel === "evidence" ? p.preflight : null, instruments: p.execution.instruments,
      candidateComparison: pathModel === "bootstrap" && panel === "weights" ? p.comparison : null, walkForwardValidation: pathModel === "bootstrap" && panel === "validation" ? p.validation : null,
      historicalValidation: null, analysisDataReadiness: null, ownerParametricFactor: null, ownerModelComparison: null, ownerModelCalibration: null,
      historicalOutcomeValidation: null, regimeHistoricalOutcomeValidation: null, researchUniversePreflight: null, regime: null, unavailableSections: [],
    };
    return Response.json(data, { headers: RESEARCH_DETAIL_HEADERS });
  }
  const context = await resolveResearchDetailContext(query);
  if (!context.ok) return context.response;
  try { return Response.json(await loadSimulationDetail({ panel, query, ...context }), { headers: RESEARCH_DETAIL_HEADERS }); }
  catch { return Response.json({ error: "detail_unavailable" }, { status: 503, headers: RESEARCH_DETAIL_HEADERS }); }
}
