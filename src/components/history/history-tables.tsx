import type { ReactNode } from "react";

import type { ReadOnlyBalanceHistoryRow } from "@/db/queries/history-balance";
import type {
  HistoryAccount,
  PortfolioHistoryDisplayRow,
} from "@/lib/history-balance";

import {
  formatHistoryKrw,
  formatHistoryPercent,
  historyAccountLabel,
  historyRowKindLabel,
  historySourceLabel,
} from "./history-format";

export function BalanceHistoryTable({
  rows,
  account,
}: {
  rows: ReadOnlyBalanceHistoryRow[];
  account: HistoryAccount;
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage>잔액 기록이 없습니다.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs text-[#687064]">
          <tr>
            <TableHeader>잔액 기준일</TableHeader>
            <TableHeader align="right">선택 계정</TableHeader>
            <TableHeader align="right">현금</TableHeader>
            <TableHeader align="right">증권</TableHeader>
            <TableHeader align="right">ISA</TableHeader>
            <TableHeader align="right">IRP</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`balance:${row.balanceDate}:${index}`}
              className="border-t border-[#e1e6dc]"
            >
              <TableCell strong>{row.balanceDate}</TableCell>
              <TableCell align="right">
                {formatHistoryKrw(balanceValueForAccount(row, account))}
              </TableCell>
              <TableCell align="right">{formatHistoryKrw(row.cash)}</TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.brokerage)}
              </TableCell>
              <TableCell align="right">{formatHistoryKrw(row.isa)}</TableCell>
              <TableCell align="right">{formatHistoryKrw(row.irp)}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PortfolioHistoryTable({
  rows,
}: {
  rows: PortfolioHistoryDisplayRow[];
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage>포트폴리오 기록이 없습니다.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs text-[#687064]">
          <tr>
            <TableHeader>스냅샷 저장일</TableHeader>
            <TableHeader>계정</TableHeader>
            <TableHeader>출처</TableHeader>
            <TableHeader>행 구분</TableHeader>
            <TableHeader align="right">현금</TableHeader>
            <TableHeader align="right">투입 원금</TableHeader>
            <TableHeader align="right">비용 기준</TableHeader>
            <TableHeader align="right">평가액</TableHeader>
            <TableHeader align="right">손익</TableHeader>
            <TableHeader align="right">수익률</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={[
                "portfolio",
                row.snapshotDate,
                row.account,
                row.source,
                row.rowKind,
                index,
              ].join(":")}
              data-history-row-kind={row.rowKind}
              className="border-t border-[#e1e6dc]"
            >
              <TableCell strong>{row.snapshotDate}</TableCell>
              <TableCell>{historyAccountLabel(row.account)}</TableCell>
              <TableCell>{historySourceLabel(row.source)}</TableCell>
              <TableCell>{historyRowKindLabel(row)}</TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.cashValue)}
              </TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.investedAmount)}
              </TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.totalCost)}
              </TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.totalMarketValue)}
              </TableCell>
              <TableCell align="right">
                {formatHistoryKrw(row.totalPnl)}
              </TableCell>
              <TableCell align="right">
                {formatHistoryPercent(row.totalReturnPct)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
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

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
