import {
  SIMULATION_REGIME_BOOTSTRAP_POLICY,
  SIMULATION_REGIME_FACTOR_DEFINITIONS,
  type SimulationRegimeFactorObservation,
  type SimulationRegimeFactorSourceSummary,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  buildSimulationRegimeFactorSourceSummaries,
  normalizeSimulationRegimeFactorRows,
  resolveSimulationRegimeFactorVector,
} from "./simulation-regime-factor-series.ts";

export type SimulationRegimeFactorStateBlockerReason =
  | "factor_rows_invalid"
  | "current_factor_state_incomplete"
  | "current_factor_state_stale"
  | "insufficient_aligned_regime_rows"
  | "insufficient_candidate_rows"
  | "factor_state_degenerate";

type AlignedState = Readonly<{
  sourceRowIndex: number;
  stateDate: string;
  values: readonly number[];
}>;

export type ReadySimulationRegimeFactorState = Readonly<{
  status: "ready";
  reason: null;
  currentStateDate: string;
  currentValues: readonly number[];
  alignedStates: readonly AlignedState[];
  neighbors: readonly Readonly<{
    sourceRowIndex: number;
    stateDate: string;
    distance: number;
    weight: number;
  }>[];
  summary: SimulationRegimeFactorReadinessSummary;
}>;

export type SimulationRegimeFactorReadinessSummary = Readonly<{
  requiredAlignedRowCount: number;
  alignedRowCount: number;
  eligibleCandidateRowCount: number;
  selectedNeighborCount: number;
  informativeFeatureCount: number;
  totalFeatureCount: number;
  factors: readonly SimulationRegimeFactorSourceSummary[];
}>;

export type SimulationRegimeFactorStateResult =
  | ReadySimulationRegimeFactorState
  | Readonly<{
      status: "unavailable";
      reason: SimulationRegimeFactorStateBlockerReason;
      currentStateDate: string;
      currentValues: null;
      alignedStates: readonly [];
      neighbors: readonly [];
      summary: SimulationRegimeFactorReadinessSummary;
    }>;

export function buildSimulationRegimeFactorState(input: {
  currentStateDate: string;
  stateDates: readonly string[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}): SimulationRegimeFactorStateResult {
  const series = normalizeSimulationRegimeFactorRows(input.factorRows);
  if (!series) {
    return unavailable(
      "factor_rows_invalid",
      input.currentStateDate,
      emptySummary(),
    );
  }

  const current = resolveSimulationRegimeFactorVector(
    series,
    input.currentStateDate,
    false,
  );
  const aligned = input.stateDates.flatMap((stateDate, sourceRowIndex) => {
    const state = resolveSimulationRegimeFactorVector(series, stateDate, true);
    return state.status === "ready"
      ? [
          Object.freeze({
            sourceRowIndex,
            stateDate,
            values: state.values,
          }),
        ]
      : [];
  });
  const factorSummaries = buildSimulationRegimeFactorSourceSummaries(
    series,
    input.currentStateDate,
    input.stateDates,
  );
  const maximumStartIndex =
    input.stateDates.length -
    SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumBlockLength;
  const structurallyEligible = aligned.filter(
    (row) => row.sourceRowIndex <= maximumStartIndex,
  );
  const scaling = robustScaling(aligned.map((row) => row.values));
  const baseSummary = Object.freeze({
    requiredAlignedRowCount:
      SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumAlignedRegimeRows,
    alignedRowCount: aligned.length,
    eligibleCandidateRowCount: structurallyEligible.length,
    selectedNeighborCount: 0,
    informativeFeatureCount: scaling.informativeFeatureCount,
    totalFeatureCount:
      SIMULATION_REGIME_FACTOR_DEFINITIONS.length *
      SIMULATION_REGIME_BOOTSTRAP_POLICY.factorMetrics.length,
    factors: factorSummaries,
  });

  if (current.status !== "ready") {
    return unavailable(
      current.status === "stale"
        ? "current_factor_state_stale"
        : "current_factor_state_incomplete",
      input.currentStateDate,
      baseSummary,
    );
  }
  if (
    aligned.length <
      SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumAlignedRegimeRows
  ) {
    return unavailable(
      "insufficient_aligned_regime_rows",
      input.currentStateDate,
      baseSummary,
    );
  }

  if (
    scaling.informativeFeatureCount <
      SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumInformativeFeatures
  ) {
    return unavailable(
      "factor_state_degenerate",
      input.currentStateDate,
      baseSummary,
    );
  }

  const eligible = structurallyEligible
    .map((row) =>
      Object.freeze({
        sourceRowIndex: row.sourceRowIndex,
        stateDate: row.stateDate,
        distance: robustDistance(current.values, row.values, scaling),
      }),
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.sourceRowIndex - right.sourceRowIndex,
    );

  if (
    eligible.length < SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumCandidateRows
  ) {
    return unavailable(
      "insufficient_candidate_rows",
      input.currentStateDate,
      Object.freeze({
        ...baseSummary,
        eligibleCandidateRowCount: eligible.length,
      }),
    );
  }

  const selected = eligible.slice(
    0,
    Math.min(
      eligible.length,
      SIMULATION_REGIME_BOOTSTRAP_POLICY.neighborCount,
    ),
  );
  const positiveDistances = selected
    .map((row) => row.distance)
    .filter((distance) => distance > Number.EPSILON);
  const bandwidth =
    positiveDistances.length > 0 ? median(positiveDistances) : 1;
  const neighbors = Object.freeze(
    selected.map((row) =>
      Object.freeze({
        ...row,
        weight: Math.max(
          Math.exp(-0.5 * (row.distance / bandwidth)),
          Number.EPSILON,
        ),
      }),
    ),
  );
  const summary = Object.freeze({
    ...baseSummary,
    eligibleCandidateRowCount: eligible.length,
    selectedNeighborCount: neighbors.length,
    informativeFeatureCount: scaling.informativeFeatureCount,
  });

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    currentStateDate: input.currentStateDate,
    currentValues: current.values,
    alignedStates: Object.freeze(aligned),
    neighbors,
    summary,
  });
}

function robustScaling(rows: readonly (readonly number[])[]) {
  const featureCount = rows[0]?.length ?? 0;
  const centers: number[] = [];
  const scales: number[] = [];
  const informative: boolean[] = [];

  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    const values = rows.map((row) => row[featureIndex]);
    const center = median(values);
    const mad = median(values.map((value) => Math.abs(value - center)));
    const robustScale = mad * 1.4826;
    const standardDeviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - center) ** 2, 0) /
        values.length,
    );
    const scale =
      robustScale > Number.EPSILON
        ? robustScale
        : standardDeviation > Number.EPSILON
          ? standardDeviation
          : 1;
    centers.push(center);
    scales.push(scale);
    informative.push(
      robustScale > Number.EPSILON || standardDeviation > Number.EPSILON,
    );
  }

  return Object.freeze({
    centers: Object.freeze(centers),
    scales: Object.freeze(scales),
    informative: Object.freeze(informative),
    informativeFeatureCount: informative.filter(Boolean).length,
  });
}

function robustDistance(
  current: readonly number[],
  historical: readonly number[],
  scaling: ReturnType<typeof robustScaling>,
) {
  let squaredDistance = 0;
  let count = 0;
  for (let index = 0; index < current.length; index += 1) {
    if (!scaling.informative[index]) continue;
    const delta = (current[index] - historical[index]) / scaling.scales[index];
    squaredDistance += delta * delta;
    count += 1;
  }
  return count > 0 ? squaredDistance / count : Number.POSITIVE_INFINITY;
}

function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function emptySummary(): SimulationRegimeFactorReadinessSummary {
  return Object.freeze({
    requiredAlignedRowCount:
      SIMULATION_REGIME_BOOTSTRAP_POLICY.minimumAlignedRegimeRows,
    alignedRowCount: 0,
    eligibleCandidateRowCount: 0,
    selectedNeighborCount: 0,
    informativeFeatureCount: 0,
    totalFeatureCount:
      SIMULATION_REGIME_FACTOR_DEFINITIONS.length *
      SIMULATION_REGIME_BOOTSTRAP_POLICY.factorMetrics.length,
    factors: Object.freeze(
      SIMULATION_REGIME_FACTOR_DEFINITIONS.map((definition) =>
        Object.freeze({
          factorKey: definition.factorKey,
          label: definition.label,
          latestReleaseDate: null,
          currentReleaseDate: null,
          currentCarryDays: null,
          alignedStateCount: 0,
          availabilityTimestampStatus: "not_preserved" as const,
          vintageStatus: "not_preserved" as const,
        }),
      ),
    ),
  });
}

function unavailable(
  reason: SimulationRegimeFactorStateBlockerReason,
  currentStateDate: string,
  summary: SimulationRegimeFactorReadinessSummary,
): SimulationRegimeFactorStateResult {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    currentStateDate,
    currentValues: null,
    alignedStates: Object.freeze([] as const),
    neighbors: Object.freeze([] as const),
    summary,
  });
}
