import "server-only";

import { loadTenantPortfolioGroupMemberships } from "@/db/queries/tenant-group-reads";
import {
  loadTenantHistoryGroupPositionRows,
  loadTenantHistoryPortfolioRows,
  loadTenantHistoryPositionComparisonRows,
  loadTenantHistoryPositionDetailRows,
} from "@/db/queries/tenant-history-snapshots";
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
  return loadTenantHistoryPositionComparisonRows({
    account,
    accountId,
    limit: HISTORY_POSITION_COMPARISON_QUERY_LIMIT,
    snapshotDate,
    source,
    tenantContext,
  });
}

async function loadPositionRows(
  tenantContext: TenantContext,
  scope: PortfolioAnalysisScope,
  selection: Extract<HistoryPositionSelection, { status: "requested" }>,
): Promise<HistoryPositionRawRow[]> {
  if (scope.kind !== "account" || scope.accountCode !== selection.account) {
    throw new Error("History position detail scope mismatch");
  }
  return loadTenantHistoryPositionDetailRows({
    account: selection.account,
    accountId: scope.accountId,
    limit: HISTORY_POSITION_DETAIL_QUERY_LIMIT,
    snapshotDate: selection.snapshotDate,
    source: selection.source,
    tenantContext,
  });
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

  return loadTenantHistoryPortfolioRows({
    accountIds: scope.kind === "account" ? [scope.accountId] : undefined,
    tenantContext,
  });
}

async function loadPortfolioGroupRows(
  tenantContext: TenantContext,
  scope: Extract<PortfolioAnalysisScope, { kind: "portfolio_group" }>,
): Promise<PortfolioHistoryRawRow[]> {
  const memberships = await loadTenantPortfolioGroupMemberships({
    mode: "all",
    portfolioGroupId: scope.portfolioGroupId,
    tenantContext,
  });
  const accountMemberships = memberships.accountMemberships;
  const assetMemberships = memberships.assetMemberships;

  const accountIds = uniqueTargets(accountMemberships);
  const assetIds = uniqueTargets(assetMemberships);
  if (accountIds.length === 0 && assetIds.length === 0) return [];

  const earliestMembershipDate = [...accountMemberships, ...assetMemberships]
    .map((membership) => membership.validFrom)
    .sort()[0]!;
  const rows = await loadTenantHistoryGroupPositionRows({
    accountIds,
    assetIds,
    earliestMembershipDate,
    tenantContext,
  });

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
