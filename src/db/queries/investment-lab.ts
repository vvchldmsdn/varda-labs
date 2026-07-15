import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
} from "@/db/schema";
import {
  loadInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadRepository,
} from "@/lib/investment-lab-counterfactual-read-loader";
import type { InvestmentLabPeriodRequest } from "@/lib/investment-lab-period-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import { attachBase44ImportedTickerEvidence } from "@/lib/investment-lab-special-holding-authority";

const SNAPSHOT_ACCOUNTS = ["brokerage", "isa", "irp", "all"];

// Basic Auth currently protects one migration tenant. A future multi-user
// repository must add canonical owner predicates before this route is reused.
const drizzleInvestmentLabRepository: InvestmentLabCounterfactualReadRepository = {
  async loadEvents() {
    const rows = await db
      .select({
        eventDate: eventLedgerEntries.eventDate,
        eventType: eventLedgerEntries.eventType,
        amountKrw: eventLedgerEntries.amountKrw,
        quantityDelta: eventLedgerEntries.quantityDelta,
        price: eventLedgerEntries.price,
        fxRate: eventLedgerEntries.fxRate,
        assetCurrency: assets.currency,
        correctsEventId: eventLedgerEntries.correctsEventId,
        legacyCorrectsEventId: eventLedgerEntries.legacyCorrectsEventId,
      })
      .from(eventLedgerEntries)
      .leftJoin(assets, eq(eventLedgerEntries.assetId, assets.id))
      .where(eq(eventLedgerEntries.isSample, false))
      .orderBy(
        asc(eventLedgerEntries.eventDate),
        sql`${eventLedgerEntries.recordedAt} asc nulls last`,
        asc(eventLedgerEntries.createdAt),
        sql`${eventLedgerEntries.legacyBase44Id} asc nulls last`,
        asc(eventLedgerEntries.id),
      );

    return rows.map((row, index) => ({
      eventDate: row.eventDate,
      eventType: row.eventType,
      sequence: index + 1,
      amountKrw: row.amountKrw,
      quantityDelta: row.quantityDelta,
      price: row.price,
      fxRate: row.fxRate,
      assetCurrency: row.assetCurrency,
      isCorrection:
        row.correctsEventId !== null || row.legacyCorrectsEventId !== null,
    }));
  },

  async loadSnapshots() {
    return db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        account: dailyPortfolioSnapshots.account,
        cashValue: dailyPortfolioSnapshots.cashValue,
        totalMarketValue: dailyPortfolioSnapshots.totalMarketValue,
        usdKrw: dailyPortfolioSnapshots.usdKrw,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
      })
      .from(dailyPortfolioSnapshots)
      .where(
        and(
          eq(dailyPortfolioSnapshots.isSample, false),
          inArray(dailyPortfolioSnapshots.account, SNAPSHOT_ACCOUNTS),
        ),
      )
      .orderBy(
        asc(dailyPortfolioSnapshots.snapshotDate),
        asc(dailyPortfolioSnapshots.account),
      );
  },

  async loadScenarioCloses() {
    return loadScenarioCloseRows("069500", "korea", "KRW");
  },

  async loadVooCloses() {
    return loadScenarioCloseRows("VOO", "us", "USD");
  },

  async loadFxRows() {
    return db
      .select({
        rateDate: fxRates.rateDate,
        usdKrw: fxRates.usdKrw,
        source: fxRates.source,
        status: fxRates.status,
      })
      .from(fxRates)
      .where(eq(fxRates.isSample, false))
      .orderBy(asc(fxRates.rateDate));
  },

  async loadAnchorPositionRows(serviceDates) {
    if (serviceDates.length === 0) return [];
    const rows = await db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        account: dailyPositionSnapshots.account,
        source: dailyPositionSnapshots.source,
        ticker: dailyPositionSnapshots.ticker,
        assetName: dailyPositionSnapshots.assetName,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        assetType: dailyPositionSnapshots.assetType,
        quantity: dailyPositionSnapshots.quantity,
        marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        snapshotLegacyAssetId: dailyPositionSnapshots.legacyAssetId,
      })
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.isSample, false),
          inArray(dailyPositionSnapshots.account, [
            "brokerage",
            "isa",
            "irp",
          ]),
          inArray(dailyPositionSnapshots.snapshotDate, [...serviceDates]),
        ),
      )
      .orderBy(
        asc(dailyPositionSnapshots.snapshotDate),
        asc(dailyPositionSnapshots.account),
        asc(dailyPositionSnapshots.source),
        sql`${dailyPositionSnapshots.ticker} asc nulls last`,
      );

    return attachBase44ImportedTickerEvidence(
      rows.map(({ snapshotLegacyAssetId, ...row }) => ({
        ...row,
        identityKey: snapshotLegacyAssetId,
      })),
    ).map((row) => ({
      snapshotDate: row.snapshotDate,
      account: row.account,
      source: row.source,
      ticker: row.ticker,
      assetName: row.assetName,
      market: row.market,
      currency: row.currency,
      assetType: row.assetType,
      quantity: row.quantity,
      marketValueKrw: row.marketValueKrw,
      importedTickerEvidence: row.importedTickerEvidence,
    }));
  },

  async loadAnchorPriceRows({
    instruments,
    startServiceDate,
    endServiceDate,
  }) {
    const tickers = [...new Set(instruments.map((row) => row.ticker))];
    if (tickers.length === 0) return [];
    return db
      .select({
        ticker: assetPriceSnapshots.ticker,
        market: assetPriceSnapshots.market,
        currency: assetPriceSnapshots.currency,
        priceDate: assetPriceSnapshots.priceDate,
        closePrice: assetPriceSnapshots.closePrice,
        source: assetPriceSnapshots.source,
      })
      .from(assetPriceSnapshots)
      .where(
        and(
          eq(assetPriceSnapshots.isSample, false),
          inArray(
            sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
            tickers,
          ),
          gte(
            assetPriceSnapshots.priceDate,
            shiftIsoDate(startServiceDate, -10),
          ),
          lte(assetPriceSnapshots.priceDate, endServiceDate),
        ),
      )
      .orderBy(
        asc(assetPriceSnapshots.priceDate),
        asc(assetPriceSnapshots.ticker),
      );
  },
};

function loadScenarioCloseRows(
  ticker: string,
  market: string,
  currency: string,
) {
  return db
    .select({
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      source: assetPriceSnapshots.source,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        eq(assetPriceSnapshots.isSample, false),
        eq(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          ticker.toUpperCase(),
        ),
        eq(
          sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
          market.toLowerCase(),
        ),
        eq(
          sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
          currency.toUpperCase(),
        ),
      ),
    )
    .orderBy(asc(assetPriceSnapshots.priceDate));
}

export async function getReadOnlyInvestmentLabCounterfactual(
  request?: InvestmentLabPeriodRequest,
  fixedMixSelection?: InvestmentLabFixedMixSelection,
  requestedAnchorDate?: string | null,
) {
  return loadInvestmentLabCounterfactualReadModel(
    drizzleInvestmentLabRepository,
    request,
    fixedMixSelection,
    requestedAnchorDate,
  );
}

function shiftIsoDate(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
