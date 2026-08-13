import type { PortfolioAnalysisScopeKey } from "./portfolio-analysis-scope.ts";

export const HISTORY_PORTFOLIO_SCOPE_POLICY = Object.freeze({
  version: "effective_dated_portfolio_group_history_v1",
  membershipWindow: "valid_from_inclusive_valid_to_exclusive",
  membershipUnion: "whole_account_or_direct_asset",
  overlapBehavior: "single_snapshot_row_counted_once",
  missingValueBehavior: "keep_partial_date_without_imputation",
  cashAllocation: "unavailable_without_explicit_policy",
} as const);

export type HistoryMembershipPeriod = Readonly<{
  targetId: string;
  validFrom: string;
  validTo: string | null;
}>;

export type HistoryPositionScopeCandidate = Readonly<{
  snapshotDate: string;
  source: string;
  account: string;
  accountId: string | null;
  assetId: string | null;
  marketValueKrw: string | null;
  costKrw: string | null;
  pnlKrw: string | null;
}>;

export type PortfolioGroupHistoryRawRow = Readonly<{
  snapshotDate: string;
  account: PortfolioAnalysisScopeKey;
  source: string;
  rowKind: "derived" | "partial";
  derivedFromAccounts: readonly string[];
  cashValue: null;
  investedAmount: null;
  totalCost: string | null;
  totalMarketValue: string | null;
  totalPnl: string | null;
  totalReturnPct: string | null;
}>;

export function buildPortfolioGroupHistoryRows({
  accountMemberships,
  assetMemberships,
  rows,
  scopeKey,
}: {
  accountMemberships: readonly HistoryMembershipPeriod[];
  assetMemberships: readonly HistoryMembershipPeriod[];
  rows: readonly HistoryPositionScopeCandidate[];
  scopeKey: PortfolioAnalysisScopeKey;
}): PortfolioGroupHistoryRawRow[] {
  const accountMembershipsByTarget = indexMemberships(accountMemberships);
  const assetMembershipsByTarget = indexMemberships(assetMemberships);
  const rowsByDateSource = new Map<string, HistoryPositionScopeCandidate[]>();

  for (const row of rows) {
    if (
      !isIncludedAtDate(
        row,
        accountMembershipsByTarget,
        assetMembershipsByTarget,
      )
    ) {
      continue;
    }
    const key = `${row.snapshotDate}|${row.source}`;
    const group = rowsByDateSource.get(key);
    if (group) group.push(row);
    else rowsByDateSource.set(key, [row]);
  }

  return [...rowsByDateSource.values()]
    .map((group) => aggregateGroup(group, scopeKey))
    .sort(compareRows);
}

function isIncludedAtDate(
  row: HistoryPositionScopeCandidate,
  accountMemberships: ReadonlyMap<
    string,
    readonly HistoryMembershipPeriod[]
  >,
  assetMemberships: ReadonlyMap<string, readonly HistoryMembershipPeriod[]>,
) {
  const accountIncluded =
    row.accountId !== null &&
    (accountMemberships.get(row.accountId)?.some((membership) =>
      isActiveOn(membership, row.snapshotDate),
    ) ?? false);
  const assetIncluded =
    row.assetId !== null &&
    (assetMemberships.get(row.assetId)?.some((membership) =>
      isActiveOn(membership, row.snapshotDate),
    ) ?? false);
  return accountIncluded || assetIncluded;
}

function indexMemberships(
  memberships: readonly HistoryMembershipPeriod[],
): ReadonlyMap<string, readonly HistoryMembershipPeriod[]> {
  const index = new Map<string, HistoryMembershipPeriod[]>();
  for (const membership of memberships) {
    const periods = index.get(membership.targetId);
    if (periods) periods.push(membership);
    else index.set(membership.targetId, [membership]);
  }
  return index;
}

function isActiveOn(period: HistoryMembershipPeriod, date: string) {
  return period.validFrom <= date &&
    (period.validTo === null || date < period.validTo);
}

function aggregateGroup(
  rows: readonly HistoryPositionScopeCandidate[],
  scopeKey: PortfolioAnalysisScopeKey,
): PortfolioGroupHistoryRawRow {
  const marketValue = sumAvailable(rows, (row) => row.marketValueKrw);
  const cost = sumAvailable(rows, (row) => row.costKrw);
  const pnl = sumAvailable(rows, (row) => row.pnlKrw);
  const complete = marketValue.complete && cost.complete && pnl.complete;
  const totalReturnPct =
    cost.complete && pnl.complete && cost.value !== null && cost.value !== 0 && pnl.value !== null
      ? (pnl.value / cost.value) * 100
      : null;

  return Object.freeze({
    snapshotDate: rows[0]!.snapshotDate,
    account: scopeKey,
    source: rows[0]!.source,
    rowKind: complete ? "derived" : "partial",
    derivedFromAccounts: Object.freeze(
      [...new Set(rows.map((row) => row.account))].sort(),
    ),
    cashValue: null,
    investedAmount: null,
    totalCost: numberString(cost.value),
    totalMarketValue: numberString(marketValue.value),
    totalPnl: numberString(pnl.value),
    totalReturnPct: numberString(totalReturnPct),
  });
}

function sumAvailable<T>(
  rows: readonly T[],
  select: (row: T) => string | null,
) {
  let value = 0;
  let available = 0;

  for (const row of rows) {
    const numeric = finiteNumber(select(row));
    if (numeric === null) continue;
    value += numeric;
    available += 1;
  }

  return Object.freeze({
    value: available > 0 ? value : null,
    complete: available === rows.length,
  });
}

function finiteNumber(value: string | null) {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numberString(value: number | null) {
  return value === null ? null : String(value);
}

function compareRows(
  left: PortfolioGroupHistoryRawRow,
  right: PortfolioGroupHistoryRawRow,
) {
  return (
    left.snapshotDate.localeCompare(right.snapshotDate) ||
    left.source.localeCompare(right.source)
  );
}
