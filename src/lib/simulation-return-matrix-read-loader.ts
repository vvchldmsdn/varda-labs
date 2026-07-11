import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";
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

export async function loadSimulationReturnMatrixUniverseEvidence(
  repository: SimulationReturnMatrixReadRepository,
  request: SimulationReturnMatrixUniverseRequest,
) {
  const plan = planSimulationReturnMatrixUniverseRead(request);
  if (plan.status === "blocked" || !plan.queryRange) {
    return composeSimulationReturnMatrixUniverseEvidence({
      request,
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

  return composeSimulationReturnMatrixUniverseEvidence({
    request,
    queryRange,
    priceRows,
    fxRows,
  });
}
