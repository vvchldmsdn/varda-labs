import { Suspense } from "react";
import { AppNavigation } from "@/components/app-navigation";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";

export function PortfolioPrimaryNavigation({ activePath, generatedAt, selectedScopeKey }: {
  activePath: "/" | "/today" | "/additional-contribution" | "/portfolio/structure" | "/history" | "/investment-lab" | "/simulation";
  generatedAt: string;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  return <Suspense fallback={<div className="varda-nav-placeholder" />}><AppNavigation activePath={activePath} generatedAt={generatedAt} selectedScopeKey={selectedScopeKey} /></Suspense>;
}
