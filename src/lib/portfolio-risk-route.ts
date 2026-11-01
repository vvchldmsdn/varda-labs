import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
} from "./portfolio-analysis-scope.ts";
import type { PortfolioRiskWindow } from "./portfolio-risk-read-model-types.ts";

export function buildPortfolioRiskHref(
  scope: PortfolioAnalysisScopeKey,
  window: PortfolioRiskWindow,
  contextCurrency?: "KRW" | "USD",
) {
  return buildPortfolioAnalysisScopeHref("/portfolio/risk", scope, {
    ...(contextCurrency ? { currency: contextCurrency } : {}),
    window: window === 90 ? null : String(window),
  });
}
