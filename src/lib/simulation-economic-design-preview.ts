import { buildSimulationDesignPreview, type SimulationPreviewQuery } from "./simulation-design-preview.ts";
import { buildSimulationOwnerEconomicResearch } from "./simulation-owner-economic-research.ts";

// Explicit development fixture only. It exercises the production math with synthetic inputs.
export function buildSimulationEconomicDesignPreview(query: SimulationPreviewQuery, preview = buildSimulationDesignPreview(query)) {
  const { execution, matrix, currentWeights, dates } = preview;
  const factorRows = dates.flatMap((date, index) => [
    { factorKey: "usdkrw", value: 1380 + Math.sin(index * 0.15) * 15 },
    { factorKey: "us_10y_yield", value: 4 + Math.cos(index * 0.12) * 0.25 },
    { factorKey: "us_10y2y_curve", value: 0.4 + Math.sin(index * 0.09) * 0.15 },
  ].map((row) => ({ ...row, factorDate: date, periodEndDate: date, releaseDate: date, volatility20dPct: 0.3 })));
  const economic = buildSimulationOwnerEconomicResearch({
    account: execution.account, matrix: query.previewState === "missing" ? null : matrix,
    weights: currentWeights, horizon: execution.status === "ready" ? execution.assumptions.horizon : null,
    ownerExecutionReady: execution.status === "ready", factorRows: query.previewState === "stale" ? factorRows.slice(0, 30) : factorRows,
    stateAsOfServiceDate: dates.at(-1),
  });
  return { ...preview, economic };
}
