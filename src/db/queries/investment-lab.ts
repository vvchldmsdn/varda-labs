import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

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
import type { InvestmentLabFountRuntimeEvidence } from "@/lib/investment-lab-fount-runtime-scope";
import {
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS,
  attachBase44ImportedTickerEvidence,
} from "@/lib/investment-lab-special-holding-authority";
import type { PortfolioAccountScope } from "@/lib/portfolio-account-scope";
import {
  buildInvestmentLabHistoricalAccountConsensus,
  resolveInvestmentLabEventAccount,
} from "@/lib/investment-lab-event-account";

const SNAPSHOT_ACCOUNTS = ["brokerage", "isa", "irp", "all"];
const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;
type InvestmentLabFountRuntimePositionRow = Extract<
  InvestmentLabFountRuntimeEvidence,
  { status: "ready" }
>["positionRows"][number];

// Basic Auth currently protects one migration tenant. A future multi-user
// repository must add canonical owner predicates before this route is reused.
const drizzleInvestmentLabRepository: InvestmentLabCounterfactualReadRepository = {
  async loadEvents() {
    const [rows, historicalPositionRows] = await Promise.all([
      db
        .select({
          account: eventLedgerEntries.account,
          beforeValue: eventLedgerEntries.beforeValue,
          afterValue: eventLedgerEntries.afterValue,
          legacyAssetId: eventLedgerEntries.legacyAssetId,
          assetName: eventLedgerEntries.assetName,
          assetAccount: assets.account,
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
        ),
      db
        .select({
          legacyAssetId: dailyPositionSnapshots.legacyAssetId,
          account: dailyPositionSnapshots.account,
        })
        .from(dailyPositionSnapshots)
        .where(
          and(
            eq(dailyPositionSnapshots.isSample, false),
            isNotNull(dailyPositionSnapshots.legacyAssetId),
          ),
        )
        .groupBy(
          dailyPositionSnapshots.legacyAssetId,
          dailyPositionSnapshots.account,
        ),
    ]);
    const historicalConsensus =
      buildInvestmentLabHistoricalAccountConsensus(historicalPositionRows);

    return rows.map((row, index) => {
      const account = resolveInvestmentLabEventAccount(
        row,
        historicalConsensus,
      ).account;
      return {
        legacyAssetId: row.legacyAssetId,
        account,
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
      };
    });
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

  async loadFountRuntimeEvidence(serviceDates) {
    const decision =
      DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
    const candidates = await db
      .select({ legacyAssetId: dailyPositionSnapshots.legacyAssetId })
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.isSample, false),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.assetName}))`,
            decision.assetName.toLowerCase(),
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.account}))`,
            decision.account,
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.market}))`,
            decision.market,
          ),
          eq(
            sql<string>`upper(trim(${dailyPositionSnapshots.currency}))`,
            decision.currency,
          ),
          eq(
            sql<string>`lower(trim(coalesce(${dailyPositionSnapshots.assetType}, '')))`,
            decision.assetType,
          ),
        ),
      )
      .groupBy(dailyPositionSnapshots.legacyAssetId);
    if (candidates.length === 0) return { status: "not_applicable" } as const;
    if (candidates.length !== 1) {
      return { status: "unavailable", reason: "binding_ambiguous" } as const;
    }

    const legacyAssetId = candidates[0].legacyAssetId;
    if (!LEGACY_ID_PATTERN.test(legacyAssetId)) {
      return { status: "unavailable", reason: "binding_invalid" } as const;
    }
    const [positionRows, bindingEventRows] = await Promise.all([
      db
        .select({
          snapshotDate: dailyPositionSnapshots.snapshotDate,
          account: dailyPositionSnapshots.account,
          source: dailyPositionSnapshots.source,
          legacyAssetId: dailyPositionSnapshots.legacyAssetId,
          assetName: dailyPositionSnapshots.assetName,
          market: dailyPositionSnapshots.market,
          currency: dailyPositionSnapshots.currency,
          assetType: dailyPositionSnapshots.assetType,
          marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        })
        .from(dailyPositionSnapshots)
        .where(
          and(
            eq(dailyPositionSnapshots.isSample, false),
            eq(dailyPositionSnapshots.legacyAssetId, legacyAssetId),
          ),
        )
        .orderBy(asc(dailyPositionSnapshots.snapshotDate)),
      db
        .select({
          legacyAssetId: eventLedgerEntries.legacyAssetId,
          account: eventLedgerEntries.account,
          assetName: eventLedgerEntries.assetName,
        })
        .from(eventLedgerEntries)
        .where(
          and(
            eq(eventLedgerEntries.isSample, false),
            eq(eventLedgerEntries.legacyAssetId, legacyAssetId),
          ),
        ),
    ]);
    const metadataConflict =
      positionRows.length === 0 ||
      positionRows.some(
        (row) =>
          row.legacyAssetId !== legacyAssetId ||
          normalizeText(row.assetName) !== normalizeText(decision.assetName) ||
          normalizeText(row.account) !== decision.account ||
          normalizeText(row.market) !== decision.market ||
          normalizeUpper(row.currency) !== decision.currency ||
          normalizeText(row.assetType) !== decision.assetType ||
          normalizeText(row.source) === "",
      ) ||
      bindingEventRows.some(
        (row) =>
          row.legacyAssetId !== legacyAssetId ||
          normalizeText(row.account) !== decision.account ||
          normalizeText(row.assetName) !== normalizeText(decision.assetName),
      );
    if (metadataConflict) {
      return {
        status: "unavailable",
        reason: "binding_metadata_conflict",
      } as const;
    }

    const serviceDateSet = new Set(serviceDates);
    const scopedPositionRows: InvestmentLabFountRuntimePositionRow[] = [];
    for (const row of positionRows) {
      if (!serviceDateSet.has(row.snapshotDate)) continue;
      if (row.marketValueKrw === null) {
        return {
          status: "unavailable",
          reason: "position_value_missing",
        } as const;
      }
      scopedPositionRows.push({
        snapshotDate: row.snapshotDate,
        account: row.account,
        source: row.source,
        snapshotLegacyAssetId: row.legacyAssetId,
        marketValueKrw: row.marketValueKrw,
      });
    }

    return {
      status: "ready",
      binding: {
        selectorBasis: "exact_snapshot_legacy_asset_id",
        snapshotLegacyAssetId: legacyAssetId,
        account: decision.account,
      },
      positionRows: scopedPositionRows,
    } as const;
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
  account: PortfolioAccountScope = "all",
) {
  return loadInvestmentLabCounterfactualReadModel(
    drizzleInvestmentLabRepository,
    request,
    fixedMixSelection,
    requestedAnchorDate,
    account,
  );
}

function shiftIsoDate(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUpper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
