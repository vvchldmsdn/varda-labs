import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  inspectSimulationRegimeResearchReadiness,
  type SimulationRegimeResearchReadinessBlockerReason,
} from "./simulation-regime-research-readiness.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";

export const SIMULATION_REGIME_READINESS_HISTORY_POLICY = Object.freeze({
  version: "simulation_regime_readiness_history_v1",
  historyDayCount: 7,
  automaticEndpointRollback: "forbidden",
  pointInTimeSafeLinkPolicy: "established_dates_only",
  retrospectiveResultRole: "diagnostic_research_not_point_in_time_evidence",
} as const);

export type SimulationRegimeReadinessHistory = ReturnType<
  typeof buildSimulationRegimeReadinessHistory
>;

export function buildSimulationRegimeReadinessHistoryDates(
  endServiceDate: string,
) {
  if (!isRiskDate(endServiceDate)) return Object.freeze([] as string[]);
  return Object.freeze(
    Array.from(
      { length: SIMULATION_REGIME_READINESS_HISTORY_POLICY.historyDayCount },
      (_, index) => shiftRiskDate(endServiceDate, -index),
    ),
  );
}

export function buildSimulationRegimeReadinessHistory(input: {
  selectedEndServiceDate: string | null;
  candidates: readonly Readonly<{
    serviceDate: string;
    matrix: SimulationReturnMatrixResult | null;
  }>[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  const entries = input.candidates.map(({ serviceDate, matrix }) => {
    const inspection = inspectSimulationRegimeResearchReadiness({
      explicitEndServiceDate: serviceDate,
      matrix,
      factorRows: input.factorRows,
    });
    const pointInTimeSafe = false as const;

    return Object.freeze({
      serviceDate,
      retrospectiveStatus: inspection.status,
      reason: inspection.reason as
        | SimulationRegimeResearchReadinessBlockerReason
        | null,
      source: inspection.source,
      readiness: inspection.readiness,
      pointInTimeStatus: inspection.pointInTime.status,
      pointInTimeSafe,
    });
  });
  const retrospectiveReadyDateCount = entries.filter(
    (entry) => entry.retrospectiveStatus === "research_ready",
  ).length;
  const safeEndServiceDates = entries
    .filter((entry) => entry.pointInTimeSafe)
    .map((entry) => entry.serviceDate);

  return Object.freeze({
    policy: SIMULATION_REGIME_READINESS_HISTORY_POLICY,
    regimePolicyVersion: SIMULATION_REGIME_BOOTSTRAP_POLICY.version,
    selectedEndServiceDate: input.selectedEndServiceDate,
    pointInTime: SIMULATION_REGIME_BOOTSTRAP_POLICY.pointInTimeEvidence,
    entries: Object.freeze(entries),
    safeEndServiceDates: Object.freeze(safeEndServiceDates),
    summary: Object.freeze({
      inspectedDateCount: entries.length,
      retrospectiveReadyDateCount,
      unavailableDateCount: entries.length - retrospectiveReadyDateCount,
      pointInTimeSafeDateCount: safeEndServiceDates.length,
    }),
  });
}
