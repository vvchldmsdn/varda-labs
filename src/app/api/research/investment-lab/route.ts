import { resolveInvestmentLabPanel } from "@/lib/investment-lab-panel";
import { researchDetailQuery, RESEARCH_DETAIL_HEADERS } from "@/lib/research-detail-query";
import { resolveResearchDetailContext } from "@/lib/auth/research-detail-context";
import { loadInvestmentLabDetail, type InvestmentLabDetailData } from "@/db/queries/investment-lab-detail";

export async function GET(request: Request) {
  const query = researchDetailQuery(new URL(request.url).searchParams);
  const panel = resolveInvestmentLabPanel(query.view);
  const performance = query.detail === "performance";
  if (!panel && !performance) return Response.json({ error: "invalid_panel" }, { status: 400, headers: RESEARCH_DETAIL_HEADERS });
  if (process.env.NODE_ENV === "development" && query.preview === "design") {
    const { buildInvestmentLabDesignPreview } = await import("@/lib/investment-lab-design-preview");
    const p = buildInvestmentLabDesignPreview(query);
    if (performance) return Response.json({ preview: true }, { headers: RESEARCH_DETAIL_HEADERS });
    const data: InvestmentLabDetailData = { panel: panel!, xray: panel === "composition" ? p.etfXray : null, stress: null, adjustment: null, unavailableSections: [] };
    return Response.json(data, { headers: RESEARCH_DETAIL_HEADERS });
  }
  const context = await resolveResearchDetailContext(query);
  if (!context.ok) return context.response;
  try {
    if (performance) {
      const { loadInvestmentLabPerformance } = await import("@/db/queries/investment-lab-performance");
      return Response.json(await loadInvestmentLabPerformance({ query, ...context }), { headers: RESEARCH_DETAIL_HEADERS });
    }
    return Response.json(await loadInvestmentLabDetail({ panel: panel!, ...context }), { headers: RESEARCH_DETAIL_HEADERS });
  } catch { return Response.json({ error: "detail_unavailable" }, { status: 503, headers: RESEARCH_DETAIL_HEADERS }); }
}
