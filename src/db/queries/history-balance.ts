import "server-only";

import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
} from "@/db/schema";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
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
import {
  buildPortfolioGroupHistoryRows,
  type HistoryMembershipPeriod,
} from "@/lib/history-portfolio-scope";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
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
  analysisScopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
  balanceAccount: HistoryAccount | null;
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
  analysisScopes,
  tenantContext,
  scope,
  lane,
  positionSelection,
  positionComparisonSelection,
}: {
  analysisScopes: readonly PortfolioAnalysisScope[];
  tenantContext: TenantContext;
  scope: PortfolioAnalysisScope;
  lane: HistoryLane;
  positionSelection: HistoryPositionSelection;
  positionComparisonSelection: HistoryPositionComparisonSelection;
}): Promise<ReadOnlyHistoryBalance> {
  const balanceAccount = balanceAccountForScope(scope);
  const portfolioAccount = portfolioAccountForScope(scope);
  const expectedAccountCodes = analysisScopes.flatMap((candidate) =>
    candidate.kind === "account" ? [candidate.accountCode] : [],
  );
  const [balanceResult, portfolioResult, positionResult, comparisonResult] =
    await Promise.all([
      captureLoad(
        balanceAccount !== null && (lane === "all" || lane === "balance"),
        () => loadBalanceRows(tenantContext),
      ),
      captureLoad(lane === "all" || lane === "portfolio", () =>
        loadPortfolioRows(tenantContext, scope),
      ),
      positionSelection.status === "requested"
        ? captureLoad(true, () =>
            loadPositionRows(tenantContext, scope, positionSelection),
          )
        : Promise.resolve(Object.freeze({ state: "not_requested" } as const)),
      positionComparisonSelection.status === "requested"
        ? captureLoad(true, () =>
            loadPositionComparisonRows(
              tenantContext,
              scope,
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
    account: portfolioAccount,
    expectedAccounts: expectedAccountCodes,
  });
  const visibleBalanceRows = [...balanceRows].sort(compareBalanceRowsDesc);
  const positionDetail = buildHistoryPositionDetail({
    account: portfolioAccount,
    lane,
    selection: positionSelection,
    portfolioRows,
    positionRows,
  });
  const positionComparison = buildHistoryPositionComparison({
    account: portfolioAccount,
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
    analysisScopes,
    selectedScope: scope,
    balanceAccount,
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
  scope: PortfolioAnalysisScope,
  selection: Extract<
    HistoryPositionComparisonSelection,
    { status: "requested" }
  >,
) {
  if (scope.kind !== "account" || scope.accountCode !== selection.account) {
    throw new Error("History position comparison scope mismatch");
  }
  const [fromRows, toRows] = await Promise.all([
    loadPositionComparisonEndpointRows({
      tenantContext,
      accountId: scope.accountId,
      account: selection.account,
      snapshotDate: selection.from.snapshotDate,
      source: selection.from.source,
    }),
    loadPositionComparisonEndpointRows({
      tenantContext,
      accountId: scope.accountId,
      account: selection.account,
      snapshotDate: selection.to.snapshotDate,
      source: selection.to.source,
    }),
  ]);
  return { fromRows, toRows };
}

async function loadPositionComparisonEndpointRows({
  tenantContext,
  accountId,
  account,
  snapshotDate,
  source,
}: {
  tenantContext: TenantContext;
  accountId: string;
  account: string;
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
        eq(accounts.id, accountId),
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
  scope: PortfolioAnalysisScope,
  selection: Extract<HistoryPositionSelection, { status: "requested" }>,
): Promise<HistoryPositionRawRow[]> {
  if (scope.kind !== "account" || scope.accountCode !== selection.account) {
    throw new Error("History position detail scope mismatch");
  }
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
        eq(accounts.id, scope.accountId),
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
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [transaction.query(TENANT_BALANCE_ROWS_SQL)],
  );
  return rows.map(projectTenantBalanceSqlRow);
}

const TENANT_BALANCE_ROWS_SQL = `
  select
    snapshot.date::text as "balanceDate",
    snapshot.cash::text as cash,
    snapshot.brokerage::text as brokerage,
    snapshot.isa::text as isa,
    snapshot.irp::text as irp
  from public.account_balance_snapshots as snapshot
  where snapshot.is_sample = false
  order by snapshot.date
`;

function projectTenantBalanceSqlRow(
  row: Readonly<Record<string, unknown>>,
): ReadOnlyBalanceHistoryRow {
  return Object.freeze({
    balanceDate: requiredBalanceString(row.balanceDate),
    cash: nullableBalanceString(row.cash),
    brokerage: nullableBalanceString(row.brokerage),
    isa: nullableBalanceString(row.isa),
    irp: nullableBalanceString(row.irp),
  });
}

function requiredBalanceString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant balance snapshot row is invalid");
  }
  return value;
}

function nullableBalanceString(value: unknown) {
  return value === null ? null : requiredBalanceString(value);
}

async function loadPortfolioRows(
  tenantContext: TenantContext,
  scope: PortfolioAnalysisScope,
): Promise<PortfolioHistoryRawRow[]> {
  if (scope.kind === "portfolio_group") {
    return loadPortfolioGroupRows(tenantContext, scope);
  }

  const predicates = [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    eq(dailyPortfolioSnapshots.account, accounts.code),
    eq(dailyPortfolioSnapshots.isSample, false),
  ];
  if (scope.kind === "account") {
    predicates.push(eq(accounts.id, scope.accountId));
  }

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

async function loadPortfolioGroupRows(
  tenantContext: TenantContext,
  scope: Extract<PortfolioAnalysisScope, { kind: "portfolio_group" }>,
): Promise<PortfolioHistoryRawRow[]> {
  const [accountMemberships, assetMemberships] = await Promise.all([
    db
      .select({
        targetId: portfolioGroupAccountMemberships.accountId,
        validFrom: portfolioGroupAccountMemberships.validFrom,
        validTo: portfolioGroupAccountMemberships.validTo,
      })
      .from(portfolioGroupAccountMemberships)
      .where(
        and(
          eq(
            portfolioGroupAccountMemberships.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(
            portfolioGroupAccountMemberships.portfolioGroupId,
            scope.portfolioGroupId,
          ),
        ),
      ),
    db
      .select({
        targetId: portfolioGroupAssetMemberships.assetId,
        validFrom: portfolioGroupAssetMemberships.validFrom,
        validTo: portfolioGroupAssetMemberships.validTo,
      })
      .from(portfolioGroupAssetMemberships)
      .where(
        and(
          eq(
            portfolioGroupAssetMemberships.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(
            portfolioGroupAssetMemberships.portfolioGroupId,
            scope.portfolioGroupId,
          ),
        ),
      ),
  ]);

  const accountIds = uniqueTargets(accountMemberships);
  const assetIds = uniqueTargets(assetMemberships);
  if (accountIds.length === 0 && assetIds.length === 0) return [];

  const candidatePredicates = [];
  if (accountIds.length > 0) {
    candidatePredicates.push(inArray(dailyPositionSnapshots.accountId, accountIds));
  }
  if (assetIds.length > 0) {
    candidatePredicates.push(inArray(dailyPositionSnapshots.assetId, assetIds));
  }
  const membershipPredicate =
    candidatePredicates.length === 1
      ? candidatePredicates[0]
      : or(...candidatePredicates);
  const earliestMembershipDate = [...accountMemberships, ...assetMemberships]
    .map((membership) => membership.validFrom)
    .sort()[0]!;

  const rows = await db
    .select({
      snapshotDate: dailyPositionSnapshots.snapshotDate,
      source: dailyPositionSnapshots.source,
      account: dailyPositionSnapshots.account,
      accountId: dailyPositionSnapshots.accountId,
      assetId: dailyPositionSnapshots.assetId,
      marketValueKrw: dailyPositionSnapshots.marketValueKrw,
      costKrw: dailyPositionSnapshots.costKrw,
      pnlKrw: dailyPositionSnapshots.pnlKrw,
    })
    .from(dailyPositionSnapshots)
    .where(
      and(
        eq(
          dailyPositionSnapshots.canonicalOwnerUserId,
          tenantContext.ownerUserId,
        ),
        eq(dailyPositionSnapshots.isSample, false),
        gte(dailyPositionSnapshots.snapshotDate, earliestMembershipDate),
        membershipPredicate,
      ),
    )
    .orderBy(
      asc(dailyPositionSnapshots.snapshotDate),
      asc(dailyPositionSnapshots.source),
      asc(dailyPositionSnapshots.account),
      asc(dailyPositionSnapshots.assetName),
    );

  return buildPortfolioGroupHistoryRows({
    accountMemberships,
    assetMemberships,
    rows,
    scopeKey: scope.key,
  });
}

function uniqueTargets(rows: readonly HistoryMembershipPeriod[]) {
  return [...new Set(rows.map((row) => row.targetId))];
}

function balanceAccountForScope(
  scope: PortfolioAnalysisScope,
): HistoryAccount | null {
  if (scope.kind === "all") return "all";
  if (scope.kind !== "account") return null;
  return isHistoryAccount(scope.accountCode) ? scope.accountCode : null;
}

function portfolioAccountForScope(scope: PortfolioAnalysisScope) {
  if (scope.kind === "all") return "all";
  if (scope.kind === "account") return scope.accountCode;
  return scope.key;
}

function isHistoryAccount(value: string): value is HistoryAccount {
  return value === "brokerage" || value === "isa" || value === "irp";
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
