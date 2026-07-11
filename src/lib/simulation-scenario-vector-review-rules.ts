import type {
  NormalizedSimulationScenarioInstrument,
  NormalizedSimulationScenarioWeight,
} from "./simulation-scenario-vector-review-input.ts";

export type SimulationScenarioVectorReviewBlockerReason =
  | "invalid_scenario_id"
  | "invalid_scenario_version"
  | "empty_matrix_universe"
  | "incomplete_matrix_identity"
  | "unsupported_matrix_currency"
  | "duplicate_matrix_identity"
  | "empty_weight_vector"
  | "incomplete_weight_identity"
  | "unsupported_weight_currency"
  | "duplicate_weight_identity"
  | "missing_instrument_weight"
  | "external_instrument"
  | "invalid_weight_bps"
  | "weight_total_invalid";

export type SimulationScenarioVectorReviewBlocker = Readonly<{
  reason: SimulationScenarioVectorReviewBlockerReason;
  instrumentKey: string | null;
}>;

export function validateSimulationScenarioVectorMetadata(
  input: {
    scenarioId: string | null;
    scenarioVersion: string | null;
    matrixInstruments: readonly NormalizedSimulationScenarioInstrument[];
    weights: readonly NormalizedSimulationScenarioWeight[];
  },
  blockers: SimulationScenarioVectorReviewBlocker[],
) {
  if (!input.scenarioId) addBlocker(blockers, "invalid_scenario_id");
  if (!input.scenarioVersion) {
    addBlocker(blockers, "invalid_scenario_version");
  }
  if (input.matrixInstruments.length === 0) {
    addBlocker(blockers, "empty_matrix_universe");
  }
  if (input.weights.length === 0) {
    addBlocker(blockers, "empty_weight_vector");
  }
}

export function validateSimulationScenarioMatrixUniverse(
  rows: readonly NormalizedSimulationScenarioInstrument[],
  blockers: SimulationScenarioVectorReviewBlocker[],
) {
  const counts = countInstrumentKeys(rows);
  for (const row of rows) {
    if (!row.instrumentKey) {
      addBlocker(blockers, "incomplete_matrix_identity");
    }
    if (row.currency !== "KRW" && row.currency !== "USD") {
      addBlocker(
        blockers,
        "unsupported_matrix_currency",
        row.instrumentKey,
      );
    }
    if (row.instrumentKey && (counts.get(row.instrumentKey) ?? 0) > 1) {
      addBlocker(
        blockers,
        "duplicate_matrix_identity",
        row.instrumentKey,
      );
    }
  }
}

export function validateSimulationScenarioWeights(
  rows: readonly NormalizedSimulationScenarioWeight[],
  blockers: SimulationScenarioVectorReviewBlocker[],
) {
  const counts = countInstrumentKeys(rows);
  for (const row of rows) {
    if (!row.instrumentKey) {
      addBlocker(blockers, "incomplete_weight_identity");
    }
    if (row.currency !== "KRW" && row.currency !== "USD") {
      addBlocker(
        blockers,
        "unsupported_weight_currency",
        row.instrumentKey,
      );
    }
    if (row.instrumentKey && (counts.get(row.instrumentKey) ?? 0) > 1) {
      addBlocker(
        blockers,
        "duplicate_weight_identity",
        row.instrumentKey,
      );
    }
    if (
      row.weightState !== "finite" ||
      row.weightBps === null ||
      !Number.isInteger(row.weightBps) ||
      row.weightBps < 0 ||
      row.weightBps > 10_000
    ) {
      addBlocker(blockers, "invalid_weight_bps", row.instrumentKey);
    }
  }
}

export function uniqueSimulationScenarioRowsByKey<
  T extends { instrumentKey: string | null },
>(rows: readonly T[]) {
  const counts = countInstrumentKeys(rows);
  return new Map(
    rows
      .filter(
        (row): row is T & { instrumentKey: string } =>
          Boolean(row.instrumentKey) &&
          counts.get(row.instrumentKey as string) === 1,
      )
      .map((row) => [row.instrumentKey, row]),
  );
}

export function addSimulationScenarioVectorBlocker(
  blockers: SimulationScenarioVectorReviewBlocker[],
  reason: SimulationScenarioVectorReviewBlockerReason,
  instrumentKey: string | null = null,
) {
  blockers.push(Object.freeze({ reason, instrumentKey }));
}

export function sortSimulationScenarioVectorBlockers(
  blockers: readonly SimulationScenarioVectorReviewBlocker[],
) {
  const unique = new Map(
    blockers.map((row) => [
      JSON.stringify([row.reason, row.instrumentKey]),
      row,
    ]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.reason.localeCompare(right.reason) ||
      String(left.instrumentKey).localeCompare(String(right.instrumentKey)),
  );
}

function addBlocker(
  blockers: SimulationScenarioVectorReviewBlocker[],
  reason: SimulationScenarioVectorReviewBlockerReason,
  instrumentKey: string | null = null,
) {
  addSimulationScenarioVectorBlocker(blockers, reason, instrumentKey);
}

function countInstrumentKeys(
  rows: readonly { instrumentKey: string | null }[],
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.instrumentKey) {
      counts.set(row.instrumentKey, (counts.get(row.instrumentKey) ?? 0) + 1);
    }
  }
  return counts;
}
