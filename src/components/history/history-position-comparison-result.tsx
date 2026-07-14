import Link from "next/link";

import type {
  HistoryPositionComparisonEndpointSummary,
  HistoryPositionComparisonModel,
  HistoryPositionComparisonRow,
} from "@/lib/history-position-comparison";

import {
  formatHistoryKrw,
  formatHistoryNumber,
  historySourceLabel,
} from "./history-format";
import {
  HistoryEvidenceSummaryCell as SummaryCell,
  HistoryTableCell as TableCell,
  HistoryTableHeader as TableHeader,
} from "./history-evidence-primitives";

export function HistoryPositionComparisonResult({
  model,
}: {
  model: HistoryPositionComparisonModel;
}) {
  return (
    <>
      {model.status === "partial" ? (
        <p className="mt-3 border border-[#eadfc7] bg-[#fff8e7] px-3 py-2 text-sm text-[#6f561c]">
          일부 저장 근거가 중복되었거나 비어 있습니다. 확인 가능한 변화만
          표시하고, 판단할 수 없는 행은 미확인으로 남깁니다.
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {model.from ? (
          <EndpointEvidence label="이전 저장점" endpoint={model.from} />
        ) : null}
        {model.to ? (
          <EndpointEvidence label="이후 저장점" endpoint={model.to} />
        ) : null}
      </div>

      <ChangeSummary model={model} />
      <ComparisonTable rows={model.rows} />

      <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-[#687064] sm:flex-row sm:items-start sm:justify-between">
        <p>
          저장 평가액 변화는 수익률·손익 또는 이벤트 원인을 뜻하지 않습니다.
          실시간 가격, 현재 환율, 보간값을 섞지 않았습니다.
        </p>
        <Link
          href={eventHistoryHref(model)}
          className="w-fit font-semibold text-[#1e3a34] underline underline-offset-2"
        >
          이벤트 기록은 별도 연대기로 보기
        </Link>
      </div>
    </>
  );
}

function EndpointEvidence({
  label,
  endpoint,
}: {
  label: string;
  endpoint: HistoryPositionComparisonEndpointSummary;
}) {
  return (
    <div className="border border-[#e1e6dc] bg-white p-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-sm font-semibold">
        {endpoint.snapshotDate} · {historySourceLabel(endpoint.source)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <EvidenceValue
          label="포트폴리오 저장 평가액"
          value={formatHistoryKrw(endpoint.portfolioTotalMarketValueKrw)}
        />
        <EvidenceValue
          label="포지션 저장 합계"
          value={formatHistoryKrw(endpoint.positionMarketValueKrw)}
        />
        <EvidenceValue
          label="저장 현금"
          value={formatHistoryKrw(endpoint.portfolioCashValueKrw)}
        />
        <EvidenceValue
          label="저장 평가액 대조"
          value={reconciliationLabel(endpoint)}
        />
        <EvidenceValue
          label="수량 근거"
          value={`${endpoint.quantityPositionCount}/${endpoint.positionCount}행`}
        />
        <EvidenceValue
          label="평가액 근거"
          value={`${endpoint.valuedPositionCount}/${endpoint.positionCount}행`}
        />
      </dl>
    </div>
  );
}

function EvidenceValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[#687064]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#171916]">{value}</dd>
    </div>
  );
}

function ChangeSummary({ model }: { model: HistoryPositionComparisonModel }) {
  return (
    <div className="mt-3 grid border-t border-[#e1e6dc] sm:grid-cols-2 lg:grid-cols-5">
      <SummaryCell
        label="추가"
        value={String(model.addedCount)}
        detail="이후 저장점에만 있음"
      />
      <SummaryCell
        label="제거"
        value={String(model.removedCount)}
        detail="이전 저장점에만 있음"
      />
      <SummaryCell
        label="변경"
        value={String(model.changedCount)}
        detail="수량·평가액·저장 메타 변화"
      />
      <SummaryCell
        label="동일"
        value={String(model.unchangedCount)}
        detail="두 저장 근거가 같음"
      />
      <SummaryCell
        label="미확인"
        value={String(model.unresolvedCount)}
        detail="중복 또는 식별 근거 없음"
      />
    </div>
  );
}

function ComparisonTable({
  rows,
}: {
  rows: readonly HistoryPositionComparisonRow[];
}) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs text-[#687064]">
          <tr>
            <TableHeader>변화</TableHeader>
            <TableHeader>종목</TableHeader>
            <TableHeader>시장 / 통화</TableHeader>
            <TableHeader>저장 참조</TableHeader>
            <TableHeader align="right">이전 수량</TableHeader>
            <TableHeader align="right">이후 수량</TableHeader>
            <TableHeader align="right">수량 변화</TableHeader>
            <TableHeader align="right">이전 평가액</TableHeader>
            <TableHeader align="right">이후 평가액</TableHeader>
            <TableHeader align="right">저장 평가액 변화</TableHeader>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <ComparisonRow
              key={`${row.ticker ?? "tickerless"}:${row.assetName}:${index}`}
              row={row}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonRow({ row }: { row: HistoryPositionComparisonRow }) {
  return (
    <tr
      data-history-position-comparison-row="true"
      data-history-position-comparison-kind={row.changeKind}
      data-history-position-comparison-evidence={row.evidenceStatus}
    >
      <TableCell strong>
        <span className="block">{changeKindLabel(row.changeKind)}</span>
        <span className="mt-1 block text-xs font-normal text-[#687064]">
          {changeReasonLabel(row)}
        </span>
      </TableCell>
      <TableCell strong>
        <span className="block">{row.ticker ?? "티커 없음"}</span>
        <span className="mt-1 block text-xs font-normal text-[#687064]">
          {row.assetName}
        </span>
      </TableCell>
      <TableCell>
        {[row.market, row.currency].filter(Boolean).join(" / ") || "n/a"}
      </TableCell>
      <TableCell>
        {referenceLabel(row.fromReferenceStatus)} → {referenceLabel(row.toReferenceStatus)}
      </TableCell>
      <TableCell align="right">
        {formatHistoryNumber(row.fromQuantity)}
      </TableCell>
      <TableCell align="right">
        {formatHistoryNumber(row.toQuantity)}
      </TableCell>
      <TableCell align="right">
        {formatSignedNumber(row.quantityChange)}
      </TableCell>
      <TableCell align="right">
        {formatHistoryKrw(row.fromMarketValueKrw)}
      </TableCell>
      <TableCell align="right">
        {formatHistoryKrw(row.toMarketValueKrw)}
      </TableCell>
      <TableCell align="right">
        {formatSignedKrw(row.marketValueChangeKrw)}
      </TableCell>
    </tr>
  );
}

function reconciliationLabel(
  endpoint: HistoryPositionComparisonEndpointSummary,
) {
  if (endpoint.reconciliationStatus === "matched") return "일치";
  if (endpoint.reconciliationStatus === "mismatch") {
    return `차이 ${formatHistoryKrw(endpoint.reconciliationDifferenceKrw)}`;
  }
  return "비교 불가";
}

function changeKindLabel(kind: HistoryPositionComparisonRow["changeKind"]) {
  if (kind === "added") return "추가";
  if (kind === "removed") return "제거";
  if (kind === "changed") return "변경";
  if (kind === "unchanged") return "동일";
  return "미확인";
}

function changeReasonLabel(row: HistoryPositionComparisonRow) {
  if (row.evidenceStatus === "duplicate_identity") return "중복 저장 근거";
  if (row.evidenceStatus === "invalid_identity") return "식별 근거 없음";
  if (row.changeReasons.includes("presence")) return "보유 여부 변화";
  const labels = row.changeReasons.map((reason) => {
    if (reason === "quantity") return "수량";
    if (reason === "market_value") return "평가액";
    if (reason === "reference_status") return "저장 참조";
    if (reason === "display_metadata") return "표시 정보";
    return "식별 근거";
  });
  return labels.length > 0 ? labels.join(" · ") : "저장 근거 동일";
}

function referenceLabel(
  status: HistoryPositionComparisonRow["fromReferenceStatus"],
) {
  if (status === "stored_asset_reference") return "저장 자산 참조";
  if (status === "legacy_only") return "레거시 전용";
  return "없음";
}

function formatSignedNumber(value: number | null) {
  if (value === null) return "n/a";
  const formatted = formatHistoryNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "n/a";
  const formatted = formatHistoryKrw(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : formatted;
}

function eventHistoryHref(model: HistoryPositionComparisonModel) {
  return `/history?${new URLSearchParams({
    account: model.account,
    lane: "events",
  }).toString()}`;
}
