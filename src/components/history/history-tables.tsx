import Link from "next/link";
import type { ReactNode } from "react";

import type { ReadOnlyBalanceHistoryRow } from "@/db/queries/history-balance";
import type {
  HistoryAccount,
  HistoryLane,
  PortfolioHistoryDisplayRow,
} from "@/lib/history-balance";
import { historyBalanceValueForAccount } from "@/lib/history-balance";
import type { HistoryPositionDetailModel } from "@/lib/history-position-detail";

import {
  HistoryTableCell as TableCell,
  HistoryTableHeader as TableHeader,
} from "./history-evidence-primitives";
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
                {formatHistoryKrw(
                  historyBalanceValueForAccount(row, account),
                )}
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
  lane,
  positionDetail,
}: {
  rows: PortfolioHistoryDisplayRow[];
  lane: HistoryLane;
  positionDetail: HistoryPositionDetailModel;
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage>포트폴리오 기록이 없습니다.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-sm">
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
            <TableHeader>보유 상세</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const selected = isSelectedPositionRow(row, positionDetail);
            return (
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
                data-history-position-selected={selected ? "true" : undefined}
                className={cn(
                  "border-t border-[#e1e6dc]",
                  selected && "bg-[#eef2e8]",
                )}
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
                <TableCell>
                  {row.account === "all" || row.rowKind === "derived" ? (
                    <span className="text-xs text-[#687064]">
                      계정별 선택 필요
                    </span>
                  ) : (
                    <Link
                      aria-current={selected ? "page" : undefined}
                      href={positionDetailHref(row, lane)}
                      className="inline-flex rounded-md border border-[#d7ddcf] bg-white px-2 py-1 text-xs font-semibold text-[#1e3a34] hover:bg-[#eef2e8]"
                    >
                      {selected ? "선택됨" : "보유 상세"}
                    </Link>
                  )}
                </TableCell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function isSelectedPositionRow(
  row: PortfolioHistoryDisplayRow,
  detail: HistoryPositionDetailModel,
) {
  return (
    detail.selection.status === "requested" &&
    row.rowKind === "stored" &&
    row.account === detail.selection.account &&
    row.snapshotDate === detail.selection.snapshotDate &&
    row.source === detail.selection.source
  );
}

function positionDetailHref(
  row: PortfolioHistoryDisplayRow,
  lane: HistoryLane,
) {
  const params = new URLSearchParams({
    account: row.account,
    lane,
    positionDate: row.snapshotDate,
    positionSource: row.source,
  });
  return `/history?${params.toString()}`;
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[#687064]">
      {children}
    </p>
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
