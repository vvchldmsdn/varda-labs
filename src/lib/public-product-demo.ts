import { buildInvestmentLabDesignPreview } from "./investment-lab-design-preview.ts";
import { buildSimulationChartExample } from "./simulation-design-preview.ts";
import type { InvestmentLabScenarioChart } from "./investment-lab-scenario-chart.ts";
import type { ResearchFanChartData } from "../components/simulation/simulation-presentation.ts";

export type PublicProductDemo =
  | { kind: "lab"; sample: true; chart: InvestmentLabScenarioChart }
  | { kind: "simulation"; sample: true; execution: ResearchFanChartData };

// Only three fixed, synthetic datasets can occupy this cache. No request input,
// account context or saved plan is ever passed to the fixture builders.
const cache = new Map<string, PublicProductDemo>();
export function buildPublicProductDemo(kind: "lab" | "simulation", horizon: 63 | 126 = 63): PublicProductDemo {
  const key = kind === "lab" ? kind : `${kind}:${horizon}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let result: PublicProductDemo;
  if (kind === "lab") {
    const { chart } = buildInvestmentLabDesignPreview({});
    result = { kind, sample: true, chart: { ...chart, lines: chart.lines.filter(line => ["actual", "kodex200", "voo", "fixed_mix"].includes(line.id)), unavailableScenarioIds: [] } };
  } else {
    const execution = buildSimulationChartExample(horizon);
    if (execution.status !== "ready") throw new Error("sample_unavailable");
    result = { kind, sample: true, execution: {
      id: `public-sample-${horizon}`, name: "샘플 포트폴리오",
      assumptions: { horizon: execution.assumptions.horizon },
      bands: execution.bands, samplePaths: execution.samplePaths,
      displayPaths: execution.displayPaths,
    } };
  }
  cache.set(key, result);
  return result;
}

export function resolvePublicDemoQuery(search: URLSearchParams) {
  if ([...search.keys()].some(key => !["view", "horizon"].includes(key)) || search.getAll("view").length !== 1 || search.getAll("horizon").length > 1) return null;
  const view = search.get("view");
  const horizon = search.get("horizon") ?? "63";
  if ((view !== "lab" && view !== "simulation") || (horizon !== "63" && horizon !== "126")) return null;
  return { view, horizon: Number(horizon) as 63 | 126 } as const;
}
