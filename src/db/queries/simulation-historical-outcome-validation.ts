import "server-only";

import { getReadOnlySimulationPeriodPreflightBatch } from "@/db/queries/simulation-return-matrix";
import {
  buildSimulationInputReadinessDates,
  resolveSimulationEndServiceDateSelection,
  SIMULATION_INPUT_READINESS_POLICY,
} from "@/lib/simulation-input-readiness";
import {
  buildSimulationHistoricalOutcomeValidation,
} from "@/lib/simulation-historical-outcome-validation";
import {
  resolveSimulationResearchHorizon,
} from "@/lib/simulation-research-horizon";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const CANDIDATES = Object.freeze([
  Object.freeze({
    displayName: "KODEX 200",
    market: "korea",
    currency: "KRW",
    ticker: "069500",
  }),
  Object.freeze({
    displayName: "Vanguard S&P 500 ETF",
    market: "us",
    currency: "USD",
    ticker: "VOO",
  }),
]);

export async function getReadOnlySimulationHistoricalOutcomeValidation(options?: {
  endServiceDate?: string | string[];
  horizon?: string | string[];
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const selection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options?.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(now).snapshotDate,
  });
  const explicitEndServiceDate =
    selection.status === "valid" && selection.source === "query"
      ? selection.endServiceDate
      : null;
  const horizonSelection = resolveSimulationResearchHorizon(
    options?.horizon,
  );
  const horizon = horizonSelection.horizon;
  const outcomeEndServiceDates = explicitEndServiceDate
    ? buildSimulationInputReadinessDates(explicitEndServiceDate)
    : [];
  const preflights = await getReadOnlySimulationPeriodPreflightBatch(
    horizon === null
      ? []
      : outcomeEndServiceDates.map((endServiceDate) => ({
          candidates: CANDIDATES,
          endServiceDate,
          returnStepCount:
            SIMULATION_INPUT_READINESS_POLICY.returnStepCount + horizon,
        })),
  );

  return buildSimulationHistoricalOutcomeValidation({
    explicitEndServiceDate,
    horizon,
    endpoints: outcomeEndServiceDates.map((outcomeEndServiceDate, index) => ({
      outcomeEndServiceDate,
      matrix: preflights[index]?.matrixArtifact ?? null,
    })),
  });
}
