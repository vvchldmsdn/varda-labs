import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, assetPriceSnapshots, assets, fxRates } from "@/db/schema";
import {
  loadPortfolioRiskReadModel,
  type PortfolioRiskReadOptions,
} from "@/lib/portfolio-risk-read-loader";
import type {
  PortfolioRiskAccount,
  PortfolioRiskReadRepository,
} from "@/lib/portfolio-risk-read-model-types";
import { admitAdjustedHistoricalPriceRows } from "@/lib/market-data/asset-price-consumer-admission";
import type { TenantContext } from "@/lib/session-resolver-contract";

const TRACKED_ACCOUNTS = ["brokerage", "isa", "irp"];

const drizzlePortfolioRiskRepository: PortfolioRiskReadRepository = {
  async loadAssets(account) {
    return db
      .select({
        account: sql<string>`lower(trim(${assets.account}))`,
        ticker: sql<string | null>`upper(trim(${assets.ticker}))`,
        name: assets.name,
        market: sql<string>`lower(trim(${assets.market}))`,
        currency: sql<string>`upper(trim(${assets.currency}))`,
        assetType: sql<string | null>`lower(trim(${assets.assetType}))`,
        quantity: assets.quantity,
      })
      .from(assets)
      .where(accountCondition(account))
      .orderBy(asc(assets.account), asc(assets.ticker), asc(assets.name));
  },

  async loadPrices({ tickers, sourceDateFrom, sourceDateTo }) {
    if (tickers.length === 0) return [];
    const rows = await db
      .select({
        ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
        market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
        currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
        priceDate: assetPriceSnapshots.priceDate,
        closePrice: assetPriceSnapshots.closePrice,
        adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
        adjustedCloseBasis: assetPriceSnapshots.adjustedCloseBasis,
        adjustedCloseProvider: assetPriceSnapshots.adjustedCloseProvider,
        adjustedCloseSource: assetPriceSnapshots.adjustedCloseSource,
        adjustedCloseFetchedAt:
          assetPriceSnapshots.adjustedCloseFetchedAt,
        providerSymbol: assetPriceSnapshots.providerSymbol,
        providerExchange: assetPriceSnapshots.providerExchange,
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
          eq(assetPriceSnapshots.isSample, false),
        ),
      )
      .orderBy(
        asc(assetPriceSnapshots.priceDate),
        asc(assetPriceSnapshots.ticker),
      );

    return [...admitAdjustedHistoricalPriceRows(rows).rows];
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

function createTenantPortfolioRiskRepository(
  tenantContext: TenantContext,
): PortfolioRiskReadRepository {
  return {
    async loadAssets(account) {
      const predicates = [
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        inArray(accounts.code, TRACKED_ACCOUNTS),
        eq(assets.account, accounts.code),
      ];
      if (account !== "all") predicates.push(eq(accounts.code, account));

      return db
        .select({
          account: sql<string>`lower(trim(${assets.account}))`,
          ticker: sql<string | null>`upper(trim(${assets.ticker}))`,
          name: assets.name,
          market: sql<string>`lower(trim(${assets.market}))`,
          currency: sql<string>`upper(trim(${assets.currency}))`,
          assetType: sql<string | null>`lower(trim(${assets.assetType}))`,
          quantity: assets.quantity,
        })
        .from(assets)
        .innerJoin(accounts, eq(assets.accountId, accounts.id))
        .where(and(...predicates))
        .orderBy(asc(accounts.sortOrder), asc(accounts.code), asc(assets.ticker));
    },
    loadPrices: drizzlePortfolioRiskRepository.loadPrices,
    loadFxRates: drizzlePortfolioRiskRepository.loadFxRates,
  };
}

export async function getReadOnlyPortfolioRisk(
  options: PortfolioRiskReadOptions = {},
) {
  return loadPortfolioRiskReadModel(drizzlePortfolioRiskRepository, options);
}

export async function getReadOnlyTenantPortfolioRisk({
  tenantContext,
  ...options
}: PortfolioRiskReadOptions & { tenantContext: TenantContext }) {
  return loadPortfolioRiskReadModel(
    createTenantPortfolioRiskRepository(tenantContext),
    options,
  );
}

function accountCondition(account: PortfolioRiskAccount) {
  const normalizedAccount = sql<string>`lower(trim(${assets.account}))`;
  return account === "all"
    ? inArray(normalizedAccount, TRACKED_ACCOUNTS)
    : eq(normalizedAccount, account);
}
