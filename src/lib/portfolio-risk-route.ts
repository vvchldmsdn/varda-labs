import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
} from "./portfolio-analysis-scope.ts";
import type { PortfolioRiskWindow } from "./portfolio-risk-read-model-types.ts";

export function buildPortfolioRiskHref(
  scope: PortfolioAnalysisScopeKey,
  window: PortfolioRiskWindow,
) {
  return buildPortfolioAnalysisScopeHref("/portfolio/risk", scope, {
    window: window === 90 ? null : String(window),
  });
}
