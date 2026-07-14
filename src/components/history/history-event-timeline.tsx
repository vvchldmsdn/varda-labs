import type {
  HistoryEventDisplayRow,
  HistoryEventMissingField,
  HistoryEventTimelineModel,
} from "@/lib/history-event-timeline";

import {
  formatHistoryDateRange,
  formatHistoryKrw,
  historyAccountLabel,
  historySourceLabel,
} from "./history-format";
import {
  HistoryEvidenceSummaryCell as SummaryCell,
  HistoryTableCell as TableCell,
  HistoryTableHeader as TableHeader,
} from "./history-evidence-primitives";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 8,
});
const RECORDED_AT_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export function HistoryEventTimeline({
  model,
}: {
  model: HistoryEventTimelineModel;
}) {
  return (
    <div
      data-history-event-timeline
      data-history-event-status={model.status}
      data-history-event-reason={model.reason}
      data-history-event-count={model.eventCount}
      data-history-event-trades={model.tradeCount}
      data-history-event-lifecycle={model.lifecycleCount}
      data-history-event-partial={model.partialCount}
      data-history-event-legacy-only={model.legacyOnlyCount}
      data-history-event-corrections={model.correctionCount}
      data-history-event-policy={model.policy.version}
      className="mt-3"
    >
      <p className="border border-[#eadfc7] bg-[#fff8e7] px-3 py-2 text-sm leading-6 text-[#6f561c]">
        이벤트 일자는 저장된 이벤트 달력일이며 스냅샷 기준일·서비스
        사이클과 별개입니다. 같은 기간에 함께 보이더라도 평가액 변동의
        원인이나 성과 기여로 단정하지 않습니다.
      </p>

      {model.status === "ready" || model.status === "partial" ? (
        <ReadyTimeline model={model} />
      ) : (
        <p className="mt-3 bg-white px-3 py-3 text-sm leading-6 text-[#687064]">
          {statusMessage(model)}
        </p>
      )}
    </div>
  );
}

function ReadyTimeline({ model }: { model: HistoryEventTimelineModel }) {
  return (
    <>
      {model.status === "partial" ? (
        <p className="mt-3 border border-[#eadfc7] bg-[#fff8e7] px-3 py-2 text-sm text-[#6f561c]">
          일부 이벤트 근거가 불완전합니다. 확인 가능한 저장 행은 유지하며
          금액을 복원하거나 정정 이벤트를 상계하지 않습니다.
        </p>
      ) : null}

      <div className="mt-3 grid border-t border-[#e1e6dc] sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCell
          label="표시 이벤트"
          value={`${model.eventCount}건`}
          detail={formatHistoryDateRange(model.dateRange)}
        />
        <SummaryCell
          label="이벤트 구성"
          value={`거래 ${model.tradeCount} · 상태 ${model.lifecycleCount}`}
          detail={`${historyAccountLabel(model.account)} 계정 저장값`}
        />
        <SummaryCell
          label="자산 참조"
          value={`레거시 전용 ${model.legacyOnlyCount}`}
          detail="현재 자산 조인 없이 저장 참조만 판정"
        />
        <SummaryCell
          label="근거 상태"
          value={`부분 ${model.partialCount} · 정정 ${model.correctionCount}`}
          detail={
            model.rowLimitExceeded
              ? `최대 ${model.policy.rowLimit}건만 표시`
              : "정정 상계 없음"
          }
        />
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-left text-sm">
          <thead className="text-xs text-[#687064]">
            <tr>
              <TableHeader>이벤트 일자</TableHeader>
              <TableHeader>기록 시각</TableHeader>
              <TableHeader>유형 / 근거</TableHeader>
              <TableHeader>종목</TableHeader>
              <TableHeader>자산 참조</TableHeader>
              <TableHeader align="right">저장 금액</TableHeader>
              <TableHeader align="right">수량 변화</TableHeader>
              <TableHeader align="right">저장 단가</TableHeader>
              <TableHeader align="right">저장 환율</TableHeader>
              <TableHeader>출처 / 규칙</TableHeader>
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, index) => (
              <EventRow
                key={`${row.eventDate}:${row.eventType}:${row.ticker ?? "tickerless"}:${index}`}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        계정 미귀속 이벤트와 다른 계정 이벤트는 포함하지 않습니다. 현재
        자산·현재 가격·fallback 환율로 과거 금액을 보완하지 않으며, 기간
        수익률·TWR·성과 기여를 계산하지 않습니다.
      </p>
    </>
  );
}

function EventRow({ row }: { row: HistoryEventDisplayRow }) {
  return (
    <tr
      data-history-event-row
      data-history-event-evidence={row.evidenceStatus}
      data-history-event-reference={row.assetReferenceStatus}
      data-history-event-correction={row.correctionStatus}
    >
      <TableCell strong>{row.eventDate}</TableCell>
      <TableCell>{formatRecordedAt(row.recordedAt)}</TableCell>
      <TableCell>
        <span className="block font-semibold">{eventTypeLabel(row)}</span>
        <span className="mt-1 block text-xs text-[#687064]">
          {evidenceLabel(row)}
        </span>
      </TableCell>
      <TableCell>
        <span className="block font-semibold">{row.ticker ?? "티커 없음"}</span>
        <span className="mt-1 block text-xs text-[#687064]">
          {row.assetName}
          {row.groupName ? ` · ${row.groupName}` : ""}
        </span>
      </TableCell>
      <TableCell>
        <span className="block">{assetReferenceLabel(row)}</span>
        {row.correctionStatus !== "none" ? (
          <span className="mt-1 block text-xs text-[#8a5a12]">
            정정 참조 별도 보존
          </span>
        ) : null}
      </TableCell>
      <TableCell align="right">{formatHistoryKrw(row.amountKrw)}</TableCell>
      <TableCell align="right">{formatNumber(row.quantityDelta)}</TableCell>
      <TableCell align="right">{formatNumber(row.price)}</TableCell>
      <TableCell align="right">{formatNumber(row.fxRate)}</TableCell>
      <TableCell>
        <span className="block">
          {row.source ? historySourceLabel(row.source) : "출처 없음"}
        </span>
        <span className="mt-1 block text-xs text-[#687064]">
          {row.ruleVersion ?? "규칙 버전 없음"}
        </span>
      </TableCell>
    </tr>
  );
}

function statusMessage(model: HistoryEventTimelineModel) {
  if (model.reason === "named_account_required") {
    return "전체 합산과 계정 미귀속 이벤트는 v1 타임라인에 포함하지 않습니다. 증권, ISA 또는 IRP 계정을 선택하세요.";
  }
  if (model.reason === "no_compatible_event_rows") {
    return "선택 계정과 정확히 일치하는 저장 이벤트가 없어 다른 계정 행을 섞지 않았습니다.";
  }
  return "선택 계정에 저장된 이벤트가 없습니다.";
}

function eventTypeLabel(row: HistoryEventDisplayRow) {
  if (row.eventType === "buy") return "매수";
  if (row.eventType === "sell") return "매도";
  if (row.eventType === "asset_added") return "자산 추가";
  if (row.eventType === "asset_removed") return "자산 제거";
  return row.eventType;
}

function evidenceLabel(row: HistoryEventDisplayRow) {
  if (row.evidenceStatus === "complete") return "저장 근거 완전";
  if (row.evidenceStatus === "duplicate_identity") return "중복 식별 근거";
  return row.missingFields.map(missingFieldLabel).join(", ") || "부분 근거";
}

function missingFieldLabel(field: HistoryEventMissingField) {
  const labels: Record<HistoryEventMissingField, string> = {
    event_date: "이벤트 일자 누락",
    event_type: "유형 누락",
    asset_name: "이름 누락",
    event_identity: "식별 근거 누락",
    asset_reference: "자산 참조 누락",
    amount_krw: "금액 누락",
    quantity_delta: "수량 누락",
    price: "단가 누락",
    unknown_event_type: "미지원 유형",
    correction_target_unverified: "정정 대상 미검증",
  };
  return labels[field];
}

function assetReferenceLabel(row: HistoryEventDisplayRow) {
  if (row.assetReferenceStatus === "stored_asset_reference") {
    return "저장 자산 참조";
  }
  if (row.assetReferenceStatus === "legacy_only") return "레거시 전용";
  return "참조 없음";
}

function formatRecordedAt(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? RECORDED_AT_FORMATTER.format(date)
    : "n/a";
}

function formatNumber(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "n/a"
    : NUMBER_FORMATTER.format(value);
}
