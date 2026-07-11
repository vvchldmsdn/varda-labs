import { createHash } from "node:crypto";

import { isRiskDate } from "./portfolio-risk-calendar.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import type {
  CanonicalReadyReturnMatrix,
  StationaryBootstrapBlocker,
  StationaryBootstrapPath,
} from "./simulation-stationary-bootstrap-types.ts";

export function validateAndHashReadyReturnMatrix(
  matrix: SimulationReturnMatrixResult,
): {
  canonical: CanonicalReadyReturnMatrix | null;
  blockers: readonly StationaryBootstrapBlocker[];
} {
  if (
    matrix?.status !== "ready" ||
    matrix?.consumerStatus !== "matrix_ready" ||
    matrix?.policy?.version !== "simulation_return_matrix_v1" ||
    matrix?.blockers?.length !== 0 ||
    matrix?.exclusions?.length !== 0
  ) {
    return blockedMatrix("input_matrix_not_ready");
  }

  const instrumentKeys = matrix.instruments.map((row) => row.instrumentKey);
  const serviceDates = [...matrix.requestedServiceDates];
  const expectedMatrixRowCount = serviceDates.length - 1;
  const expectedCellCount = expectedMatrixRowCount * instrumentKeys.length;
  const shapeValid =
    instrumentKeys.length > 0 &&
    isStrictlySortedUnique(instrumentKeys) &&
    serviceDates.length >= 2 &&
    serviceDates.every(isRiskDate) &&
    isStrictlySortedUnique(serviceDates) &&
    matrix.matrix.length === expectedMatrixRowCount &&
    matrix.matrix.every((row, rowIndex) => {
      const cellKeys = row.cells.map((cell) => cell.instrumentKey);
      return (
        row.previousServiceDate === serviceDates[rowIndex] &&
        row.serviceDate === serviceDates[rowIndex + 1] &&
        row.cells.length === instrumentKeys.length &&
        cellKeys.every((key, index) => key === instrumentKeys[index]) &&
        row.cells.every(
          (cell) =>
            typeof cell.value === "number" && Number.isFinite(cell.value),
        )
      );
    }) &&
    matrix.summary.requestedInstrumentCount === instrumentKeys.length &&
    matrix.summary.includedInstrumentCount === instrumentKeys.length &&
    matrix.summary.excludedInstrumentCount === 0 &&
    matrix.summary.requestedServiceDateCount === serviceDates.length &&
    matrix.summary.matrixRowCount === expectedMatrixRowCount &&
    matrix.summary.totalCellCount === expectedCellCount &&
    matrix.summary.readyCellCount === expectedCellCount &&
    matrix.summary.incompleteCellCount === 0 &&
    matrix.summary.coveragePct === 100;

  if (!shapeValid) return blockedMatrix("input_matrix_shape_invalid");

  const canonicalSerialization = JSON.stringify({
    hashVersion: "simulation_return_matrix_hash_v1",
    matrixPolicyVersion: matrix.policy.version,
    requestedServiceDates: serviceDates,
    instrumentKeys,
    rows: matrix.matrix.map((row) => ({
      previousServiceDate: row.previousServiceDate,
      serviceDate: row.serviceDate,
      returns: row.cells.map((cell) =>
        Object.is(cell.value, -0) ? 0 : cell.value,
      ),
    })),
  });
  const inputMatrixHash = sha256(canonicalSerialization);

  return {
    canonical: Object.freeze({
      inputMatrixHash,
      sourceRowCount: matrix.matrix.length,
      instrumentCount: instrumentKeys.length,
      rows: Object.freeze(
        matrix.matrix.map((row) =>
          Object.freeze({
            previousServiceDate: row.previousServiceDate,
            serviceDate: row.serviceDate,
          }),
        ),
      ),
    }),
    blockers: Object.freeze([]),
  };
}

export function hashStationaryBootstrapDrawPlan(input: {
  inputMatrixHash: string;
  seed: number;
  expectedBlockLength: number;
  horizon: number;
  pathCount: number;
  paths: readonly StationaryBootstrapPath[];
}) {
  return sha256(
    JSON.stringify({
      planVersion: "stationary_bootstrap_draw_plan_v1",
      inputMatrixHash: input.inputMatrixHash,
      prng: "mulberry32_v1",
      seed: input.seed,
      expectedBlockLength: input.expectedBlockLength,
      horizon: input.horizon,
      pathCount: input.pathCount,
      paths: input.paths.map((path) => ({
        pathIndex: path.pathIndex,
        draws: path.draws.map((draw) => ({
          stepIndex: draw.stepIndex,
          sourceRowIndex: draw.sourceRowIndex,
          previousServiceDate: draw.previousServiceDate,
          serviceDate: draw.serviceDate,
          blockStart: draw.blockStart,
        })),
      })),
    }),
  );
}

function blockedMatrix(
  reason: StationaryBootstrapBlocker["reason"],
) {
  return {
    canonical: null,
    blockers: Object.freeze([Object.freeze({ reason })]),
  };
}

function isStrictlySortedUnique(values: readonly string[]) {
  return values.every(
    (value, index) =>
      typeof value === "string" &&
      value.length > 0 &&
      (index === 0 || values[index - 1].localeCompare(value) < 0),
  );
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
