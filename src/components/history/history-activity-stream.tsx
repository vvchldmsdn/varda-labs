import type { TenantEventLedgerQueryResult } from "@/db/queries/tenant-events";

import { formatHistoryKrw } from "./history-format";

export function HistoryActivityStream({
  result,
  supported,
}: {
  result: TenantEventLedgerQueryResult | null;
  supported: boolean;
}) {
  const events =
    result?.state === "ready" || result?.state === "partial"
      ? result.events.slice(0, 8)
      : [];

  return (
    <section className="border-b border-[#dde1db] py-8" aria-labelledby="history-activity-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#777d75]">ACTIVITY TAPE</p>
          <h2 id="history-activity-title" className="mt-1 text-xl font-semibold">
            기록된 활동
          </h2>
        </div>
        <p className="text-xs text-[#777d75]">
          {events.length > 0 ? `최근 ${events.length}건` : "저장 이벤트 기준"}
        </p>
      </div>

      {events.length > 0 ? (
        <ol className="mt-6 divide-y divide-[#e1e4df] border-y border-[#e1e4df]">
          {events.map((event, index) => (
            <li
              key={`${event.eventDate}:${event.eventType}:${event.assetName}:${index}`}
              className="grid gap-3 py-4 sm:grid-cols-[110px_1fr_auto] sm:items-center"
            >
              <time className="text-xs tabular-nums text-[#72786f]">
                {event.eventDate.replaceAll("-", ".")}
              </time>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {event.assetName}
                </p>
                <p className="mt-1 text-xs text-[#777d75]">
                  {eventTypeLabel(event.eventType)} · {event.accountName}
                  {event.groupName ? ` · ${event.groupName}` : ""}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums sm:text-right">
                {event.amountKrw === null
                  ? quantityLabel(event.quantityDelta)
                  : signedKrw(event.amountKrw)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 border-y border-[#e1e4df] py-8 text-sm leading-6 text-[#747a72]">
          {!supported
            ? "이 자산그룹의 이벤트 포함 규칙은 아직 정의되지 않아 계좌 이벤트를 임의로 합산하지 않습니다."
            : result?.state === "integrity_error"
              ? "이벤트와 계정 소유권 관계가 일치하지 않아 활동 표시를 차단했습니다."
              : result?.state === "unavailable"
                ? "이벤트 기록을 현재 읽을 수 없습니다."
                : "이 범위에 연결된 저장 이벤트가 없습니다."}
        </p>
      )}
      <p className="mt-3 text-xs leading-5 text-[#858a83]">
        이벤트는 활동 맥락으로 표시하며 같은 날의 평가액 변화에 자동 귀속하지 않습니다.
      </p>
    </section>
  );
}

function eventTypeLabel(eventType: string) {
  if (eventType === "buy") return "매수";
  if (eventType === "sell") return "매도";
  if (eventType === "asset_added") return "자산 추가";
  if (eventType === "asset_removed") return "자산 제외";
  return eventType;
}

function signedKrw(value: number) {
  if (value === 0) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatHistoryKrw(Math.abs(value))}`;
}

function quantityLabel(value: number | null) {
  if (value === null) return "금액 기록 없음";
  return `${value > 0 ? "+" : ""}${value.toLocaleString("ko-KR")}주`;
}
