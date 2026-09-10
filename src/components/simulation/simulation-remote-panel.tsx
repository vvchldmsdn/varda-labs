"use client";

import { SimulationText } from "@/components/simulation/simulation-text";


import type { ReactNode } from "react";
import { SimulationSectionErrorBoundary } from "./simulation-section-error-boundary";
import type { SimulationDetailData } from "@/db/queries/simulation-detail";
import { useResearchDetail, ResearchDetailStatus } from "@/components/investment-lab/research-detail-resource";
import { HoldingAnalysisDataPanelView } from "@/components/holding-analysis-data-panel";
import { SimulationDetailView } from "./simulation-detail-view";
import { OwnerCandidateComparisonSection } from "./owner-candidate-comparison-section";
import { OwnerWalkForwardValidationSection } from "./owner-walk-forward-validation-section";
import { OwnerHistoricalOutcomeValidationSection } from "./owner-historical-outcome-validation-section";
import { OwnerInputPreflightSection } from "./owner-input-preflight-section";
import { OwnerParametricFactorSection } from "./owner-parametric-factor-section";
import { OwnerModelComparisonSection } from "./owner-model-comparison-section";
import { OwnerModelCalibrationSection } from "./owner-model-calibration-section";
import { FanBandValidationSection } from "./fan-band-validation-section";
import { DownsideOutcomeValidationSection } from "./downside-outcome-validation-section";
import { RegimeHistoricalOutcomeValidationSection } from "./regime-historical-outcome-validation-section";
import { RegimeReadinessHistoryPanel } from "./regime-readiness-history-panel";
import { RegimeBootstrapResearchSection } from "./regime-bootstrap-research-section";
import { ResearchUniversePreflightSection } from "./research-universe-preflight-section";
import { EconomicDetailPanel } from "./economic-detail-panel";

export default function SimulationRemotePanel({ query }: { query: string }) {
  const { data, error, retry } = useResearchDetail<SimulationDetailData>("/api/research/simulation", query);
  if (!data) return <ResearchDetailStatus error={error} retry={retry} />;
  if (data.pathModel === "economic") return protect("economic-detail", <EconomicDetailPanel data={data} />);
  if (data.panel === "weights" && data.candidateComparison) return <div id="simulation-weight-experiment">{protect("OwnerCandidateComparisonSection", <OwnerCandidateComparisonSection comparison={data.candidateComparison} instruments={data.instruments} />)}</div>;
  return <>
    {data.unavailableSections.length ? <p role="status" className="py-3 text-sm text-[var(--warning)]"><SimulationText ko={"읽지 못한 근거:"} />{" "}{data.unavailableSections.join(", ")}<SimulationText ko={". 준비된 결과는 아래에 표시합니다."} /></p> : null}
    {protect("simulation-detail", <SimulationDetailView panel={data.panel} model={data.model} scopeCatalog={data.scopeCatalog} selectedScopeKey={data.selectedScope.key} researchUniverse={data.preservedQuery.researchUniverse}
      ownerWalkForwardValidation={data.walkForwardValidation && protect("OwnerWalkForwardValidationSection", <OwnerWalkForwardValidationSection result={data.walkForwardValidation} />)}
      ownerHistoricalValidation={data.historicalValidation && protect("OwnerHistoricalOutcomeValidationSection", <OwnerHistoricalOutcomeValidationSection result={data.historicalValidation} />)}
      ownerInputPreflight={<>{data.inputPreflight && protect("OwnerInputPreflightSection", <OwnerInputPreflightSection model={data.inputPreflight} scopes={data.scopeCatalog} selectedScope={data.selectedScope} preservedQuery={data.preservedQuery} />)}{data.analysisDataReadiness && protect("HoldingAnalysisDataPanelView", <HoldingAnalysisDataPanelView result={data.analysisDataReadiness} />)}</>}
      ownerParametricFactor={data.ownerParametricFactor && protect("OwnerParametricFactorSection", <OwnerParametricFactorSection result={data.ownerParametricFactor} />)}
      ownerModelComparison={data.ownerModelComparison && protect("OwnerModelComparisonSection", <OwnerModelComparisonSection result={data.ownerModelComparison} />)}
      ownerModelCalibration={data.ownerModelCalibration && protect("OwnerModelCalibrationSection", <OwnerModelCalibrationSection result={data.ownerModelCalibration} />)}
      historicalOutcomeValidation={data.historicalOutcomeValidation && <>{protect("FanBandValidationSection", <FanBandValidationSection result={data.historicalOutcomeValidation} />)}{protect("DownsideOutcomeValidationSection", <DownsideOutcomeValidationSection result={data.historicalOutcomeValidation} />)}</>}
      regimeHistoricalOutcomeValidation={data.regimeHistoricalOutcomeValidation && protect("RegimeHistoricalOutcomeValidationSection", <RegimeHistoricalOutcomeValidationSection result={data.regimeHistoricalOutcomeValidation} />)}
      regimeBootstrap={data.regime && <>{protect("RegimeReadinessHistoryPanel", <RegimeReadinessHistoryPanel model={data.regime.readinessHistory} />)}{protect("RegimeBootstrapResearchSection", <RegimeBootstrapResearchSection model={data.regime.research} />)}</>}
      researchUniversePreflight={data.researchUniversePreflight && protect("ResearchUniversePreflightSection", <ResearchUniversePreflightSection model={data.researchUniversePreflight} preservedQuery={data.preservedQuery} />)}
    />)}
  </>;
}

function protect(section: string, children: ReactNode) {
  return <SimulationSectionErrorBoundary section={section} title="분석 결과를 표시할 수 없습니다">{children}</SimulationSectionErrorBoundary>;
}
