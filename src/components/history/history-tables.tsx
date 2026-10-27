
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { HistoryEvidenceLink as Link } from "./history-records-dialog";
import type { ReactNode } from "react";

import type { ReadOnlyBalanceHistoryRow } from "@/db/queries/history-balance";
import type {
  HistoryAccount,
  HistoryLane,
  PortfolioHistoryDisplayRow,
} from "@/lib/history-balance";
import { historyBalanceValueForAccount } from "@/lib/history-balance";
import type { HistoryPositionDetailModel } from "@/lib/history-position-detail";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";

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
    return <EmptyTableMessage><T ko="잔액 기록이 없습니다." en="No balance records are available."/></EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <TableHeader><T ko="잔액 기준일" en="Balance date"/></TableHeader>
            <TableHeader align="right"><T ko="선택 계정" en="Selected account"/></TableHeader>
            <TableHeader align="right"><T ko="현금" en="Cash"/></TableHeader>
            <TableHeader align="right"><T ko="증권" en="Brokerage"/></TableHeader>
            <TableHeader align="right">ISA</TableHeader>
            <TableHeader align="right">IRP</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`balance:${row.balanceDate}:${index}`}
              className="border-t border-[var(--wash)]"
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
  selectedScope,
}: {
  rows: PortfolioHistoryDisplayRow[];
  lane: HistoryLane;
  positionDetail: HistoryPositionDetailModel;
  selectedScope: PortfolioAnalysisScope;
}) {
  if (rows.length === 0) {
    return <EmptyTableMessage><T ko="포트폴리오 기록이 없습니다." en="No portfolio records are available."/></EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs text-[var(--muted)]">
          <tr>
            <TableHeader><T ko="스냅샷 저장일" en="Snapshot date"/></TableHeader>
            <TableHeader><T ko="계정" en="Account"/></TableHeader>
            <TableHeader><T ko="출처" en="Source"/></TableHeader>
            <TableHeader><T ko="행 구분" en="Row type"/></TableHeader>
            <TableHeader align="right"><T ko="현금" en="Cash"/></TableHeader>
            <TableHeader align="right"><T ko="투입 원금" en="Contributed capital"/></TableHeader>
            <TableHeader align="right"><T ko="비용 기준" en="Cost basis"/></TableHeader>
            <TableHeader align="right"><T ko="평가액" en="Value"/></TableHeader>
            <TableHeader align="right"><T ko="손익" en="Gain/loss"/></TableHeader>
            <TableHeader align="right"><T ko="수익률" en="Return"/></TableHeader>
            <TableHeader><T ko="보유 상세" en="Holding details"/></TableHeader>
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
                  "border-t border-[var(--wash)]",
                  selected && "bg-[var(--wash)]",
                )}
              >
                <TableCell strong>{row.snapshotDate}</TableCell>
                <TableCell>{<T ko={portfolioRowScopeLabel(selectedScope)} en={translateHomeHistory(portfolioRowScopeLabel(selectedScope))}/>}</TableCell>
                <TableCell>{<T ko={historySourceLabel(row.source)} en={translateHomeHistory(historySourceLabel(row.source))}/>}</TableCell>
                <TableCell><T ko={historyRowKindLabel(row)} en={historyRowKindLabel(row, "en")}/></TableCell>
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
                  {selectedScope.kind !== "account" ||
                  row.rowKind !== "stored" ? (
                    <span className="text-xs text-[var(--muted)]"><T ko="범위 상세 준비 중" en="Scope details unavailable"/></span>
                  ) : (
                    <Link
                      aria-current={selected ? "page" : undefined}
                      href={positionDetailHref(
                        row,
                        lane,
                        selectedScope.key,
                      )}
                      className="inline-flex rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
                    >
                      {<T ko={selected ? "선택됨" : "보유 상세"} en={translateHomeHistory(selected ? "선택됨" : "보유 상세")}/>}
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
  scopeKey: PortfolioAnalysisScope["key"],
) {
  const params = new URLSearchParams({
    scope: scopeKey,
    lane,
    positionDate: row.snapshotDate,
    positionSource: row.source,
  });
  return `/history?${params.toString()}`;
}

function portfolioRowScopeLabel(scope: PortfolioAnalysisScope) {
  return scope.kind === "all" ? historyAccountLabel("all") : scope.label;
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[var(--muted)]">
      {children}
    </p>
  );
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
