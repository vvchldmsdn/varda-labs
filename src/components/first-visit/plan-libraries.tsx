"use client";
import { useState } from "react";
import { PlanLibrary } from "./plan-library";
import { QuickPortfolioLibrary } from "./quick-portfolio-library";
export function PlanLibraries({ localAuthDisabled, showTour = true }: { localAuthDisabled: boolean; showTour?: boolean }) {
  const [hasQuickPortfolio, setHasQuickPortfolio] = useState(false);
  return <><QuickPortfolioLibrary localAuthDisabled={localAuthDisabled} onVisibility={setHasQuickPortfolio} /><PlanLibrary localAuthDisabled={localAuthDisabled} hideEmpty={hasQuickPortfolio} showTour={showTour} /></>;
}
