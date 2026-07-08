import "server-only";

import { asc } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accountBalanceSnapshots,
  dailyPortfolioSnapshots,
} from "@/db/schema";
import {
  buildPortfolioHistoryDisplayRows,
  type HistoryAccount,
  type HistoryLane,
  type PortfolioHistoryDisplayRow,
  type PortfolioHistoryRawRow,
} from "@/lib/history-balance";

export type ReadOnlyBalanceHistoryRow = {
  id: string;
  date: string;
  cash: string | null;
  brokerage: string | null;
  isa: string | null;
  irp: string | null;
  legacyBase44Id: string | null;
};

export type ReadOnlyHistoryBalance = {
  account: HistoryAccount;
  lane: HistoryLane;
  balanceRows: ReadOnlyBalanceHistoryRow[];
  portfolioRows: PortfolioHistoryDisplayRow[];
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
}: {
  account: HistoryAccount;
  lane: HistoryLane;
}): Promise<ReadOnlyHistoryBalance> {
  const [balanceRows, portfolioRawRows] = await Promise.all([
    loadBalanceRows(),
    loadPortfolioRows(),
  ]);
  const portfolioRows = buildPortfolioHistoryDisplayRows({
    rows: portfolioRawRows,
    account,
  });
  const visibleBalanceRows =
    lane === "portfolio" ? [] : [...balanceRows].sort(compareBalanceRowsDesc);
  const visiblePortfolioRows = lane === "balance" ? [] : portfolioRows;

  return {
    account,
    lane,
    balanceRows: visibleBalanceRows,
    portfolioRows: visiblePortfolioRows,
    summary: {
      balanceRowCount: balanceRows.length,
      portfolioRowCount: portfolioRows.length,
      derivedPortfolioRowCount: portfolioRows.filter(
        (row) => row.rowKind === "derived",
      ).length,
      balanceDateRange: summarizeDateRange(balanceRows, (row) => row.date),
      portfolioDateRange: summarizeDateRange(
        portfolioRows,
        (row) => row.snapshotDate,
      ),
      overlappingDateCount: countOverlappingDates(
        balanceRows.map((row) => row.date),
        portfolioRows.map((row) => row.snapshotDate),
      ),
    },
  };
}

async function loadBalanceRows(): Promise<ReadOnlyBalanceHistoryRow[]> {
  return db
    .select({
      id: accountBalanceSnapshots.id,
      date: accountBalanceSnapshots.balanceDate,
      cash: accountBalanceSnapshots.cash,
      brokerage: accountBalanceSnapshots.brokerage,
      isa: accountBalanceSnapshots.isa,
      irp: accountBalanceSnapshots.irp,
      legacyBase44Id: accountBalanceSnapshots.legacyBase44Id,
    })
    .from(accountBalanceSnapshots)
    .orderBy(asc(accountBalanceSnapshots.balanceDate));
}

async function loadPortfolioRows(): Promise<PortfolioHistoryRawRow[]> {
  return db
    .select({
      id: dailyPortfolioSnapshots.id,
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
  return right.date.localeCompare(left.date);
}
