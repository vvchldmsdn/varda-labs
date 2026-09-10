import {
  buildSimulationDesignPreview,
  type SimulationPreviewQuery,
} from "@/lib/simulation-design-preview";
import { SimulationInputReadinessView } from "./simulation-input-readiness-view";
import { OwnerResearchExecutionSection } from "./owner-research-execution-section";
import { resolveSimulationPathModel } from "@/lib/simulation-model-selection";
import { buildSimulationEconomicDesignPreview } from "@/lib/simulation-economic-design-preview";
import { EconomicExecutionSection } from "./economic-execution-section";
import { economicResearchPresentation } from "@/db/queries/simulation-owner-economic";

export function SimulationDesignPreview({
  query,
}: {
  query: SimulationPreviewQuery;
}) {
  const preview = buildSimulationDesignPreview(query);
  const pathModel = resolveSimulationPathModel(query.model);
  const economic = pathModel === "economic" ? buildSimulationEconomicDesignPreview(query, preview).economic : null;
  const { portfolio, execution, model } =
    preview;
  return (
    <div className="relative min-h-screen">
      <SimulationInputReadinessView
        model={model}
        pathModel={pathModel}
        scopeCatalog={portfolio.analysisScopes}
        selectedScopeKey={portfolio.selectedScope.key}
        researchUniverse={null}
        ownerResearchExecution={
          economic ? <EconomicExecutionSection result={economicResearchPresentation(economic)} baseline={execution} /> : pathModel === "bootstrap" ? <OwnerResearchExecutionSection execution={execution} selectedScopeKey={portfolio.selectedScope.key} /> : <p role="alert">Invalid simulation model</p>
        }

      />
    </div>
  );
}
