import { percentOrNull, sumBy, sumComplete, toNumber } from "./portfolio-math.ts";

export type PortfolioDashboardSnapshotTrendRow = Readonly<{
  snapshotDate: string;
  account: string;
  totalMarketValue: unknown;
  totalCost: unknown;
  totalPnl: unknown;
  totalReturnPct: unknown;
}>;

export function buildPortfolioDashboardSnapshotTrend(
  rows: readonly PortfolioDashboardSnapshotTrendRow[],
) {
  const rowsByDate = new Map<
    string,
    Map<string, PortfolioDashboardSnapshotTrendRow>
  >();

  for (const row of rows) {
    if (row.account === "all") continue;
    const rowsByAccount = rowsByDate.get(row.snapshotDate) ?? new Map();
    if (!rowsByAccount.has(row.account)) rowsByAccount.set(row.account, row);
    rowsByDate.set(row.snapshotDate, rowsByAccount);
  }

  return [...rowsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, rowsByAccount]) => {
      const accountRows = [...rowsByAccount.values()];
      const totalMarketValue = sumBy(
        accountRows,
        (row) => toNumber(row.totalMarketValue) ?? 0,
      );
      const totalPnl = sumComplete(accountRows, (row) => toNumber(row.totalPnl));
      const totalCost = sumComplete(accountRows, (row) => toNumber(row.totalCost));
      const storedReturnPct =
        accountRows.length === 1
          ? toNumber(accountRows[0]?.totalReturnPct)
          : null;

      return {
        date,
        totalMarketValue,
        totalPnl,
        totalReturnPct:
          storedReturnPct ??
          (totalPnl !== null && totalCost !== null
            ? percentOrNull(totalPnl, totalCost)
            : null),
      };
    })
    .slice(-130);
}
