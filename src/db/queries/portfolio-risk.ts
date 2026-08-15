import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { accounts, assetPriceSnapshots, assets, fxRates } from "@/db/schema";
import {
  loadPreselectedPortfolioRiskReadModel,
  loadPortfolioRiskReadModel,
  type PreselectedPortfolioRiskReadOptions,
  type PortfolioRiskReadOptions,
} from "@/lib/portfolio-risk-read-loader";
import type { PortfolioRiskReadRepository } from "@/lib/portfolio-risk-read-model-types";
import { admitAdjustedHistoricalPriceRows } from "@/lib/market-data/asset-price-consumer-admission";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

const TRACKED_ACCOUNTS = ["brokerage", "isa", "irp"];

export const loadPortfolioRiskPriceCandidates = async ({
  tickers,
  sourceDateFrom,
  sourceDateTo,
}: Parameters<PortfolioRiskReadRepository["loadPrices"]>[0]) => {
  if (tickers.length === 0) return [];
  return db
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
      adjustedCloseFetchedAt: assetPriceSnapshots.adjustedCloseFetchedAt,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
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
};

const loadSharedPortfolioRiskPrices: PortfolioRiskReadRepository["loadPrices"] =
  async (input) => {
    return [
      ...admitAdjustedHistoricalPriceRows(
        await loadPortfolioRiskPriceCandidates(input),
      ).rows,
    ];
  };

export const loadPortfolioRiskFxRates: PortfolioRiskReadRepository["loadFxRates"] =
  async ({ sourceDateFrom, sourceDateTo }) => {
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
  };

export function createTenantPortfolioRiskRepository(
  tenantContext: TenantContext,
  loadPrices: PortfolioRiskReadRepository["loadPrices"] =
    loadSharedPortfolioRiskPrices,
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
    loadPrices,
    loadFxRates: loadPortfolioRiskFxRates,
  };
}

export function createTenantPortfolioRiskScopeRepository({
  loadPrices = loadSharedPortfolioRiskPrices,
  scope,
  serviceDate,
  tenantContext,
}: {
  loadPrices?: PortfolioRiskReadRepository["loadPrices"];
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  tenantContext: TenantContext;
}): PortfolioRiskReadRepository {
  return {
    async loadAssets() {
      const targets = await getPortfolioAnalysisScopeTargets({
        scope,
        serviceDate,
        tenantContext,
      });
      const scopePredicate = targets.includesAllOwnedAccounts
        ? undefined
        : combineScopePredicates([
            inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
            inArrayWhenPresent(assets.id, targets.directAssetIds),
          ]);
      if (scopePredicate === null) return [];

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
        .where(
          and(
            eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(accounts.isActive, true),
            eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(assets.account, accounts.code),
            scopePredicate,
          ),
        )
        .orderBy(asc(accounts.sortOrder), asc(accounts.code), asc(assets.ticker));
    },
    loadPrices,
    loadFxRates: loadPortfolioRiskFxRates,
  };
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

export async function getReadOnlyTenantPortfolioRiskForScope({
  now,
  scope,
  tenantContext,
  window,
}: PreselectedPortfolioRiskReadOptions & {
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
}) {
  const readNow = now ?? new Date();
  const serviceDate = resolveSnapshotCycle(readNow).snapshotDate;
  return loadPreselectedPortfolioRiskReadModel(
    createTenantPortfolioRiskScopeRepository({
      scope,
      serviceDate,
      tenantContext,
    }),
    { now: readNow, window },
  );
}

function inArrayWhenPresent(
  column: typeof accounts.id,
  values: readonly string[],
): SQL | null;
function inArrayWhenPresent(
  column: typeof assets.id,
  values: readonly string[],
): SQL | null;
function inArrayWhenPresent(
  column: typeof accounts.id | typeof assets.id,
  values: readonly string[],
) {
  return values.length > 0 ? inArray(column, values) : null;
}

function combineScopePredicates(predicates: readonly (SQL | null)[]) {
  const available = predicates.filter(
    (predicate): predicate is SQL => predicate !== null,
  );
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];
  return or(...available) ?? null;
}
