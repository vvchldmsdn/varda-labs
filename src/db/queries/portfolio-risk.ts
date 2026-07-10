import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots, assets, fxRates } from "@/db/schema";
import {
  loadPortfolioRiskReadModel,
  type PortfolioRiskReadOptions,
} from "@/lib/portfolio-risk-read-loader";
import type {
  PortfolioRiskAccount,
  PortfolioRiskReadRepository,
} from "@/lib/portfolio-risk-read-model-types";

const TRACKED_ACCOUNTS = ["brokerage", "isa", "irp"];

// Current Basic Auth protects one migration tenant. Before multi-user auth,
// add authenticated user ownership to every repository method; account is not
// a tenant boundary.
const drizzlePortfolioRiskRepository: PortfolioRiskReadRepository = {
  async loadAssets(account) {
    return db
      .select({
        account: sql<string>`lower(trim(${assets.account}))`,
        ticker: sql<string | null>`upper(trim(${assets.ticker}))`,
        name: assets.name,
        market: sql<string>`lower(trim(${assets.market}))`,
        currency: sql<string>`upper(trim(${assets.currency}))`,
        quantity: assets.quantity,
      })
      .from(assets)
      .where(accountCondition(account))
      .orderBy(asc(assets.account), asc(assets.ticker), asc(assets.name));
  },

  async loadPrices({ tickers, sourceDateFrom, sourceDateTo }) {
    if (tickers.length === 0) return [];
    return db
      .select({
        ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
        market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
        currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
        priceDate: assetPriceSnapshots.priceDate,
        closePrice: assetPriceSnapshots.closePrice,
        adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
        source: assetPriceSnapshots.source,
        isSample: assetPriceSnapshots.isSample,
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
        ),
      )
      .orderBy(
        asc(assetPriceSnapshots.priceDate),
        asc(assetPriceSnapshots.ticker),
      );
  },

  async loadFxRates({ sourceDateFrom, sourceDateTo }) {
    return db
      .select({
        rateDate: fxRates.rateDate,
        usdKrw: fxRates.usdKrw,
        source: fxRates.source,
        status: fxRates.status,
        isSample: fxRates.isSample,
      })
      .from(fxRates)
      .where(
        and(
          gte(fxRates.rateDate, sourceDateFrom),
          lte(fxRates.rateDate, sourceDateTo),
        ),
      )
      .orderBy(asc(fxRates.rateDate));
  },
};

export async function getReadOnlyPortfolioRisk(
  options: PortfolioRiskReadOptions = {},
) {
  return loadPortfolioRiskReadModel(drizzlePortfolioRiskRepository, options);
}

function accountCondition(account: PortfolioRiskAccount) {
  const normalizedAccount = sql<string>`lower(trim(${assets.account}))`;
  return account === "all"
    ? inArray(normalizedAccount, TRACKED_ACCOUNTS)
    : eq(normalizedAccount, account);
}
