import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  eventLedgerEntries,
} from "@/db/schema";
import {
  loadInvestmentLabCounterfactualReadModel,
  type InvestmentLabCounterfactualReadRepository,
} from "@/lib/investment-lab-counterfactual-read-loader";

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
        totalMarketValue: dailyPortfolioSnapshots.totalMarketValue,
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
    return db
      .select({
        priceDate: assetPriceSnapshots.priceDate,
        adjustedClosePrice: assetPriceSnapshots.adjustedClosePrice,
      })
      .from(assetPriceSnapshots)
      .where(
        and(
          eq(assetPriceSnapshots.isSample, false),
          eq(sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`, "069500"),
          eq(sql<string>`lower(trim(${assetPriceSnapshots.market}))`, "korea"),
          eq(sql<string>`upper(trim(${assetPriceSnapshots.currency}))`, "KRW"),
        ),
      )
      .orderBy(asc(assetPriceSnapshots.priceDate));
  },
};

export async function getReadOnlyInvestmentLabCounterfactual() {
  return loadInvestmentLabCounterfactualReadModel(
    drizzleInvestmentLabRepository,
  );
}
