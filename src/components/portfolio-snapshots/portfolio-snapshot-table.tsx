import type { TenantPortfolioSnapshotDto } from "@/lib/tenant-portfolio-snapshot-read-model";
import {
  formatPortfolioCapturedAt,
  formatPortfolioKrw,
  formatPortfolioPercent,
} from "@/lib/portfolio-snapshot-presentation";

export function PortfolioSnapshotTable({
  snapshots,
}: {
  snapshots: readonly TenantPortfolioSnapshotDto[];
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)] bg-white">
      <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
        <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
          <tr>
            <TableHeading>Account</TableHeading>
            <TableHeading align="right">Market value</TableHeading>
            <TableHeading align="right">Invested</TableHeading>
            <TableHeading align="right">Cost</TableHeading>
            <TableHeading align="right">P/L</TableHeading>
            <TableHeading align="right">Return</TableHeading>
            <TableHeading align="right">Cash</TableHeading>
            <TableHeading align="right">Assets</TableHeading>
            <TableHeading>Top holding</TableHeading>
            <TableHeading>Captured</TableHeading>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--wash)]">
          {snapshots.map((snapshot) => (
            <tr key={snapshot.accountCode}>
              <td className="px-4 py-3">
                <p className="font-semibold">{snapshot.accountName}</p>
                <p className="text-xs text-[var(--muted)]">
                  {snapshot.accountCode}
                </p>
              </td>
              <NumberCell value={formatPortfolioKrw(snapshot.totalMarketValue)} />
              <NumberCell value={formatPortfolioKrw(snapshot.investedAmount)} />
              <NumberCell value={formatPortfolioKrw(snapshot.totalCost)} />
              <NumberCell value={formatPortfolioKrw(snapshot.totalPnl)} />
              <NumberCell value={formatPortfolioPercent(snapshot.totalReturnPct)} />
              <NumberCell value={formatPortfolioKrw(snapshot.cashValue)} />
              <NumberCell value={String(snapshot.numAssets ?? "-")} />
              <td className="px-4 py-3">
                <p>{snapshot.topHoldingName ?? "-"}</p>
                <p className="text-xs text-[var(--muted)]">
                  {formatPortfolioPercent(snapshot.topHoldingWeight)}
                </p>
              </td>
              <td className="px-4 py-3 text-xs text-[var(--muted)]">
                <p>{formatPortfolioCapturedAt(snapshot.capturedAt)}</p>
                <p>{snapshot.ruleVersion ?? "Unversioned"}</p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberCell({ value }: { value: string }) {
  return <td className="px-4 py-3 text-right tabular-nums">{value}</td>;
}

function TableHeading({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}
