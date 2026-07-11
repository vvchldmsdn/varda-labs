import {
  alignSimulationValue,
  normalizeSimulationFxRows,
  normalizeSimulationInstrumentUniverse,
  normalizeSimulationPriceRows,
  sortSimulationBlockers,
  validateSimulationServiceDates,
} from "./simulation-return-matrix-normalization.ts";
import type {
  SimulationAlignedValue,
  SimulationReturnMatrixBlocker,
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixInstrumentInput,
  SimulationReturnMatrixPriceInput,
  SimulationReturnMatrixResult,
  SimulationReturnMatrixRow,
  SimulationReturnMatrixSourceSummary,
  SimulationReturnMatrixSummary,
} from "./simulation-return-matrix-types.ts";

export type {
  SimulationReturnMatrixBlocker,
  SimulationReturnMatrixCell,
  SimulationReturnMatrixCellEvidence,
  SimulationReturnMatrixExclusion,
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixInstrument,
  SimulationReturnMatrixInstrumentInput,
  SimulationReturnMatrixPriceInput,
  SimulationReturnMatrixResult,
  SimulationReturnMatrixRow,
  SimulationReturnMatrixStatus,
} from "./simulation-return-matrix-types.ts";

export const SIMULATION_RETURN_MATRIX_POLICY = Object.freeze({
  version: "simulation_return_matrix_v1",
  returnKind: "krw_investor_simple_return",
  priceField: "adjusted_close_price_only",
  fxPolicy: "date_specific_usdkrw",
  serviceDatePolicy: "stored_close_evidence_d_plus_1",
  maxPriceCarryDays: 7,
  maxFxCarryDays: 3,
  missingCellPolicy: "preserve_null_without_row_drop_or_zero_fill",
  instrumentMinimum: "none",
  stochasticConsumer: "blocked_when_incomplete",
} as const);

export function buildSimulationReturnMatrix({
  requestedServiceDates,
  instruments: instrumentInputs,
  priceRows,
  fxRows,
}: {
  requestedServiceDates: readonly string[];
  instruments: readonly SimulationReturnMatrixInstrumentInput[];
  priceRows: readonly SimulationReturnMatrixPriceInput[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}): SimulationReturnMatrixResult {
  const serviceDateResult = validateSimulationServiceDates(
    requestedServiceDates,
  );
  const universe = normalizeSimulationInstrumentUniverse(instrumentInputs);
  const initialBlockers = sortSimulationBlockers([
    ...serviceDateResult.blockers,
    ...universe.blockers,
  ]);
  const safeServiceDates =
    serviceDateResult.blockers.length === 0 ? serviceDateResult.dates : [];

  if (initialBlockers.length > 0) {
    return buildResult({
      status: "blocked",
      requestedInstrumentCount: instrumentInputs.length,
      requestedServiceDates: safeServiceDates,
      instruments: universe.instruments,
      exclusions: universe.exclusions,
      matrix: [],
      sourceSummary: emptySourceSummary(),
      blockers: initialBlockers,
    });
  }

  const priceInput = normalizeSimulationPriceRows({
    rows: priceRows,
    instruments: universe.instruments,
    serviceDates: safeServiceDates,
    maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
  });
  const fxInput = normalizeSimulationFxRows({
    rows: fxRows,
    required: universe.instruments.some((row) => row.currency === "USD"),
    serviceDates: safeServiceDates,
    maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays,
  });
  const sourceSummary = Object.freeze({
    acceptedPriceRows: priceInput.acceptedRows,
    acceptedFxRows: fxInput.acceptedRows,
    ignoredOutOfWindowPriceRows: priceInput.ignoredOutOfWindowRows,
    ignoredOutOfWindowFxRows: fxInput.ignoredOutOfWindowRows,
  });
  const sourceBlockers = sortSimulationBlockers([
    ...priceInput.blockers,
    ...fxInput.blockers,
  ]);

  if (sourceBlockers.length > 0) {
    return buildResult({
      status: "blocked",
      requestedInstrumentCount: instrumentInputs.length,
      requestedServiceDates: safeServiceDates,
      instruments: universe.instruments,
      exclusions: universe.exclusions,
      matrix: [],
      sourceSummary,
      blockers: sourceBlockers,
    });
  }

  const alignedByDate = new Map<string, Map<string, SimulationAlignedValue>>();
  const calculationBlockers: SimulationReturnMatrixBlocker[] = [];
  for (const serviceDate of safeServiceDates) {
    const values = new Map<string, SimulationAlignedValue>();
    for (const instrument of universe.instruments) {
      const aligned = alignSimulationValue({
        serviceDate,
        instrument,
        priceSeries:
          priceInput.seriesByInstrument.get(instrument.instrumentKey) ?? [],
        fxSeries: fxInput.series,
        maxPriceCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
        maxFxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays,
      });
      if (aligned.evidence.status === "ready" && aligned.unitValueKrw === null) {
        calculationBlockers.push({
          reason: "invalid_return_value",
          instrumentKey: instrument.instrumentKey,
          dates: Object.freeze([serviceDate]),
        });
      }
      values.set(instrument.instrumentKey, aligned);
    }
    alignedByDate.set(serviceDate, values);
  }

  if (calculationBlockers.length > 0) {
    return buildResult({
      status: "blocked",
      requestedInstrumentCount: instrumentInputs.length,
      requestedServiceDates: safeServiceDates,
      instruments: universe.instruments,
      exclusions: universe.exclusions,
      matrix: [],
      sourceSummary,
      blockers: sortSimulationBlockers(calculationBlockers),
    });
  }

  const matrix: SimulationReturnMatrixRow[] = [];
  for (let index = 1; index < safeServiceDates.length; index += 1) {
    const previousServiceDate = safeServiceDates[index - 1];
    const serviceDate = safeServiceDates[index];
    const previousValues = alignedByDate.get(previousServiceDate);
    const currentValues = alignedByDate.get(serviceDate);
    const cells = universe.instruments.map((instrument) => {
      const previous = previousValues?.get(instrument.instrumentKey);
      const current = currentValues?.get(instrument.instrumentKey);
      if (!previous || !current) {
        throw new Error("Simulation return matrix alignment invariant failed");
      }
      const value =
        previous.unitValueKrw !== null && current.unitValueKrw !== null
          ? current.unitValueKrw / previous.unitValueKrw - 1
          : null;
      if (value !== null && !Number.isFinite(value)) {
        calculationBlockers.push({
          reason: "invalid_return_value",
          instrumentKey: instrument.instrumentKey,
          dates: Object.freeze([previousServiceDate, serviceDate]),
        });
      }
      return Object.freeze({
        instrumentKey: instrument.instrumentKey,
        value,
        previous: previous.evidence,
        current: current.evidence,
      });
    });
    matrix.push(
      Object.freeze({
        previousServiceDate,
        serviceDate,
        cells: Object.freeze(cells),
      }),
    );
  }

  if (calculationBlockers.length > 0) {
    return buildResult({
      status: "blocked",
      requestedInstrumentCount: instrumentInputs.length,
      requestedServiceDates: safeServiceDates,
      instruments: universe.instruments,
      exclusions: universe.exclusions,
      matrix: [],
      sourceSummary,
      blockers: sortSimulationBlockers(calculationBlockers),
    });
  }

  const totalCellCount = matrix.reduce(
    (count, row) => count + row.cells.length,
    0,
  );
  const readyCellCount = matrix.reduce(
    (count, row) =>
      count + row.cells.filter((cell) => cell.value !== null).length,
    0,
  );
  const status =
    universe.instruments.length > 0 &&
    universe.exclusions.length === 0 &&
    readyCellCount === totalCellCount
      ? "ready"
      : "incomplete";

  return buildResult({
    status,
    requestedInstrumentCount: instrumentInputs.length,
    requestedServiceDates: safeServiceDates,
    instruments: universe.instruments,
    exclusions: universe.exclusions,
    matrix: Object.freeze(matrix),
    sourceSummary,
    blockers: [],
  });
}

function buildResult({
  status,
  requestedInstrumentCount,
  requestedServiceDates,
  instruments,
  exclusions,
  matrix,
  sourceSummary,
  blockers,
}: {
  status: SimulationReturnMatrixResult["status"];
  requestedInstrumentCount: number;
  requestedServiceDates: readonly string[];
  instruments: SimulationReturnMatrixResult["instruments"];
  exclusions: SimulationReturnMatrixResult["exclusions"];
  matrix: readonly SimulationReturnMatrixRow[];
  sourceSummary: SimulationReturnMatrixSourceSummary;
  blockers: readonly SimulationReturnMatrixBlocker[];
}): SimulationReturnMatrixResult {
  const totalCellCount = matrix.reduce(
    (count, row) => count + row.cells.length,
    0,
  );
  const readyCellCount = matrix.reduce(
    (count, row) =>
      count + row.cells.filter((cell) => cell.value !== null).length,
    0,
  );
  const summary: SimulationReturnMatrixSummary = Object.freeze({
    requestedInstrumentCount,
    includedInstrumentCount: instruments.length,
    excludedInstrumentCount: exclusions.length,
    requestedServiceDateCount: requestedServiceDates.length,
    matrixRowCount: matrix.length,
    totalCellCount,
    readyCellCount,
    incompleteCellCount: totalCellCount - readyCellCount,
    coveragePct:
      totalCellCount > 0 ? (readyCellCount / totalCellCount) * 100 : 0,
  });

  return Object.freeze({
    status,
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates: Object.freeze([...requestedServiceDates]),
    instruments: Object.freeze([...instruments]),
    exclusions: Object.freeze([...exclusions]),
    matrix: Object.freeze([...matrix]),
    summary,
    sourceSummary,
    consumerStatus:
      status === "ready" ? "matrix_ready" : "blocked_incomplete_matrix",
    blockers: Object.freeze([...blockers]),
  });
}

function emptySourceSummary(): SimulationReturnMatrixSourceSummary {
  return Object.freeze({
    acceptedPriceRows: 0,
    acceptedFxRows: 0,
    ignoredOutOfWindowPriceRows: 0,
    ignoredOutOfWindowFxRows: 0,
  });
}
