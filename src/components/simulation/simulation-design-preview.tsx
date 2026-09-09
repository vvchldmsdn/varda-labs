import {
  buildSimulationDesignPreview,
  type SimulationPreviewQuery,
} from "@/lib/simulation-design-preview";
import { SimulationInputReadinessView } from "./simulation-input-readiness-view";
import { OwnerResearchExecutionSection } from "./owner-research-execution-section";

export function SimulationDesignPreview({
  query,
}: {
  query: SimulationPreviewQuery;
}) {
  const preview = buildSimulationDesignPreview(query);
  const { portfolio, execution, model } =
    preview;
  return (
    <div className="relative min-h-screen">
      <SimulationInputReadinessView
        model={model}
        scopeCatalog={portfolio.analysisScopes}
        selectedScopeKey={portfolio.selectedScope.key}
        researchUniverse={null}
        ownerResearchExecution={
          <OwnerResearchExecutionSection execution={execution} selectedScopeKey={portfolio.selectedScope.key} />
        }

      />
    </div>
  );
}
