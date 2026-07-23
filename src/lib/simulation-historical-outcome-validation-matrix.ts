import { FIXED_MIX_INSTRUMENTS } from "./simulation-fixed-mix-research-context.ts";
import {
  SIMULATION_FAN_BAND_VALIDATION_POLICY,
} from "./simulation-fan-band-validation-policy.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

type HistoricalOutcomeMatrixPolicy = Readonly<{
  sourceReturnStepCount: number;
}>;

export function isHistoricalOutcomeValidationSourceMatrix(
  matrix: SimulationReturnMatrixResult,
  outcomeEndServiceDate: string,
  policy: HistoricalOutcomeMatrixPolicy =
    SIMULATION_FAN_BAND_VALIDATION_POLICY,
) {
  return (
    matrix.consumerStatus === "matrix_ready" &&
    matrix.blockers.length === 0 &&
    matrix.exclusions.length === 0 &&
    matrix.matrix.length === policy.sourceReturnStepCount &&
    matrix.requestedServiceDates.length === policy.sourceReturnStepCount + 1 &&
    matrix.requestedServiceDates.at(-1) === outcomeEndServiceDate &&
    matrix.instruments.length === FIXED_MIX_INSTRUMENTS.length &&
    matrix.instruments.every((instrument, index) => {
      const expected = FIXED_MIX_INSTRUMENTS[index];
      return (
        expected !== undefined &&
        instrument.market === expected.market &&
        instrument.currency === expected.currency &&
        instrument.ticker === expected.ticker
      );
    }) &&
    matrix.matrix.every(
      (row, index) =>
        row.previousServiceDate === matrix.requestedServiceDates[index] &&
        row.serviceDate === matrix.requestedServiceDates[index + 1] &&
        row.cells.length === FIXED_MIX_INSTRUMENTS.length &&
        row.cells.every(
          (cell, cellIndex) =>
            cell.instrumentKey ===
              matrix.instruments[cellIndex]?.instrumentKey &&
            typeof cell.value === "number" &&
            Number.isFinite(cell.value) &&
            cell.value > -1,
        ),
    )
  );
}

export function sliceReadySimulationReturnMatrix(
  matrix: SimulationReturnMatrixResult,
  rowStart: number,
  rowCount: number,
): SimulationReturnMatrixResult {
  const rows = Object.freeze(
    matrix.matrix.slice(rowStart, rowStart + rowCount),
  );
  const requestedServiceDates = Object.freeze(
    matrix.requestedServiceDates.slice(rowStart, rowStart + rowCount + 1),
  );
  const totalCellCount = rows.length * matrix.instruments.length;

  return Object.freeze({
    ...matrix,
    requestedServiceDates,
    matrix: rows,
    summary: Object.freeze({
      requestedInstrumentCount: matrix.instruments.length,
      includedInstrumentCount: matrix.instruments.length,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: requestedServiceDates.length,
      matrixRowCount: rows.length,
      totalCellCount,
      readyCellCount: totalCellCount,
      incompleteCellCount: 0,
      coveragePct: 100,
    }),
  });
}
