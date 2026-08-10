import "server-only";

import { loadSimulationFactorRows } from "@/db/queries/simulation-regime-evidence";
import type { ReadOnlyTenantSimulationOwnerResearchResult } from "@/db/queries/simulation-owner-research";
import { buildSimulationOwnerParametricFactorResearch } from "@/lib/simulation-owner-parametric-factor";

export async function getReadOnlyTenantSimulationOwnerParametricFactorResearch(
  options: {
    ownerResearchPromise: Promise<ReadOnlyTenantSimulationOwnerResearchResult>;
  },
) {
  const ownerResearch = await options.ownerResearchPromise;
  const input = ownerResearch.parametricFactorInput;
  if (!input) {
    return buildSimulationOwnerParametricFactorResearch({
      account: ownerResearch.execution.account,
      matrix: null,
      weights: [],
      horizon: null,
      factorRows: [],
      ownerExecutionReady: false,
    });
  }

  const factorRows = await loadSimulationFactorRows(
    input.matrix.requestedServiceDates.at(-1) ?? "",
  );
  return buildSimulationOwnerParametricFactorResearch({
    ...input,
    factorRows,
    ownerExecutionReady: true,
  });
}
