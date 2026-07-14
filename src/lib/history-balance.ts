export const HISTORY_ACCOUNTS = ["all", "brokerage", "isa", "irp"] as const;
export const HISTORY_LANES = ["all", "portfolio", "balance"] as const;

const REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS = [
  "brokerage",
  "isa",
  "irp",
] as const;

export type HistoryAccount = (typeof HISTORY_ACCOUNTS)[number];
export type HistoryLane = (typeof HISTORY_LANES)[number];

export type BalanceHistoryValueRow = {
  balanceDate: string;
  cash: string | null;
  brokerage: string | null;
  isa: string | null;
  irp: string | null;
};

export type PortfolioHistoryRawRow = {
  snapshotDate: string;
  account: string;
  source: string;
  cashValue: string | null;
  investedAmount: string | null;
  totalCost: string | null;
  totalMarketValue: string | null;
  totalPnl: string | null;
  totalReturnPct: string | null;
};

export type PortfolioHistoryDisplayRow = {
  snapshotDate: string;
  account: HistoryAccount;
  source: string;
  rowKind: "stored" | "derived";
  derivedFromAccounts: HistoryAccount[];
  cashValue: number | null;
  investedAmount: number | null;
  totalCost: number | null;
  totalMarketValue: number | null;
  totalPnl: number | null;
  totalReturnPct: number | null;
};

export function normalizeHistoryAccount(
  value: string | string[] | null | undefined,
): HistoryAccount {
  const input = firstParam(value)?.toLowerCase() ?? null;
  if (isHistoryAccount(input)) return input;
  return "all";
}

export function normalizeHistoryLane(
  value: string | string[] | null | undefined,
): HistoryLane {
  const input = firstParam(value)?.toLowerCase() ?? null;
  if (isHistoryLane(input)) return input;
  return "all";
}

export function historyBalanceValueForAccount(
  row: BalanceHistoryValueRow,
  account: HistoryAccount,
) {
  if (account === "brokerage") return numberOrNull(row.brokerage);
  if (account === "isa") return numberOrNull(row.isa);
  if (account === "irp") return numberOrNull(row.irp);

  const values = [row.cash, row.brokerage, row.isa, row.irp]
    .map(numberOrNull)
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function buildPortfolioHistoryDisplayRows({
  rows,
  account,
}: {
  rows: PortfolioHistoryRawRow[];
  account: HistoryAccount;
}): PortfolioHistoryDisplayRow[] {
  if (account !== "all") {
    return rows
      .filter((row) => row.account === account)
      .map((row) => storedPortfolioRow(row, account))
      .sort(comparePortfolioDisplayRows);
  }

  const rowsByDateSource = new Map<string, PortfolioHistoryRawRow[]>();

  for (const row of rows) {
    const key = `${row.snapshotDate}|${row.source}`;
    const group = rowsByDateSource.get(key);
    if (group) {
      group.push(row);
    } else {
      rowsByDateSource.set(key, [row]);
    }
  }

  return [...rowsByDateSource.values()]
    .map((groupRows) => {
      const storedAll = groupRows.find((row) => row.account === "all");
      if (storedAll) return storedPortfolioRow(storedAll, "all");
      return derivedAllPortfolioRow(groupRows);
    })
    .filter((row): row is PortfolioHistoryDisplayRow => row !== null)
    .sort(comparePortfolioDisplayRows);
}

function storedPortfolioRow(
  row: PortfolioHistoryRawRow,
  account: HistoryAccount,
): PortfolioHistoryDisplayRow {
  return {
    snapshotDate: row.snapshotDate,
    account,
    source: row.source,
    rowKind: "stored",
    derivedFromAccounts: [],
    cashValue: numberOrNull(row.cashValue),
    investedAmount: numberOrNull(row.investedAmount),
    totalCost: numberOrNull(row.totalCost),
    totalMarketValue: numberOrNull(row.totalMarketValue),
    totalPnl: numberOrNull(row.totalPnl),
    totalReturnPct: numberOrNull(row.totalReturnPct),
  };
}

function derivedAllPortfolioRow(
  rows: PortfolioHistoryRawRow[],
): PortfolioHistoryDisplayRow | null {
  const rowsByAccount = new Map<string, PortfolioHistoryRawRow>();

  for (const row of rows) {
    if (isRequiredPortfolioAggregateAccount(row.account)) {
      rowsByAccount.set(row.account, row);
    }
  }

  const sortedRows = REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS.map((account) =>
    rowsByAccount.get(account),
  );

  if (
    sortedRows.some(
      (row): row is undefined => row === undefined,
    )
  ) {
    return null;
  }

  const completeRows = sortedRows as PortfolioHistoryRawRow[];
  const representative = completeRows[0];
  const totalMarketValue = sumNullable(completeRows, (row) => row.totalMarketValue);
  const totalCost = sumNullable(completeRows, (row) => row.totalCost);
  const totalPnl = sumNullable(completeRows, (row) => row.totalPnl);

  return {
    snapshotDate: representative.snapshotDate,
    account: "all",
    source: representative.source,
    rowKind: "derived",
    derivedFromAccounts: [...REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS],
    cashValue: sumNullable(completeRows, (row) => row.cashValue),
    investedAmount: sumNullable(completeRows, (row) => row.investedAmount),
    totalCost,
    totalMarketValue,
    totalPnl,
    totalReturnPct:
      totalCost !== null && totalCost !== 0 && totalPnl !== null
        ? (totalPnl / totalCost) * 100
        : null,
  };
}

function sumNullable<T>(rows: T[], selector: (row: T) => string | null) {
  const values = rows
    .map((row) => numberOrNull(selector(row)))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function comparePortfolioDisplayRows(
  left: PortfolioHistoryDisplayRow,
  right: PortfolioHistoryDisplayRow,
) {
  const dateCompare = right.snapshotDate.localeCompare(left.snapshotDate);
  if (dateCompare !== 0) return dateCompare;
  const sourceCompare = left.source.localeCompare(right.source);
  if (sourceCompare !== 0) return sourceCompare;
  return left.rowKind.localeCompare(right.rowKind);
}

function numberOrNull(value: string | number | null) {
  if (value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstParam(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function isHistoryAccount(value: string | null): value is HistoryAccount {
  return HISTORY_ACCOUNTS.includes(value as HistoryAccount);
}

function isHistoryLane(value: string | null): value is HistoryLane {
  return HISTORY_LANES.includes(value as HistoryLane);
}

function isRequiredPortfolioAggregateAccount(
  value: string,
): value is (typeof REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS)[number] {
  return REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS.includes(
    value as (typeof REQUIRED_PORTFOLIO_AGGREGATE_ACCOUNTS)[number],
  );
}
