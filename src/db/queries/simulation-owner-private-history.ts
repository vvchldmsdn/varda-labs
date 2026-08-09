import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetPriceSnapshots,
  fxRates,
} from "@/db/schema";
import { planSimulationPeriodPreflightScan } from "@/lib/simulation-period-preflight-plan";
import {
  buildPrivateOwnerRawHistory,
  resolveLatestCommonPrivateOwnerRawServiceDate,
  type PrivateOwnerRawHistoryInstrumentInput,
} from "@/lib/simulation-private-owner-raw-history";
import type { SimulationResearchUniverseSelection } from "@/lib/simulation-research-universe-preflight";
import type { TenantContext } from "@/lib/session-resolver-contract";

export { getActivePortfolioOwnerUserIds } from "./active-portfolio-owners";

export async function getLatestCommonPrivateOwnerRawServiceDate(options: {
  tenantContext: TenantContext;
  activeOwnerUserIds: readonly string[];
  selection: SimulationResearchUniverseSelection;
}) {
  if (options.selection.status !== "valid") return null;
  const instruments = toPrivateHistoryInstruments(options.selection);
  const modeled = instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  if (modeled.length === 0) return null;

  const normalizedMarket = sql<string>`lower(trim(${assetPriceSnapshots.market}))`;
  const normalizedCurrency = sql<string>`upper(trim(${assetPriceSnapshots.currency}))`;
  const normalizedTicker = sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`;
  const [latestSourceRows, latestFxRows] = await Promise.all([
    db
      .select({
        market: normalizedMarket,
        currency: normalizedCurrency,
        ticker: normalizedTicker,
        latestSourceDate: sql<string | null>`max(${assetPriceSnapshots.priceDate})`,
        providerBindingCount: sql<number>`count(distinct (upper(trim(${assetPriceSnapshots.providerSymbol})) || '|' || upper(trim(${assetPriceSnapshots.providerExchange}))))`,
      })
      .from(assetPriceSnapshots)
      .where(
        and(
          inArray(
            normalizedTicker,
            [...new Set(modeled.map((row) => row.ticker))],
          ),
          eq(assetPriceSnapshots.isSample, false),
          sql`${assetPriceSnapshots.closePrice} > 0`,
          sql`lower(trim(${assetPriceSnapshots.source})) like 'kis%'`,
          sql`nullif(trim(${assetPriceSnapshots.providerSymbol}), '') is not null`,
          sql`nullif(trim(${assetPriceSnapshots.providerExchange}), '') is not null`,
          isNotNull(assetPriceSnapshots.fetchedAt),
        ),
      )
      .groupBy(normalizedMarket, normalizedCurrency, normalizedTicker),
    modeled.some((row) => row.currency === "USD")
      ? db
          .select({
            latestSourceDate: sql<string | null>`max(${fxRates.rateDate})`,
          })
          .from(fxRates)
          .where(
            and(
              eq(fxRates.isSample, false),
              eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
              sql`${fxRates.usdKrw} > 0`,
            ),
          )
      : Promise.resolve([{ latestSourceDate: null }]),
  ]);

  return resolveLatestCommonPrivateOwnerRawServiceDate({
    requestedOwnerUserId: options.tenantContext.ownerUserId,
    activeOwnerUserIds: options.activeOwnerUserIds,
    instruments,
    latestSourceRows,
    latestFxSourceDate: latestFxRows[0]?.latestSourceDate ?? null,
  });
}

export async function getReadOnlyPrivateOwnerRawHistoryBundle(options: {
  tenantContext: TenantContext;
  activeOwnerUserIds: readonly string[];
  selection: SimulationResearchUniverseSelection;
  endServiceDate: string;
}) {
  const instruments =
    options.selection.status === "valid"
      ? toPrivateHistoryInstruments(options.selection)
      : [];
  const candidates = instruments
    .filter(
      (row) =>
        row.weightBps > 0 && row.classification === "listed_instrument",
    )
    .map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
    }));
  const request = {
    candidates,
    endServiceDate: options.endServiceDate,
    returnStepCount: 90,
  };
  const plan = planSimulationPeriodPreflightScan(request);
  if (plan.status !== "queryable" || !plan.queryRange) {
    return buildPrivateOwnerRawHistory({
      requestedOwnerUserId: options.tenantContext.ownerUserId,
      activeOwnerUserIds: options.activeOwnerUserIds,
      requestedEndServiceDate: options.endServiceDate,
      instruments,
      priceRows: [],
      fxRows: [],
    });
  }

  const tickers = [...new Set(candidates.map((row) => row.ticker))];
  const [priceRows, fxRows] = await Promise.all([
    loadRawPriceRows({
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

  return buildPrivateOwnerRawHistory({
    requestedOwnerUserId: options.tenantContext.ownerUserId,
    activeOwnerUserIds: options.activeOwnerUserIds,
    requestedEndServiceDate: options.endServiceDate,
    instruments,
    priceRows,
    fxRows,
  });
}

async function loadRawPriceRows(input: {
  tickers: readonly string[];
  sourceDateFrom: string;
  sourceDateTo: string;
}) {
  if (input.tickers.length === 0) return [];

  return db
    .select({
      market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
      currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
      ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      source: assetPriceSnapshots.source,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
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
}) {
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

function toPrivateHistoryInstruments(
  selection: Extract<SimulationResearchUniverseSelection, { status: "valid" }>,
): PrivateOwnerRawHistoryInstrumentInput[] {
  return selection.instruments.map((row) => ({
    instrumentKey: row.instrumentKey,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    classification: row.classification,
    weightBps: row.weightBps,
  }));
}
