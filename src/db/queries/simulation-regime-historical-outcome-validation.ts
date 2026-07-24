import "server-only";

import { loadRegimeFactorRows, REGIME_RESEARCH_CANDIDATES } from "@/db/queries/simulation-regime-evidence";
import { getReadOnlySimulationPeriodPreflightBatch } from "@/db/queries/simulation-return-matrix";
import {
  buildSimulationInputReadinessDates,
  resolveSimulationEndServiceDateSelection,
} from "@/lib/simulation-input-readiness";
import {
  buildSimulationRegimeHistoricalOutcomeValidation,
  SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY,
} from "@/lib/simulation-regime-historical-outcome-validation";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export async function getReadOnlySimulationRegimeHistoricalOutcomeValidation(
  options?: {
    endServiceDate?: string | string[];
    now?: Date;
  },
) {
  const now = options?.now ?? new Date();
  const selection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options?.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(now).snapshotDate,
  });
  const explicitEndServiceDate =
    selection.status === "valid" && selection.source === "query"
      ? selection.endServiceDate
      : null;
  const outcomeEndServiceDates = explicitEndServiceDate
    ? buildSimulationInputReadinessDates(explicitEndServiceDate)
    : [];

  if (!explicitEndServiceDate) {
    return buildSimulationRegimeHistoricalOutcomeValidation({
      explicitEndServiceDate: null,
      endpoints: Object.freeze([]),
      factorRows: Object.freeze([]),
    });
  }

  const [preflights, factorRows] = await Promise.all([
    getReadOnlySimulationPeriodPreflightBatch(
      outcomeEndServiceDates.map((endServiceDate) => ({
        candidates: REGIME_RESEARCH_CANDIDATES,
        endServiceDate,
        returnStepCount:
          SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY
            .sourceReturnStepCount,
      })),
    ),
    loadRegimeFactorRows(explicitEndServiceDate),
  ]);

  return buildSimulationRegimeHistoricalOutcomeValidation({
    explicitEndServiceDate,
    endpoints: outcomeEndServiceDates.map(
      (outcomeEndServiceDate, index) => ({
        outcomeEndServiceDate,
        matrix: preflights[index]?.matrixArtifact ?? null,
      }),
    ),
    factorRows,
  });
}
