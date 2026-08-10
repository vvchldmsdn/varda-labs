import "server-only";

import { loadSimulationFactorRows } from "@/db/queries/simulation-regime-evidence";
import type { ReadOnlyTenantSimulationOwnerResearchResult } from "@/db/queries/simulation-owner-research";
import { buildSimulationOwnerFactorHistoricalValidation } from "@/lib/simulation-owner-factor-historical-validation";
import { buildSimulationOwnerModelCalibration } from "@/lib/simulation-owner-model-calibration";

export async function getReadOnlyTenantSimulationOwnerModelCalibration(options: {
  ownerResearchPromise: Promise<ReadOnlyTenantSimulationOwnerResearchResult>;
}) {
  const ownerResearch = await options.ownerResearchPromise;
  const factorAsOfServiceDate =
    ownerResearch.modelCalibrationInput.factorAsOfServiceDate;
  const factorRows = factorAsOfServiceDate
    ? await loadSimulationFactorRows(factorAsOfServiceDate)
    : [];
  const factorValidation =
    buildSimulationOwnerFactorHistoricalValidation({
      execution: ownerResearch.execution,
      endpoints: ownerResearch.modelCalibrationInput.endpoints,
      factorRows,
    });

  return buildSimulationOwnerModelCalibration({
    bootstrap: ownerResearch.historicalValidation,
    factor: factorValidation,
  });
}
