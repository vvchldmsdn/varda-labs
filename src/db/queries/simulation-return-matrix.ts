import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import {
  loadSimulationPeriodPreflight,
  type SimulationPeriodPreflightRequest,
} from "@/lib/simulation-period-preflight-loader";
import {
  loadSimulationReturnMatrixUniverseEvidence,
  type SimulationReturnMatrixReadRepository,
} from "@/lib/simulation-return-matrix-read-loader";
import type { SimulationReturnMatrixUniverseRequest } from "@/lib/simulation-return-matrix-universe-evidence";

const drizzleSimulationReturnMatrixRepository: SimulationReturnMatrixReadRepository =
  {
    async loadPriceRows({ instruments, sourceDateFrom, sourceDateTo }) {
      const tickers = [...new Set(instruments.map((row) => row.ticker))];
      if (tickers.length === 0) return [];

      return db
        .select({
          market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
          currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
          ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          priceDate: assetPriceSnapshots.priceDate,
          adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
        })
        .from(assetPriceSnapshots)
        .where(
          and(
            inArray(
              sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
              tickers,
            ),
            gte(assetPriceSnapshots.priceDate, sourceDateFrom),
            lte(assetPriceSnapshots.priceDate, sourceDateTo),
            eq(assetPriceSnapshots.isSample, false),
          ),
        )
        .orderBy(
          asc(assetPriceSnapshots.priceDate),
          asc(assetPriceSnapshots.market),
          asc(assetPriceSnapshots.currency),
          asc(assetPriceSnapshots.ticker),
        );
    },

    async loadFxRows({ sourceDateFrom, sourceDateTo }) {
      return db
        .select({
          rateDate: fxRates.rateDate,
          usdKrw: fxRates.usdKrw,
          status: sql<string>`lower(trim(${fxRates.status}))`,
        })
        .from(fxRates)
        .where(
          and(
            gte(fxRates.rateDate, sourceDateFrom),
            lte(fxRates.rateDate, sourceDateTo),
            eq(fxRates.isSample, false),
            eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
          ),
        )
        .orderBy(asc(fxRates.rateDate));
    },
  };

export async function getReadOnlySimulationReturnMatrixUniverseEvidence(
  request: SimulationReturnMatrixUniverseRequest,
) {
  return loadSimulationReturnMatrixUniverseEvidence(
    drizzleSimulationReturnMatrixRepository,
    request,
  );
}

export async function getReadOnlySimulationPeriodPreflight(
  request: SimulationPeriodPreflightRequest,
) {
  return loadSimulationPeriodPreflight(
    drizzleSimulationReturnMatrixRepository,
    request,
  );
}
