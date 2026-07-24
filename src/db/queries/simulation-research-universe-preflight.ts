import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import {
  SIMULATION_INPUT_READINESS_POLICY,
  resolveSimulationEndServiceDateSelection,
} from "@/lib/simulation-input-readiness";
import { loadSimulationPeriodPreflight } from "@/lib/simulation-period-preflight-loader";
import { planSimulationPeriodPreflightScan } from "@/lib/simulation-period-preflight-plan";
import {
  buildSimulationResearchUniversePreflight,
  resolveSimulationResearchUniverseSelection,
  type SimulationResearchUniversePriceRow,
} from "@/lib/simulation-research-universe-preflight";
import type { SimulationReturnMatrixReadRepository } from "@/lib/simulation-return-matrix-read-loader";
import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
} from "@/lib/simulation-return-matrix-types";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export async function getReadOnlySimulationResearchUniversePreflight(options?: {
  researchUniverse?: string | string[];
  endServiceDate?: string | string[];
  now?: Date;
}) {
  const selection = resolveSimulationResearchUniverseSelection(
    options?.researchUniverse,
  );
  const endSelection = resolveSimulationEndServiceDateSelection({
    suppliedValue: options?.endServiceDate,
    defaultEndServiceDate: resolveSnapshotCycle(
      options?.now ?? new Date(),
    ).snapshotDate,
  });
  const requestedEndServiceDate =
    endSelection.status === "valid"
      ? endSelection.endServiceDate
      : null;

  if (selection.status !== "valid" || !requestedEndServiceDate) {
    return buildSimulationResearchUniversePreflight({
      selection,
      requestedEndServiceDate,
      preflight: null,
      priceRows: [],
      fxRows: [],
    });
  }

  const candidates = selection.instruments
    .filter(
      (row) =>
        row.weightBps > 0 &&
        row.classification === "listed_instrument",
    )
    .map((row) => ({
      displayName: row.ticker,
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
    }));
  if (candidates.length === 0) {
    return buildSimulationResearchUniversePreflight({
      selection,
      requestedEndServiceDate,
      preflight: null,
      priceRows: [],
      fxRows: [],
    });
  }

  const request = {
    candidates,
    endServiceDate: requestedEndServiceDate,
    returnStepCount: SIMULATION_INPUT_READINESS_POLICY.returnStepCount,
  };
  const plan = planSimulationPeriodPreflightScan(request);
  if (plan.status !== "queryable" || !plan.queryRange) {
    return buildSimulationResearchUniversePreflight({
      selection,
      requestedEndServiceDate,
      preflight: await loadSimulationPeriodPreflight(
        EMPTY_REPOSITORY,
        request,
      ),
      priceRows: [],
      fxRows: [],
    });
  }

  const tickers = [...new Set(candidates.map((row) => row.ticker))];
  const [priceRows, fxRows] = await Promise.all([
    loadPriceRows({
      tickers,
      sourceDateFrom: plan.queryRange.sourceDateFrom,
      sourceDateTo: plan.queryRange.sourceDateTo,
    }),
    plan.requiresFx
      ? loadFxRows({
          sourceDateFrom: plan.queryRange.sourceDateFrom,
          sourceDateTo: plan.queryRange.sourceDateTo,
        })
      : Promise.resolve([]),
  ]);
  const snapshotRepository = createSnapshotRepository(
    priceRows,
    fxRows,
  );
  const preflight = await loadSimulationPeriodPreflight(
    snapshotRepository,
    request,
  );

  return buildSimulationResearchUniversePreflight({
    selection,
    requestedEndServiceDate,
    preflight,
    priceRows,
    fxRows,
  });
}

async function loadPriceRows(input: {
  tickers: readonly string[];
  sourceDateFrom: string;
  sourceDateTo: string;
}): Promise<SimulationResearchUniversePriceRow[]> {
  if (input.tickers.length === 0) return [];

  return db
    .select({
      market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
      currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
      ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
      priceDate: assetPriceSnapshots.priceDate,
      adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      adjustedCloseBasis: assetPriceSnapshots.adjustedCloseBasis,
      adjustedCloseProvider: assetPriceSnapshots.adjustedCloseProvider,
      adjustedCloseSource: assetPriceSnapshots.adjustedCloseSource,
      adjustedCloseFetchedAt:
        assetPriceSnapshots.adjustedCloseFetchedAt,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        inArray(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          [...input.tickers],
        ),
        gte(assetPriceSnapshots.priceDate, input.sourceDateFrom),
        lte(assetPriceSnapshots.priceDate, input.sourceDateTo),
        eq(assetPriceSnapshots.isSample, false),
      ),
    )
    .orderBy(
      asc(assetPriceSnapshots.priceDate),
      asc(assetPriceSnapshots.market),
      asc(assetPriceSnapshots.currency),
      asc(assetPriceSnapshots.ticker),
    );
}

async function loadFxRows(input: {
  sourceDateFrom: string;
  sourceDateTo: string;
}): Promise<SimulationReturnMatrixFxInput[]> {
  return db
    .select({
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      status: sql<string>`lower(trim(${fxRates.status}))`,
    })
    .from(fxRates)
    .where(
      and(
        gte(fxRates.rateDate, input.sourceDateFrom),
        lte(fxRates.rateDate, input.sourceDateTo),
        eq(fxRates.isSample, false),
        eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
      ),
    )
    .orderBy(asc(fxRates.rateDate));
}

function createSnapshotRepository(
  priceRows: readonly SimulationResearchUniversePriceRow[],
  fxRows: readonly SimulationReturnMatrixFxInput[],
): SimulationReturnMatrixReadRepository {
  return {
    async loadPriceRows({ instruments, sourceDateFrom, sourceDateTo }) {
      const identities = new Set(
        instruments.map(
          (row) =>
            `${row.market.toLowerCase()}|${row.currency.toUpperCase()}|${row.ticker.toUpperCase()}`,
        ),
      );
      return priceRows
        .filter(
          (row) =>
            identities.has(
              `${row.market.toLowerCase()}|${row.currency.toUpperCase()}|${row.ticker.toUpperCase()}`,
            ) &&
            row.priceDate >= sourceDateFrom &&
            row.priceDate <= sourceDateTo,
        )
        .map(toMatrixPriceRow);
    },
    async loadFxRows({ sourceDateFrom, sourceDateTo }) {
      return fxRows.filter(
        (row) =>
          row.rateDate >= sourceDateFrom &&
          row.rateDate <= sourceDateTo,
      );
    },
  };
}

function toMatrixPriceRow(
  row: SimulationResearchUniversePriceRow,
): SimulationReturnMatrixPriceInput {
  return {
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    priceDate: row.priceDate,
    adjustedClosePrice: row.adjustedClosePrice,
  };
}

const EMPTY_REPOSITORY: SimulationReturnMatrixReadRepository = {
  async loadPriceRows() {
    return [];
  },
  async loadFxRows() {
    return [];
  },
};
