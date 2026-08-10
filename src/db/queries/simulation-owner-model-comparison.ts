import "server-only";

import type { ReadOnlyTenantSimulationOwnerResearchResult } from "@/db/queries/simulation-owner-research";
import type { SimulationOwnerParametricFactorResult } from "@/lib/simulation-owner-parametric-factor";
import { buildSimulationOwnerModelComparison } from "@/lib/simulation-owner-model-comparison";

export async function getReadOnlyTenantSimulationOwnerModelComparison(options: {
  ownerResearchPromise: Promise<ReadOnlyTenantSimulationOwnerResearchResult>;
  parametricFactorPromise: Promise<SimulationOwnerParametricFactorResult>;
}) {
  const [ownerResearch, factor] = await Promise.all([
    options.ownerResearchPromise,
    options.parametricFactorPromise,
  ]);
  return buildSimulationOwnerModelComparison({
    bootstrap: ownerResearch.execution,
    factor,
  });
}
