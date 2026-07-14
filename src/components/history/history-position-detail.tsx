import Link from "next/link";
import type { ReactNode } from "react";

import type {
  HistoryPositionDetailModel,
  HistoryPositionDisplayRow,
} from "@/lib/history-position-detail";

import {
  formatHistoryKrw,
  historyAccountLabel,
  historySourceLabel,
} from "./history-format";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 8,
});
const PERCENT_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 2,
});

export function HistoryPositionDetail({
  model,
}: {
  model: HistoryPositionDetailModel;
}) {
  return (
    <section
      data-history-position-detail
      data-history-position-detail-status={model.status}
      data-history-position-detail-reason={model.reason}
      data-history-position-count={model.positionCount}
      data-history-position-valued-count={model.valuedPositionCount}
      data-history-position-legacy-only={model.legacyOnlyCount}
      data-history-position-duplicate-count={model.duplicateIdentityCount}
      data-history-position-incompatible-count={model.incompatibleRowCount}
      data-history-position-reconciliation={model.reconciliationStatus}
      data-history-position-policy={model.policy.version}
      className="mt-4 border-y border-[#dfe3d5] py-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            저장 포지션 근거
          </p>
          <h3 className="mt-1 text-base font-semibold tracking-normal">
            과거 보유 상세
          </h3>
          {model.snapshotDate && model.source ? (
            <p className="mt-1 text-xs text-[#687064]">
              {model.snapshotDate} · {historyAccountLabel(model.account)} · {" "}
              {historySourceLabel(model.source)}
            </p>
          ) : null}
        </div>
        {model.selection.status !== "idle" ? (
          <Link
            href={clearDetailHref(model)}
            className="w-fit rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-xs font-semibold text-[#4d574b] hover:bg-[#eef2e8]"
          >
            상세 닫기
          </Link>
        ) : null}
      </div>

      {model.status === "ready" || model.status === "partial" ? (
        <ReadyDetail model={model} />
      ) : (
        <p className="mt-3 bg-white px-3 py-3 text-sm leading-6 text-[#687064]">
          {statusMessage(model)}
        </p>
      )}
    </section>
  );
}

function ReadyDetail({ model }: { model: HistoryPositionDetailModel }) {
  return (
    <>
      {model.status === "partial" ? (
        <p className="mt-3 border border-[#eadfc7] bg-[#fff8e7] px-3 py-2 text-sm text-[#6f561c]">
          일부 저장 근거가 불완전합니다. 확인 가능한 행은 그대로 표시하며
          누락값을 보간하거나 현재 자산 정보로 대체하지 않습니다.
        </p>
      ) : null}

      <div className="mt-3 grid border-t border-[#e1e6dc] sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell
          label="포트폴리오 저장 평가액"
          value={formatHistoryKrw(model.portfolioTotalMarketValueKrw)}
          detail="포트폴리오 저장 행"
        />
        <SummaryCell
          label="포지션 저장 합계"
          value={formatHistoryKrw(model.positionMarketValueKrw)}
          detail={`${model.valuedPositionCount}/${model.positionCount}행 평가액 있음`}
        />
        <SummaryCell
          label="저장 현금"
          value={formatHistoryKrw(model.portfolioCashValueKrw)}
          detail="포지션 합계에 더하지 않음"
        />
        <SummaryCell
          label="저장 평가액 대조"
          value={reconciliationLabel(model)}
          detail={reconciliationDetail(model)}
        />
      </div>

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        현재 자산 연결 {model.positionCount - model.legacyOnlyCount}행 · 레거시
        전용 {model.legacyOnlyCount}행 · 중복 근거 {model.duplicateIdentityCount}행
        {model.rowLimitExceeded
          ? ` · 최대 ${model.policy.rowLimit}행만 표시`
          : ""}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1380px] border-separate border-spacing-0 text-left text-sm">
          <thead className="text-xs text-[#687064]">
            <tr>
              <TableHeader>종목</TableHeader>
              <TableHeader>근거 상태</TableHeader>
              <TableHeader>시장 / 통화</TableHeader>
              <TableHeader align="right">수량</TableHeader>
              <TableHeader align="right">저장 현재가</TableHeader>
              <TableHeader align="right">현지 평가액</TableHeader>
              <TableHeader align="right">원화 평가액</TableHeader>
              <TableHeader align="right">비용 기준</TableHeader>
              <TableHeader align="right">손익</TableHeader>
              <TableHeader align="right">저장 비중</TableHeader>
              <TableHeader>가격 근거</TableHeader>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, index) => (
              <PositionRow
                key={`${row.ticker ?? "tickerless"}:${row.assetName}:${index}`}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        이 상세는 선택한 날짜·계정·출처의 저장 포지션만 표시합니다. 실시간
        가격, 현재 자산 이름, ETF 내부 구성, 목표 비중, 추천 또는 주문 정보로
        보완하지 않습니다.
      </p>
    </>
  );
}

function PositionRow({ row }: { row: HistoryPositionDisplayRow }) {
  return (
    <tr
      data-history-position-row
      data-history-position-mapping={row.mappingStatus}
      data-history-position-evidence={row.evidenceStatus}
      className="border-t border-[#e1e6dc]"
    >
      <TableCell strong>
        <span className="block">{row.ticker ?? "티커 없음"}</span>
        <span className="mt-1 block text-xs font-normal text-[#687064]">
          {row.assetName}
        </span>
      </TableCell>
      <TableCell>
        <span className="block">{mappingLabel(row.mappingStatus)}</span>
        <span className="mt-1 block text-xs text-[#687064]">
          {evidenceLabel(row)}
        </span>
      </TableCell>
      <TableCell>
        {[row.market, row.currency].filter(Boolean).join(" / ") || "n/a"}
      </TableCell>
      <TableCell align="right">{formatNumber(row.quantity)}</TableCell>
      <TableCell align="right">{formatNumber(row.currentPrice)}</TableCell>
      <TableCell align="right">
        {formatNumber(row.marketValueLocal)}
      </TableCell>
      <TableCell align="right">{formatHistoryKrw(row.marketValueKrw)}</TableCell>
      <TableCell align="right">{formatHistoryKrw(row.costKrw)}</TableCell>
      <TableCell align="right">
        <span className="block">{formatHistoryKrw(row.pnlKrw)}</span>
        <span className="mt-1 block text-xs text-[#687064]">
          {formatPercent(row.pnlPct)}
        </span>
      </TableCell>
      <TableCell align="right">{formatPercent(row.currentWeight)}</TableCell>
      <TableCell>
        <span className="block">{row.priceSource ?? "n/a"}</span>
        <span className="mt-1 block text-xs text-[#687064]">
          {row.priceBasis ?? "basis n/a"}
        </span>
      </TableCell>
    </tr>
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
    <div className="border-b border-[#e1e6dc] px-3 py-3 sm:border-r lg:border-b-0 lg:last:border-r-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
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

function statusMessage(model: HistoryPositionDetailModel) {
  if (model.reason === "not_requested") {
    return model.account === "all"
      ? "전체 합산 행은 여러 계정의 표시용 결과일 수 있어 상세 대상으로 사용하지 않습니다. 증권, ISA 또는 IRP 계정을 선택하세요."
      : "아래 포트폴리오 기록에서 보유 상세를 선택하세요.";
  }
  if (model.reason === "named_account_required") {
    return "전체 합산 행은 상세 대상으로 사용할 수 없습니다. 증권, ISA 또는 IRP 계정을 선택하세요.";
  }
  if (model.reason === "portfolio_lane_required") {
    return "보유 상세는 포트폴리오 기록 화면에서만 확인할 수 있습니다.";
  }
  if (model.reason === "invalid_parameters") {
    return "보유 상세 선택값이 올바르지 않습니다. 포트폴리오 기록의 상세 버튼을 다시 선택하세요.";
  }
  if (model.reason === "no_matching_portfolio_snapshot") {
    return "선택한 날짜·계정·출처에 해당하는 저장 포트폴리오 행이 없습니다.";
  }
  if (model.reason === "no_compatible_position_rows") {
    return "같은 날짜·계정·출처의 저장 포지션 행이 없어 다른 출처의 행을 섞지 않았습니다.";
  }
  return "선택한 저장점에 포지션 상세 행이 없습니다.";
}

function reconciliationLabel(model: HistoryPositionDetailModel) {
  if (model.reconciliationStatus === "matched") return "일치";
  if (model.reconciliationStatus === "mismatch") return "차이 있음";
  return "비교 불가";
}

function reconciliationDetail(model: HistoryPositionDetailModel) {
  if (model.reconciliationDifferenceKrw === null) {
    return "누락·행 제한 시 판단하지 않음";
  }
  return `포지션 합계 - 저장 평가액 ${formatHistoryKrw(model.reconciliationDifferenceKrw)}`;
}

function mappingLabel(
  status: HistoryPositionDisplayRow["mappingStatus"],
) {
  return status === "current_asset_mapped" ? "현재 자산 연결" : "레거시 전용";
}

function evidenceLabel(row: HistoryPositionDisplayRow) {
  if (row.evidenceStatus === "duplicate_identity") return "중복 근거";
  if (row.evidenceStatus === "invalid_identity") return "식별 근거 불완전";
  if (row.valuationStatus === "missing_market_value") return "평가액 없음";
  return "저장값";
}

function formatNumber(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "n/a"
    : NUMBER_FORMATTER.format(value);
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "n/a"
    : `${PERCENT_FORMATTER.format(value)}%`;
}

function clearDetailHref(model: HistoryPositionDetailModel) {
  const params = new URLSearchParams({
    account: model.account,
    lane: model.lane,
  });
  return `/history?${params.toString()}`;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
