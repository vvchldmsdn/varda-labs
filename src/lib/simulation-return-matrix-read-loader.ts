import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";
import { buildSimulationReturnMatrix } from "./simulation-return-matrix.ts";
import {
  composeSimulationReturnMatrixUniverseEvidence,
  planSimulationReturnMatrixUniverseRead,
  type SimulationReturnMatrixUniverseQueryRange,
  type SimulationReturnMatrixUniverseRequest,
} from "./simulation-return-matrix-universe-evidence.ts";

export type SimulationReturnMatrixReadRepository = Readonly<{
  loadPriceRows(input: {
    instruments: readonly Readonly<{
      market: string;
      currency: "KRW" | "USD";
      ticker: string;
    }>[];
    sourceDateFrom: string;
    sourceDateTo: string;
  }): Promise<readonly SimulationReturnMatrixPriceInput[]>;
  loadFxRows(input: {
    sourceDateFrom: string;
    sourceDateTo: string;
  }): Promise<readonly SimulationReturnMatrixFxInput[]>;
}>;

export type SimulationObservedReturnSeriesRow = Readonly<{
  previousServiceDate: string;
  serviceDate: string;
  value: number;
}>;

export type SimulationObservedReturnSeries = Readonly<{
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  status: "ready" | "unavailable";
  rows: readonly SimulationObservedReturnSeriesRow[];
}>;

export async function loadSimulationReturnMatrixUniverseEvidence(
  repository: SimulationReturnMatrixReadRepository,
  request: SimulationReturnMatrixUniverseRequest,
) {
  const result = await loadSimulationReturnMatrixUniverseBundle(
    repository,
    request,
  );
  return result.evidence;
}

export async function loadSimulationReturnMatrixUniverseBundle(
  repository: SimulationReturnMatrixReadRepository,
  request: SimulationReturnMatrixUniverseRequest,
) {
  const rows = await loadUniverseRows(repository, request);
  const evidence = composeSimulationReturnMatrixUniverseEvidence({
    request,
    queryRange: rows.queryRange,
    priceRows: rows.priceRows,
    fxRows: rows.fxRows,
  });
  const matrix = buildSimulationReturnMatrix({
    requestedServiceDates: request.requestedServiceDates,
    instruments: request.instruments.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      historyStatus: "instrument_keyed" as const,
    })),
    priceRows: rows.priceRows,
    fxRows: rows.fxRows,
  });

  return Object.freeze({
    evidence,
    returnSeries: projectObservedReturnSeries(matrix),
  });
}

async function loadUniverseRows(
  repository: SimulationReturnMatrixReadRepository,
  request: SimulationReturnMatrixUniverseRequest,
) {
  const plan = planSimulationReturnMatrixUniverseRead(request);
  if (plan.status === "blocked" || !plan.queryRange) {
    return Object.freeze({
      queryRange: null,
      priceRows: [],
      fxRows: [],
    });
  }

  const queryRange: SimulationReturnMatrixUniverseQueryRange = plan.queryRange;
  const priceRowsPromise =
    plan.instruments.length > 0
      ? repository.loadPriceRows({
          instruments: plan.instruments,
          sourceDateFrom: queryRange.priceSourceDateFrom,
          sourceDateTo: queryRange.sourceDateTo,
        })
      : Promise.resolve([]);
  const fxRowsPromise =
    plan.requiresFx && queryRange.fxSourceDateFrom
      ? repository.loadFxRows({
          sourceDateFrom: queryRange.fxSourceDateFrom,
          sourceDateTo: queryRange.sourceDateTo,
        })
      : Promise.resolve([]);
  const [priceRows, fxRows] = await Promise.all([
    priceRowsPromise,
    fxRowsPromise,
  ]);

  return Object.freeze({
    queryRange,
    priceRows,
    fxRows,
  });
}

function projectObservedReturnSeries(
  matrix: ReturnType<typeof buildSimulationReturnMatrix>,
) {
  return Object.freeze(
    matrix.instruments.map((instrument) => {
      const rows: SimulationObservedReturnSeriesRow[] = [];
      let complete = matrix.status === "ready";

      for (const matrixRow of matrix.matrix) {
        const cell = matrixRow.cells.find(
          (candidate) => candidate.instrumentKey === instrument.instrumentKey,
        );
        const value = cell?.value;
        if (value === null || value === undefined || !Number.isFinite(value)) {
          complete = false;
          continue;
        }
        rows.push(
          Object.freeze({
            previousServiceDate: matrixRow.previousServiceDate,
            serviceDate: matrixRow.serviceDate,
            value,
          }),
        );
      }

      const ready = complete && rows.length === matrix.matrix.length;
      return Object.freeze({
        market: instrument.market,
        currency: instrument.currency,
        ticker: instrument.ticker,
        status: ready ? ("ready" as const) : ("unavailable" as const),
        rows: ready ? Object.freeze(rows) : Object.freeze([]),
      });
    }),
  );
}
