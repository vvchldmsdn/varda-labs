import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import { percentOrNull, sumBy, toNumber } from "./portfolio-math.ts";

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
  selectedAccount: PortfolioAccountScope,
) {
  const rowsByDate = new Map<
    string,
    Map<string, PortfolioDashboardSnapshotTrendRow>
  >();

  for (const row of rows) {
    if (!NAMED_PORTFOLIO_ACCOUNTS.some((account) => account === row.account)) {
      continue;
    }
    if (selectedAccount !== "all" && row.account !== selectedAccount) continue;

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
      const pnlRows = accountRows
        .map((row) => toNumber(row.totalPnl))
        .filter((value): value is number => value !== null);
      const costRows = accountRows
        .map((row) => toNumber(row.totalCost))
        .filter((value): value is number => value !== null);
      const totalPnl = pnlRows.length > 0 ? sumBy(pnlRows, (value) => value) : null;
      const totalCost =
        costRows.length > 0 ? sumBy(costRows, (value) => value) : null;
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
    .slice(-14);
}
