import {
  buildSimulationDesignPreview,
  type SimulationPreviewQuery,
} from "@/lib/simulation-design-preview";
import { SimulationInputReadinessView } from "./simulation-input-readiness-view";
import { OwnerResearchExecutionSection } from "./owner-research-execution-section";
import { OwnerCandidateComparisonSection } from "./owner-candidate-comparison-section";
import { OwnerWalkForwardValidationSection } from "./owner-walk-forward-validation-section";
import { OwnerInputPreflightSection } from "./owner-input-preflight-section";

export function SimulationDesignPreview({
  query,
}: {
  query: SimulationPreviewQuery;
}) {
  const preview = buildSimulationDesignPreview(query);
  const { portfolio, execution, comparison, validation, preflight, model } =
    preview;
  return (
    <>
      <div className="border-b border-[#d7e1d5] bg-[#edf3ea] px-5 py-2 text-center text-xs text-[#57734f]">
        디자인 미리보기 · 예시 데이터 · 실제 계좌 및 시세와 무관
      </div>
      <SimulationInputReadinessView
        model={model}
        scopeCatalog={portfolio.analysisScopes}
        selectedScopeKey={portfolio.selectedScope.key}
        researchUniverse={null}
        ownerResearchExecution={
          <OwnerResearchExecutionSection execution={execution} />
        }
        ownerCandidateComparison={
          <OwnerCandidateComparisonSection
            comparison={comparison}
            instruments={execution.instruments}
          />
        }
        ownerWalkForwardValidation={
          <OwnerWalkForwardValidationSection result={validation} />
        }
        ownerInputPreflight={
          <OwnerInputPreflightSection
            model={preflight}
            scopes={portfolio.analysisScopes}
            selectedScope={portfolio.selectedScope}
            preservedQuery={{ preview: "design" }}
          />
        }
      />
    </>
  );
}
