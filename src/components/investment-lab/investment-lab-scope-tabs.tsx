"use client";

import { useSearchParams } from "next/navigation";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

export function InvestmentLabScopeTabs({
  scopes,
  selectedScopeKey,
}: {
  scopes: readonly PortfolioAnalysisScope[];
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  const params = useSearchParams();
  const query = Object.fromEntries(
    ["view", "start", "end", "kodexWeight", "basketAnchor", "preview"].map(
      (key) => [key, params.get(key)],
    ),
  );
  return (
    <PortfolioAnalysisScopeTabs
      basePath="/investment-lab"
      query={query}
      scopes={scopes}
      selectedScopeKey={selectedScopeKey}
      variant="underline"
    />
  );
}
