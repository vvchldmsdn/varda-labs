import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accountBalanceSnapshots,
  accounts,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
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
  buildHistoryPositionComparison,
  HISTORY_POSITION_COMPARISON_QUERY_LIMIT,
  type HistoryPositionComparisonModel,
  type HistoryPositionComparisonRawRow,
  type HistoryPositionComparisonSelection,
} from "@/lib/history-position-comparison";
import { NAMED_PORTFOLIO_ACCOUNTS } from "@/lib/portfolio-account-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type ReadOnlyBalanceHistoryRow = {
  balanceDate: string;
  cash: string | null;
  brokerage: string | null;
  isa: string | null;
  irp: string | null;
};

export type HistoryReadSource =
  | "balance"
  | "portfolio"
  | "position_detail"
  | "position_comparison";

export type ReadOnlyHistoryBalance = {
  account: HistoryAccount;
  lane: HistoryLane;
  readStatus: "ready" | "partial" | "unavailable";
  unavailableSources: readonly HistoryReadSource[];
  balanceRows: ReadOnlyBalanceHistoryRow[];
  portfolioRows: PortfolioHistoryDisplayRow[];
  positionDetail: HistoryPositionDetailModel;
  positionComparison: HistoryPositionComparisonModel;
  summary: {
    balanceRowCount: number;
    portfolioRowCount: number;
    derivedPortfolioRowCount: number;
    partialPortfolioRowCount: number;
    balanceDateRange: DateRangeSummary;
    portfolioDateRange: DateRangeSummary;
    overlappingDateCount: number;
  };
};

export type DateRangeSummary = {
  minDate: string | null;
  maxDate: string | null;
};

type LoadResult<T> =
  | Readonly<{ state: "not_requested" }>
  | Readonly<{ state: "ready"; value: T }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantHistoryBalance({
  tenantContext,
  account,
  lane,
  positionSelection,
  positionComparisonSelection,
}: {
  tenantContext: TenantContext;
  account: HistoryAccount;
  lane: HistoryLane;
  positionSelection: HistoryPositionSelection;
  positionComparisonSelection: HistoryPositionComparisonSelection;
}): Promise<ReadOnlyHistoryBalance> {
  const [balanceResult, portfolioResult, positionResult, comparisonResult] =
    await Promise.all([
      captureLoad(lane === "all" || lane === "balance", () =>
        loadBalanceRows(tenantContext),
      ),
      captureLoad(lane === "all" || lane === "portfolio", () =>
        loadPortfolioRows(tenantContext, account),
      ),
      positionSelection.status === "requested"
        ? captureLoad(true, () =>
            loadPositionRows(tenantContext, positionSelection),
          )
        : Promise.resolve(Object.freeze({ state: "not_requested" } as const)),
      positionComparisonSelection.status === "requested"
        ? captureLoad(true, () =>
            loadPositionComparisonRows(
              tenantContext,
              positionComparisonSelection,
            ),
          )
        : Promise.resolve(Object.freeze({ state: "not_requested" } as const)),
    ]);

  const balanceRows = loadedValue(balanceResult, []);
  const portfolioRawRows = loadedValue(portfolioResult, []);
  const positionRows = loadedValue(positionResult, []);
  const positionComparisonRows = loadedValue(comparisonResult, {
    fromRows: [],
    toRows: [],
  });
  const portfolioRows = buildPortfolioHistoryDisplayRows({
    rows: portfolioRawRows,
    account,
  });
  const visibleBalanceRows = [...balanceRows].sort(compareBalanceRowsDesc);
  const positionDetail = buildHistoryPositionDetail({
    account,
    lane,
    selection: positionSelection,
    portfolioRows,
    positionRows,
  });
  const positionComparison = buildHistoryPositionComparison({
    account,
    lane,
    selection: positionComparisonSelection,
    portfolioRows,
    fromRows: positionComparisonRows.fromRows,
    toRows: positionComparisonRows.toRows,
  });
  const sourceResults = [
    ["balance", balanceResult],
    ["portfolio", portfolioResult],
    ["position_detail", positionResult],
    ["position_comparison", comparisonResult],
  ] as const;
  const requestedSourceCount = sourceResults.filter(
    ([, result]) => result.state !== "not_requested",
  ).length;
  const unavailableSources = sourceResults
    .filter(([, result]) => result.state === "unavailable")
    .map(([source]) => source);

  return {
    account,
    lane,
    readStatus:
      unavailableSources.length === 0
        ? "ready"
        : unavailableSources.length === requestedSourceCount
          ? "unavailable"
          : "partial",
    unavailableSources: Object.freeze(unavailableSources),
    balanceRows: visibleBalanceRows,
    portfolioRows,
    positionDetail,
    positionComparison,
    summary: {
      balanceRowCount: balanceRows.length,
      portfolioRowCount: portfolioRows.length,
      derivedPortfolioRowCount: portfolioRows.filter(
        (row) => row.rowKind === "derived",
      ).length,
      partialPortfolioRowCount: portfolioRows.filter(
        (row) => row.rowKind === "partial",
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

async function loadPositionComparisonRows(
  tenantContext: TenantContext,
  selection: Extract<
    HistoryPositionComparisonSelection,
    { status: "requested" }
  >,
) {
  const [fromRows, toRows] = await Promise.all([
    loadPositionComparisonEndpointRows({
      tenantContext,
      account: selection.account,
      snapshotDate: selection.from.snapshotDate,
      source: selection.from.source,
    }),
    loadPositionComparisonEndpointRows({
      tenantContext,
      account: selection.account,
      snapshotDate: selection.to.snapshotDate,
      source: selection.to.source,
    }),
  ]);
  return { fromRows, toRows };
}

async function loadPositionComparisonEndpointRows({
  tenantContext,
  account,
  snapshotDate,
  source,
}: {
  tenantContext: TenantContext;
  account: Exclude<HistoryAccount, "all">;
  snapshotDate: string;
  source: string;
}): Promise<HistoryPositionComparisonRawRow[]> {
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
      marketValueKrw: dailyPositionSnapshots.marketValueKrw,
    })
    .from(dailyPositionSnapshots)
    .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        eq(accounts.code, account),
        eq(dailyPositionSnapshots.account, accounts.code),
        eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
        eq(dailyPositionSnapshots.source, source),
        eq(dailyPositionSnapshots.isSample, false),
      ),
    )
    .orderBy(
      asc(dailyPositionSnapshots.assetName),
      asc(dailyPositionSnapshots.legacyAssetId),
    )
    .limit(HISTORY_POSITION_COMPARISON_QUERY_LIMIT);
}

async function loadPositionRows(
  tenantContext: TenantContext,
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
    .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        eq(accounts.code, selection.account),
        eq(dailyPositionSnapshots.account, accounts.code),
        eq(dailyPositionSnapshots.snapshotDate, selection.snapshotDate),
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

async function loadBalanceRows(
  tenantContext: TenantContext,
): Promise<ReadOnlyBalanceHistoryRow[]> {
  return db
    .select({
      balanceDate: accountBalanceSnapshots.balanceDate,
      cash: accountBalanceSnapshots.cash,
      brokerage: accountBalanceSnapshots.brokerage,
      isa: accountBalanceSnapshots.isa,
      irp: accountBalanceSnapshots.irp,
    })
    .from(accountBalanceSnapshots)
    .where(
      and(
        eq(
          accountBalanceSnapshots.canonicalOwnerUserId,
          tenantContext.ownerUserId,
        ),
        eq(accountBalanceSnapshots.isSample, false),
      ),
    )
    .orderBy(asc(accountBalanceSnapshots.balanceDate));
}

async function loadPortfolioRows(
  tenantContext: TenantContext,
  account: HistoryAccount,
): Promise<PortfolioHistoryRawRow[]> {
  const predicates = [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
    eq(dailyPortfolioSnapshots.account, accounts.code),
    eq(dailyPortfolioSnapshots.isSample, false),
  ];
  if (account !== "all") predicates.push(eq(accounts.code, account));

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
    .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
    .where(and(...predicates))
    .orderBy(
      asc(dailyPortfolioSnapshots.snapshotDate),
      asc(accounts.sortOrder),
      asc(accounts.code),
      asc(dailyPortfolioSnapshots.source),
    );
}

async function captureLoad<T>(
  requested: boolean,
  load: () => Promise<T>,
): Promise<LoadResult<T>> {
  if (!requested) return Object.freeze({ state: "not_requested" });
  try {
    return Object.freeze({ state: "ready", value: await load() });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

function loadedValue<T>(result: LoadResult<T>, fallback: T) {
  return result.state === "ready" ? result.value : fallback;
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
