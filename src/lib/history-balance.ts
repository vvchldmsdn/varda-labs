export const HISTORY_ACCOUNTS = ["all", "brokerage", "isa", "irp"] as const;
export const HISTORY_LANES = ["all", "portfolio", "balance"] as const;

export type HistoryAccount = (typeof HISTORY_ACCOUNTS)[number];
export type HistoryLane = (typeof HISTORY_LANES)[number];

export type PortfolioHistoryRawRow = {
  id: string;
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
  id: string;
  snapshotDate: string;
  account: HistoryAccount;
  source: string;
  rowKind: "stored" | "derived";
  derivedFromAccounts: string[];
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
    .sort(comparePortfolioDisplayRows);
}

function storedPortfolioRow(
  row: PortfolioHistoryRawRow,
  account: HistoryAccount,
): PortfolioHistoryDisplayRow {
  return {
    id: row.id,
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
): PortfolioHistoryDisplayRow {
  const sortedRows = [...rows]
    .filter((row) => row.account !== "all")
    .sort((left, right) => left.account.localeCompare(right.account));
  const representative = sortedRows[0] ?? rows[0];
  const totalMarketValue = sumNullable(sortedRows, (row) => row.totalMarketValue);
  const totalCost = sumNullable(sortedRows, (row) => row.totalCost);
  const totalPnl = sumNullable(sortedRows, (row) => row.totalPnl);

  return {
    id: `derived:${representative.snapshotDate}:${representative.source}`,
    snapshotDate: representative.snapshotDate,
    account: "all",
    source: representative.source,
    rowKind: "derived",
    derivedFromAccounts: sortedRows.map((row) => row.account),
    cashValue: sumNullable(sortedRows, (row) => row.cashValue),
    investedAmount: sumNullable(sortedRows, (row) => row.investedAmount),
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
