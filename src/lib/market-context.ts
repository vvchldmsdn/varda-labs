export type MarketTieBreakFields = {
  legacyBase44Id: string | null;
  base44UpdatedAt: Date | string | null;
  updatedAt: Date | string | null;
  createdAt: Date | string | null;
};

export type BenchmarkSelectionRow = MarketTieBreakFields & {
  benchmarkDate: string;
  benchmarkTicker: string;
};

export type MarketRegimeSelectionRow = MarketTieBreakFields & {
  regimeDate: string;
  account: string;
};

export type MarketRegimeDuplicateGroup = {
  date: string;
  account: string;
  rowCount: number;
  selectedLegacyBase44Id: string | null;
  legacyBase44Ids: string[];
};

export type GlobalMarketFactorSelectionRow = MarketTieBreakFields & {
  factorDate: string;
  factorKey: string;
  factorFamily: string;
};

export type GlobalMarketFactorFamily<T extends GlobalMarketFactorSelectionRow> = {
  family: string;
  factors: T[];
};

export function selectLatestBenchmarksByTicker<T extends BenchmarkSelectionRow>(
  rows: T[],
  tickers: readonly string[],
) {
  const rowsByTicker = new Map<string, T[]>();

  for (const row of rows) {
    const key = row.benchmarkTicker;
    const existingRows = rowsByTicker.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByTicker.set(key, [row]);
    }
  }

  return tickers
    .map((ticker) =>
      [...(rowsByTicker.get(ticker) ?? [])].sort(compareBenchmarkRows)[0],
    )
    .filter((row): row is T => Boolean(row));
}

export function selectLatestMarketRegimesByAccount<
  T extends MarketRegimeSelectionRow,
>(rows: T[]) {
  const rowsByAccount = new Map<string, T[]>();

  for (const row of rows) {
    const key = row.account;
    const existingRows = rowsByAccount.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByAccount.set(key, [row]);
    }
  }

  return [...rowsByAccount.values()]
    .map((accountRows) => [...accountRows].sort(compareMarketRegimeRows)[0])
    .filter((row): row is T => Boolean(row))
    .sort((left, right) => left.account.localeCompare(right.account));
}

export function summarizeMarketRegimeDuplicateGroups<
  T extends MarketRegimeSelectionRow,
>(rows: T[]): MarketRegimeDuplicateGroup[] {
  const rowsByDateAccount = new Map<string, T[]>();

  for (const row of rows) {
    const key = `${row.regimeDate}|${row.account}`;
    const existingRows = rowsByDateAccount.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByDateAccount.set(key, [row]);
    }
  }

  return [...rowsByDateAccount.values()]
    .filter((groupRows) => groupRows.length > 1)
    .map((groupRows) => {
      const sortedRows = [...groupRows].sort(compareMarketRegimeRows);
      const selectedRow = sortedRows[0];

      return {
        date: selectedRow.regimeDate,
        account: selectedRow.account,
        rowCount: sortedRows.length,
        selectedLegacyBase44Id: selectedRow.legacyBase44Id,
        legacyBase44Ids: sortedRows
          .map((row) => row.legacyBase44Id)
          .filter((id): id is string => Boolean(id)),
      };
    })
    .sort((left, right) => {
      const dateCompare = right.date.localeCompare(left.date);
      if (dateCompare !== 0) return dateCompare;
      return left.account.localeCompare(right.account);
    });
}

export function selectLatestGlobalMarketFactorsByKey<
  T extends GlobalMarketFactorSelectionRow,
>(rows: T[]) {
  const rowsByFactorKey = new Map<string, T[]>();

  for (const row of rows) {
    const key = row.factorKey;
    const existingRows = rowsByFactorKey.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByFactorKey.set(key, [row]);
    }
  }

  return [...rowsByFactorKey.values()]
    .map((factorRows) => [...factorRows].sort(compareGlobalMarketFactorRows)[0])
    .filter((row): row is T => Boolean(row))
    .sort((left, right) => {
      const familyCompare = left.factorFamily.localeCompare(right.factorFamily);
      if (familyCompare !== 0) return familyCompare;
      return left.factorKey.localeCompare(right.factorKey);
    });
}

export function groupGlobalMarketFactorsByFamily<
  T extends GlobalMarketFactorSelectionRow,
>(rows: T[]): GlobalMarketFactorFamily<T>[] {
  const rowsByFamily = new Map<string, T[]>();

  for (const row of rows) {
    const existingRows = rowsByFamily.get(row.factorFamily);
    if (existingRows) {
      existingRows.push(row);
    } else {
      rowsByFamily.set(row.factorFamily, [row]);
    }
  }

  return [...rowsByFamily.entries()]
    .map(([family, factors]) => ({
      family,
      factors: [...factors].sort((left, right) =>
        left.factorKey.localeCompare(right.factorKey),
      ),
    }))
    .sort((left, right) => left.family.localeCompare(right.family));
}

function compareBenchmarkRows<T extends BenchmarkSelectionRow>(left: T, right: T) {
  return compareLatestRows(left, right, (row) => row.benchmarkDate);
}

function compareMarketRegimeRows<T extends MarketRegimeSelectionRow>(
  left: T,
  right: T,
) {
  return compareLatestRows(left, right, (row) => row.regimeDate);
}

function compareGlobalMarketFactorRows<T extends GlobalMarketFactorSelectionRow>(
  left: T,
  right: T,
) {
  return compareLatestRows(left, right, (row) => row.factorDate);
}

function compareLatestRows<T extends MarketTieBreakFields>(
  left: T,
  right: T,
  primaryDate: (row: T) => string,
) {
  return compareByFieldsDesc(left, right, [
    primaryDate,
    (row) => row.base44UpdatedAt,
    (row) => row.updatedAt,
    (row) => row.createdAt,
    (row) => row.legacyBase44Id,
  ]);
}

function compareByFieldsDesc<T>(
  left: T,
  right: T,
  selectors: Array<(row: T) => Date | string | null>,
) {
  for (const selector of selectors) {
    const result = compareNullableDesc(selector(left), selector(right));
    if (result !== 0) return result;
  }
  return 0;
}

function compareNullableDesc(
  left: Date | string | null,
  right: Date | string | null,
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;

  const leftValue = comparableValue(left);
  const rightValue = comparableValue(right);

  if (leftValue > rightValue) return -1;
  if (leftValue < rightValue) return 1;
  return 0;
}

function comparableValue(value: Date | string) {
  if (value instanceof Date) return value.getTime();
  return value;
}
