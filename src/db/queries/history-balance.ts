import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accountBalanceSnapshots,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
} from "@/db/schema";
import {
  buildPortfolioHistoryDisplayRows,
  type HistoryAccount,
  type HistoryLane,
  type PortfolioHistoryDisplayRow,
  type PortfolioHistoryRawRow,
} from "@/lib/history-balance";
import {
  buildHistoryPositionDetail,
  HISTORY_POSITION_DETAIL_QUERY_LIMIT,
  type HistoryPositionDetailModel,
  type HistoryPositionRawRow,
  type HistoryPositionSelection,
} from "@/lib/history-position-detail";
import {
  buildHistoryEventTimeline,
  HISTORY_EVENT_QUERY_LIMIT,
  shouldLoadHistoryEvents,
  type HistoryEventRawRow,
  type HistoryEventTimelineModel,
} from "@/lib/history-event-timeline";

export type ReadOnlyBalanceHistoryRow = {
  balanceDate: string;
  cash: string | null;
  brokerage: string | null;
  isa: string | null;
  irp: string | null;
};

export type ReadOnlyHistoryBalance = {
  account: HistoryAccount;
  lane: HistoryLane;
  balanceRows: ReadOnlyBalanceHistoryRow[];
  portfolioRows: PortfolioHistoryDisplayRow[];
  positionDetail: HistoryPositionDetailModel;
  eventTimeline: HistoryEventTimelineModel;
  summary: {
    balanceRowCount: number;
    portfolioRowCount: number;
    derivedPortfolioRowCount: number;
    balanceDateRange: DateRangeSummary;
    portfolioDateRange: DateRangeSummary;
    overlappingDateCount: number;
  };
};

export type DateRangeSummary = {
  minDate: string | null;
  maxDate: string | null;
};

export async function getReadOnlyHistoryBalance({
  account,
  lane,
  positionSelection,
}: {
  account: HistoryAccount;
  lane: HistoryLane;
  positionSelection: HistoryPositionSelection;
}): Promise<ReadOnlyHistoryBalance> {
  const [balanceRows, portfolioRawRows, positionRows, eventRows] =
    await Promise.all([
      lane === "events" ? Promise.resolve([]) : loadBalanceRows(),
      lane === "events" ? Promise.resolve([]) : loadPortfolioRows(),
      positionSelection.status === "requested"
        ? loadPositionRows(positionSelection)
        : Promise.resolve([]),
      shouldLoadHistoryEvents(account, lane) && account !== "all"
        ? loadEventRows(account)
        : Promise.resolve([]),
    ]);
  const portfolioRows = buildPortfolioHistoryDisplayRows({
    rows: portfolioRawRows,
    account,
  });
  const visibleBalanceRows =
    lane === "all" || lane === "balance"
      ? [...balanceRows].sort(compareBalanceRowsDesc)
      : [];
  const visiblePortfolioRows =
    lane === "all" || lane === "portfolio" ? portfolioRows : [];
  const positionDetail = buildHistoryPositionDetail({
    account,
    lane,
    selection: positionSelection,
    portfolioRows,
    positionRows,
  });
  const eventTimeline = buildHistoryEventTimeline({
    account,
    lane,
    eventRows,
  });

  return {
    account,
    lane,
    balanceRows: visibleBalanceRows,
    portfolioRows: visiblePortfolioRows,
    positionDetail,
    eventTimeline,
    summary: {
      balanceRowCount: balanceRows.length,
      portfolioRowCount: portfolioRows.length,
      derivedPortfolioRowCount: portfolioRows.filter(
        (row) => row.rowKind === "derived",
      ).length,
      balanceDateRange: summarizeDateRange(
        balanceRows,
        (row) => row.balanceDate,
      ),
      portfolioDateRange: summarizeDateRange(
        portfolioRows,
        (row) => row.snapshotDate,
      ),
      overlappingDateCount: countOverlappingDates(
        balanceRows.map((row) => row.balanceDate),
        portfolioRows.map((row) => row.snapshotDate),
      ),
    },
  };
}

async function loadEventRows(
  account: Exclude<HistoryAccount, "all">,
): Promise<HistoryEventRawRow[]> {
  return db
    .select({
      internalId: eventLedgerEntries.id,
      legacyBase44Id: eventLedgerEntries.legacyBase44Id,
      eventDate: eventLedgerEntries.eventDate,
      eventType: eventLedgerEntries.eventType,
      source: eventLedgerEntries.source,
      recordedAt: eventLedgerEntries.recordedAt,
      ruleVersion: eventLedgerEntries.ruleVersion,
      account: eventLedgerEntries.account,
      assetId: eventLedgerEntries.assetId,
      legacyAssetId: eventLedgerEntries.legacyAssetId,
      ticker: eventLedgerEntries.ticker,
      assetName: eventLedgerEntries.assetName,
      groupName: eventLedgerEntries.groupName,
      correctsEventId: eventLedgerEntries.correctsEventId,
      legacyCorrectsEventId: eventLedgerEntries.legacyCorrectsEventId,
      amountKrw: eventLedgerEntries.amountKrw,
      quantityDelta: eventLedgerEntries.quantityDelta,
      price: eventLedgerEntries.price,
      fxRate: eventLedgerEntries.fxRate,
    })
    .from(eventLedgerEntries)
    .where(
      and(
        eq(eventLedgerEntries.account, account),
        eq(eventLedgerEntries.isSample, false),
      ),
    )
    .orderBy(
      desc(eventLedgerEntries.eventDate),
      sql`${eventLedgerEntries.recordedAt} desc nulls last`,
      desc(eventLedgerEntries.createdAt),
      asc(eventLedgerEntries.legacyBase44Id),
      asc(eventLedgerEntries.id),
    )
    .limit(HISTORY_EVENT_QUERY_LIMIT);
}

async function loadPositionRows(
  selection: Extract<HistoryPositionSelection, { status: "requested" }>,
): Promise<HistoryPositionRawRow[]> {
  return db
    .select({
      snapshotDate: dailyPositionSnapshots.snapshotDate,
      account: dailyPositionSnapshots.account,
      source: dailyPositionSnapshots.source,
      assetId: dailyPositionSnapshots.assetId,
      legacyAssetId: dailyPositionSnapshots.legacyAssetId,
      ticker: dailyPositionSnapshots.ticker,
      assetName: dailyPositionSnapshots.assetName,
      market: dailyPositionSnapshots.market,
      currency: dailyPositionSnapshots.currency,
      quantity: dailyPositionSnapshots.quantity,
      currentPrice: dailyPositionSnapshots.currentPrice,
      marketValueLocal: dailyPositionSnapshots.marketValueLocal,
      marketValueKrw: dailyPositionSnapshots.marketValueKrw,
      costKrw: dailyPositionSnapshots.costKrw,
      pnlKrw: dailyPositionSnapshots.pnlKrw,
      pnlPct: dailyPositionSnapshots.pnlPct,
      currentWeight: dailyPositionSnapshots.currentWeight,
      fxRate: dailyPositionSnapshots.fxRate,
      priceSource: dailyPositionSnapshots.priceSource,
      priceBasis: dailyPositionSnapshots.priceBasis,
    })
    .from(dailyPositionSnapshots)
    .where(
      and(
        eq(dailyPositionSnapshots.snapshotDate, selection.snapshotDate),
        eq(dailyPositionSnapshots.account, selection.account),
        eq(dailyPositionSnapshots.source, selection.source),
        eq(dailyPositionSnapshots.isSample, false),
      ),
    )
    .orderBy(
      desc(dailyPositionSnapshots.marketValueKrw),
      asc(dailyPositionSnapshots.assetName),
      asc(dailyPositionSnapshots.legacyAssetId),
    )
    .limit(HISTORY_POSITION_DETAIL_QUERY_LIMIT);
}

async function loadBalanceRows(): Promise<ReadOnlyBalanceHistoryRow[]> {
  return db
    .select({
      balanceDate: accountBalanceSnapshots.balanceDate,
      cash: accountBalanceSnapshots.cash,
      brokerage: accountBalanceSnapshots.brokerage,
      isa: accountBalanceSnapshots.isa,
      irp: accountBalanceSnapshots.irp,
    })
    .from(accountBalanceSnapshots)
    .orderBy(asc(accountBalanceSnapshots.balanceDate));
}

async function loadPortfolioRows(): Promise<PortfolioHistoryRawRow[]> {
  return db
    .select({
      snapshotDate: dailyPortfolioSnapshots.snapshotDate,
      account: dailyPortfolioSnapshots.account,
      source: dailyPortfolioSnapshots.source,
      cashValue: dailyPortfolioSnapshots.cashValue,
      investedAmount: dailyPortfolioSnapshots.investedAmount,
      totalCost: dailyPortfolioSnapshots.totalCost,
      totalMarketValue: dailyPortfolioSnapshots.totalMarketValue,
      totalPnl: dailyPortfolioSnapshots.totalPnl,
      totalReturnPct: dailyPortfolioSnapshots.totalReturnPct,
    })
    .from(dailyPortfolioSnapshots)
    .orderBy(
      asc(dailyPortfolioSnapshots.snapshotDate),
      asc(dailyPortfolioSnapshots.account),
      asc(dailyPortfolioSnapshots.source),
    );
}

function summarizeDateRange<T>(
  rows: T[],
  dateSelector: (row: T) => string | null,
): DateRangeSummary {
  const dates = rows
    .map(dateSelector)
    .filter((date): date is string => Boolean(date))
    .sort();

  return {
    minDate: dates[0] ?? null,
    maxDate: dates.at(-1) ?? null,
  };
}

function countOverlappingDates(leftDates: string[], rightDates: string[]) {
  const right = new Set(rightDates);
  return new Set(leftDates.filter((date) => right.has(date))).size;
}

function compareBalanceRowsDesc(
  left: ReadOnlyBalanceHistoryRow,
  right: ReadOnlyBalanceHistoryRow,
) {
  return right.balanceDate.localeCompare(left.balanceDate);
}
