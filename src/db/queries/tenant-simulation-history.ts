import "server-only";
import {findVerifiedHistoricalWindow} from "@/lib/shared-domain/simulation-verified-window";
import { and, asc, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import { planSimulationPeriodPreflightScan } from "@/lib/shared-domain/simulation-period-preflight-plan";
import { isRiskDate } from "@/lib/portfolio-risk-calendar";
import type { SimulationResearchUniverseSelection } from "@/lib/simulation-research-universe-preflight";
import {
  buildPrivateOwnerRawHistory,
  resolveLatestCommonPrivateOwnerRawServiceDate,
  type PrivateOwnerRawHistoryInstrumentInput,
} from "@/lib/shared-domain/simulation-private-owner-raw-history";

// Limited read-port reuse of simulation-owner-private-history.ts from the preserved
// beta baseline. Session -> owned scope -> portfolio -> candidate selection must
// already be established by the server caller. These rows are shared instrument
// market evidence, never another owner's portfolio. This port does not resolve
// owners, broaden scope, fetch providers, backfill, register or save executions.
function selectedInstruments(selection: SimulationResearchUniverseSelection): PrivateOwnerRawHistoryInstrumentInput[] {
  return selection.status === "valid" ? selection.instruments.map(row => ({
    instrumentKey: row.instrumentKey, market: row.market, currency: row.currency,
    ticker: row.ticker, classification: row.classification, weightBps: row.weightBps,
  })) : [];
}
function modeledInstruments(instruments: readonly PrivateOwnerRawHistoryInstrumentInput[]) {
  return instruments.filter(row => row.weightBps > 0 && row.classification === "listed_instrument");
}
function identityPredicate(instruments: readonly PrivateOwnerRawHistoryInstrumentInput[]) {
  // Exact market/currency/ticker tuples prevent a same-symbol foreign listing
  // from entering even the server-side source set. The model checks again.
  return or(...instruments.map(row => and(
    eq(sql<string>`lower(trim(${assetPriceSnapshots.market}))`, row.market.trim().toLowerCase()),
    eq(sql<string>`upper(trim(${assetPriceSnapshots.currency}))`, row.currency),
    eq(sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`, row.ticker.trim().toUpperCase()),
  )));
}

export async function getLatestCommonTenantRawServiceDate({selection}: {
  selection: SimulationResearchUniverseSelection;
}): Promise<string | null> {
  const instruments = selectedInstruments(selection), modeled = modeledInstruments(instruments);
  if (!modeled.length) return null;
  const normalizedMarket = sql<string>`lower(trim(${assetPriceSnapshots.market}))`;
  const normalizedCurrency = sql<string>`upper(trim(${assetPriceSnapshots.currency}))`;
  const normalizedTicker = sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`;
  const [latestSourceRows, latestFxRows] = await Promise.all([
    db.select({
      market: normalizedMarket, currency: normalizedCurrency, ticker: normalizedTicker,
      latestSourceDate: sql<string | null>`max(${assetPriceSnapshots.priceDate}) filter (where
        ${assetPriceSnapshots.adjustedClosePrice} > 0
        and ${assetPriceSnapshots.adjustedCloseBasis}='provider_adjusted_close_v1'
        and ${assetPriceSnapshots.adjustedCloseProvider}='kis'
        and right(${assetPriceSnapshots.adjustedCloseSource},12)=':adjusted_v1'
        and ${assetPriceSnapshots.adjustedCloseFetchedAt} is not null
        and (lower(trim(${assetPriceSnapshots.market})) <> 'us' or
          ${assetPriceSnapshots.priceDate} < (${assetPriceSnapshots.adjustedCloseFetchedAt} at time zone 'America/New_York')::date))`,
      providerBindingCount: sql<number>`count(distinct (upper(trim(${assetPriceSnapshots.providerSymbol})) || '|' || upper(trim(${assetPriceSnapshots.providerExchange}))))`,
    }).from(assetPriceSnapshots).where(and(
      identityPredicate(modeled), eq(assetPriceSnapshots.isSample, false),
      sql`${assetPriceSnapshots.closePrice} > 0`,
      sql`lower(trim(${assetPriceSnapshots.source})) ~ '^kis($|[_:])'`,
      sql`nullif(trim(${assetPriceSnapshots.providerSymbol}), '') is not null`,
      sql`nullif(trim(${assetPriceSnapshots.providerExchange}), '') is not null`,
      isNotNull(assetPriceSnapshots.fetchedAt),
    )).groupBy(normalizedMarket, normalizedCurrency, normalizedTicker),
    modeled.some(row => row.currency === "USD")
      ? db.select({ latestSourceDate: sql<string | null>`max(${fxRates.rateDate})` }).from(fxRates).where(and(
          eq(fxRates.isSample, false), eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"), sql`${fxRates.usdKrw} > 0`,
        ))
      : Promise.resolve([{latestSourceDate: null}]),
  ]);
  return resolveLatestCommonPrivateOwnerRawServiceDate({
    instruments, latestSourceRows, latestFxSourceDate: latestFxRows[0]?.latestSourceDate ?? null,
  });
}

export async function getReadOnlyTenantRawHistory({selection, endServiceDate, returnStepCount = 90}: {
  selection: SimulationResearchUniverseSelection;
  endServiceDate: string;
  returnStepCount?: number;
}) {
  const instruments = selectedInstruments(selection), modeled = modeledInstruments(instruments);
  const plan = planSimulationPeriodPreflightScan({
    candidates: modeled.map(row => ({market: row.market, currency: row.currency, ticker: row.ticker})),
    endServiceDate, returnStepCount,
  });
  // An explicit missing/invalid day never switches to latest or expands the scan.
  if (!modeled.length || !isRiskDate(endServiceDate) || plan.status !== "queryable" || !plan.queryRange) {
    return buildPrivateOwnerRawHistory({requireAdjusted:true,sourceDateFrom:plan.queryRange?.sourceDateFrom,requestedEndServiceDate:endServiceDate,returnStepCount,instruments,priceRows:[],fxRows:[]});
  }
  const {sourceDateFrom, sourceDateTo} = plan.queryRange;
  const [priceRows, fxRows] = await Promise.all([
    db.select({
      market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
      currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
      ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
      priceDate: assetPriceSnapshots.priceDate, closePrice: assetPriceSnapshots.closePrice,
      adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      adjustedCloseBasis: assetPriceSnapshots.adjustedCloseBasis,
      adjustedCloseProvider: assetPriceSnapshots.adjustedCloseProvider,
      adjustedCloseSource: assetPriceSnapshots.adjustedCloseSource,
      adjustedCloseFetchedAt: assetPriceSnapshots.adjustedCloseFetchedAt,
      source: assetPriceSnapshots.source, providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange, fetchedAt: assetPriceSnapshots.fetchedAt,
    }).from(assetPriceSnapshots).where(and(
      identityPredicate(modeled), gte(assetPriceSnapshots.priceDate,sourceDateFrom),
      lte(assetPriceSnapshots.priceDate,sourceDateTo), eq(assetPriceSnapshots.isSample,false),
    )).orderBy(asc(assetPriceSnapshots.priceDate),asc(assetPriceSnapshots.market),asc(assetPriceSnapshots.currency),asc(assetPriceSnapshots.ticker)),
    plan.requiresFx ? db.select({
      rateDate: fxRates.rateDate, usdKrw: fxRates.usdKrw,
      status: sql<string>`lower(trim(${fxRates.status}))`,
    }).from(fxRates).where(and(
      gte(fxRates.rateDate,sourceDateFrom),lte(fxRates.rateDate,sourceDateTo),
      eq(fxRates.isSample,false),eq(sql<string>`lower(trim(${fxRates.status}))`,"ok"),
    )).orderBy(asc(fxRates.rateDate)) : Promise.resolve([]),
  ]);
  const input={requireAdjusted:true,sourceDateFrom,requestedEndServiceDate:endServiceDate,returnStepCount,instruments,priceRows,fxRows};
  const result=buildPrivateOwnerRawHistory(input);
  return {...result,verifiedEndServiceDate:result.status==='ready'?null:findVerifiedHistoricalWindow(input)};
}
