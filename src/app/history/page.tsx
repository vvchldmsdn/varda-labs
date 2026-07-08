import Link from "next/link";
import type { ReactNode } from "react";

import {
  getReadOnlyHistoryBalance,
  type ReadOnlyBalanceHistoryRow,
} from "@/db/queries/history-balance";
import {
  HISTORY_ACCOUNTS,
  HISTORY_LANES,
  normalizeHistoryAccount,
  normalizeHistoryLane,
  type HistoryAccount,
  type PortfolioHistoryDisplayRow,
} from "@/lib/history-balance";

export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    lane?: string | string[];
  }>;
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const account = normalizeHistoryAccount(params.account);
  const lane = normalizeHistoryLane(params.lane);
  const history = await getReadOnlyHistoryBalance({ account, lane });

  return (
    <main className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">
                Varda Labs
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                History Balance
              </h1>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/etfs">ETF Reference</NavLink>
              <NavLink href="/market">Market Context</NavLink>
            </nav>
          </div>

          <form
            action="/history"
            className="mt-4 grid gap-3 md:grid-cols-[180px_180px_auto]"
          >
            <label className="grid gap-1 text-xs font-semibold text-[#687064]">
              Account
              <select
                name="account"
                defaultValue={account}
                className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-sm font-semibold text-[#171916]"
              >
                {HISTORY_ACCOUNTS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[#687064]">
              Lane
              <select
                name="lane"
                defaultValue={lane}
                className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-sm font-semibold text-[#171916]"
              >
                {HISTORY_LANES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-md bg-[#1e3a34] px-4 py-2 text-sm font-semibold text-white hover:bg-[#284a42]"
              >
                Apply
              </button>
            </div>
          </form>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <SummaryCell
              label="Balance rows"
              value={String(history.summary.balanceRowCount)}
              detail={formatDateRange(history.summary.balanceDateRange)}
            />
            <SummaryCell
              label="Portfolio rows"
              value={String(history.summary.portfolioRowCount)}
              detail={formatDateRange(history.summary.portfolioDateRange)}
            />
            <SummaryCell
              label="Derived all rows"
              value={String(history.summary.derivedPortfolioRowCount)}
              detail="display only"
            />
            <SummaryCell
              label="Overlapping dates"
              value={String(history.summary.overlappingDateCount)}
              detail="balance / portfolio"
            />
          </div>
        </section>

        {lane !== "portfolio" ? (
          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <SectionHeader
              title="Balance Evidence"
              detail="account_balance_snapshots"
            />
            <BalanceTable rows={history.balanceRows} account={account} />
          </section>
        ) : null}

        {lane !== "balance" ? (
          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <SectionHeader
              title="Portfolio Performance"
              detail="daily_portfolio_snapshots"
            />
            <PortfolioTable rows={history.portfolioRows} account={account} />
          </section>
        ) : null}
      </div>
    </main>
  );
}

function BalanceTable({
  rows,
  account,
}: {
  rows: ReadOnlyBalanceHistoryRow[];
  account: HistoryAccount;
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage>No balance rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Date</TableHeader>
            <TableHeader align="right">Selected</TableHeader>
            <TableHeader align="right">Cash</TableHeader>
            <TableHeader align="right">Brokerage</TableHeader>
            <TableHeader align="right">ISA</TableHeader>
            <TableHeader align="right">IRP</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[#e1e6dc]">
              <TableCell strong>{row.date}</TableCell>
              <TableCell align="right">
                {formatMoney(balanceValueForAccount(row, account))}
              </TableCell>
              <TableCell align="right">{formatMoney(row.cash)}</TableCell>
              <TableCell align="right">{formatMoney(row.brokerage)}</TableCell>
              <TableCell align="right">{formatMoney(row.isa)}</TableCell>
              <TableCell align="right">{formatMoney(row.irp)}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioTable({
  rows,
  account,
}: {
  rows: PortfolioHistoryDisplayRow[];
  account: HistoryAccount;
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage>No portfolio rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Date</TableHeader>
            <TableHeader>Account</TableHeader>
            <TableHeader>Source</TableHeader>
            <TableHeader>Kind</TableHeader>
            <TableHeader align="right">Cash value</TableHeader>
            <TableHeader align="right">Invested</TableHeader>
            <TableHeader align="right">Cost</TableHeader>
            <TableHeader align="right">Market value</TableHeader>
            <TableHeader align="right">PnL</TableHeader>
            <TableHeader align="right">Return</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[#e1e6dc]">
              <TableCell strong>{row.snapshotDate}</TableCell>
              <TableCell>{account}</TableCell>
              <TableCell>{row.source}</TableCell>
              <TableCell>
                {row.rowKind}
                {row.derivedFromAccounts.length > 0
                  ? ` (${row.derivedFromAccounts.join(", ")})`
                  : ""}
              </TableCell>
              <TableCell align="right">{formatNumber(row.cashValue)}</TableCell>
              <TableCell align="right">
                {formatNumber(row.investedAmount)}
              </TableCell>
              <TableCell align="right">{formatNumber(row.totalCost)}</TableCell>
              <TableCell align="right">
                {formatNumber(row.totalMarketValue)}
              </TableCell>
              <TableCell align="right">{formatNumber(row.totalPnl)}</TableCell>
              <TableCell align="right">
                {formatPercent(row.totalReturnPct)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e1e6dc] bg-white px-3 py-2">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <p className="text-xs font-semibold text-[#687064]">{detail}</p>
    </div>
  );
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[#687064]">
      {children}
    </p>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#4d574b] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-[#dfe3d5] px-2 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  strong = false,
  align = "left",
}: {
  children: ReactNode;
  strong?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "border-b border-[#eef1e8] px-2 py-2 align-top",
        strong ? "font-semibold text-[#171916]" : "text-[#4d574b]",
        align === "right" ? "text-right tabular-nums" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function balanceValueForAccount(
  row: ReadOnlyBalanceHistoryRow,
  account: HistoryAccount,
) {
  if (account === "brokerage") return row.brokerage;
  if (account === "isa") return row.isa;
  if (account === "irp") return row.irp;

  const values = [row.cash, row.brokerage, row.isa, row.irp]
    .map((value) => (value === null ? null : Number(value)))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function formatMoney(value: string | number | null) {
  if (value === null || value === "") return "n/a";
  return formatNumber(Number(value));
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatDateRange(range: { minDate: string | null; maxDate: string | null }) {
  if (!range.minDate || !range.maxDate) return "no dates";
  if (range.minDate === range.maxDate) return range.minDate;
  return `${range.minDate} to ${range.maxDate}`;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
