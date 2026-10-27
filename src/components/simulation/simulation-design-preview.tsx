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
import { registerSimulationPath } from "@/lib/server/simulation-path-details";
import { bootstrapPathSnapshot, economicPathSnapshot } from "@/lib/simulation-path-snapshot";

export function SimulationDesignPreview({
  query,
}: {
  query: SimulationPreviewQuery;
}) {
  const pathModel = resolveSimulationPathModel(query.model);
  const preview = buildSimulationDesignPreview(query, pathModel === "bootstrap");
  const economic = pathModel === "economic" ? buildSimulationEconomicDesignPreview(query, preview, true).economic : null;
  const { portfolio, execution, model } =
    preview;
  const pathDetail = registerSimulationPath("development-preview", economic ? economicPathSnapshot(economic, execution) : bootstrapPathSnapshot(execution, preview.prepared), true);
  return (
    <div className="relative min-h-screen">
      <SimulationInputReadinessView
        model={model}
        pathModel={pathModel}
        scopeCatalog={portfolio.analysisScopes}
        selectedScopeKey={portfolio.selectedScope.key}
        researchUniverse={null}
        ownerResearchExecution={
          economic ? <EconomicExecutionSection pathDetail={pathDetail} result={economicResearchPresentation(economic)} baseline={execution} /> : pathModel === "bootstrap" ? <OwnerResearchExecutionSection pathDetail={pathDetail} execution={execution} selectedScopeKey={portfolio.selectedScope.key} /> : <p role="alert">Invalid simulation model</p>
        }

      />
    </div>
  );
}
