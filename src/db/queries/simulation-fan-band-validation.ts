import "server-only";

import { getReadOnlySimulationPeriodPreflightBatch } from "@/db/queries/simulation-return-matrix";
import {
  buildSimulationInputReadinessDates,
  resolveSimulationEndServiceDateSelection,
} from "@/lib/simulation-input-readiness";
import {
  SIMULATION_FAN_BAND_VALIDATION_POLICY,
  buildSimulationFanBandValidationHistory,
} from "@/lib/simulation-fan-band-validation";
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

export async function getReadOnlySimulationFanBandValidation(options?: {
  endServiceDate?: string | string[];
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
  const outcomeEndServiceDates = explicitEndServiceDate
    ? buildSimulationInputReadinessDates(explicitEndServiceDate)
    : [];
  const preflights = await getReadOnlySimulationPeriodPreflightBatch(
    outcomeEndServiceDates.map((endServiceDate) => ({
      candidates: CANDIDATES,
      endServiceDate,
      returnStepCount:
        SIMULATION_FAN_BAND_VALIDATION_POLICY.sourceReturnStepCount,
    })),
  );

  return buildSimulationFanBandValidationHistory({
    explicitEndServiceDate,
    endpoints: outcomeEndServiceDates.map((outcomeEndServiceDate, index) => ({
      outcomeEndServiceDate,
      matrix: preflights[index]?.matrixArtifact ?? null,
    })),
  });
}
