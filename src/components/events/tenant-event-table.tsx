import type { TenantEventLedgerDto } from "@/lib/tenant-event-ledger-read-model";

const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  buy: "매수",
  sell: "매도",
  asset_added: "자산 추가",
  asset_removed: "자산 제외",
});

const krw = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

export function TenantEventTable({
  events,
}: {
  events: readonly TenantEventLedgerDto[];
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded-md border border-[var(--line)] bg-white">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-[var(--wash)] text-xs text-[var(--muted)]">
          <tr>
            <th className="px-4 py-3 font-semibold">날짜</th>
            <th className="px-4 py-3 font-semibold">이벤트</th>
            <th className="px-4 py-3 font-semibold">종목</th>
            <th className="px-4 py-3 font-semibold">계정</th>
            <th className="px-4 py-3 text-right font-semibold">금액</th>
            <th className="px-4 py-3 text-right font-semibold">수량</th>
            <th className="px-4 py-3 font-semibold">근거 상태</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--wash)]">
          {events.map((event, index) => (
            <tr
              key={`${event.accountCode}:${event.eventDate}:${event.recordedAt ?? "none"}:${event.eventType}:${event.ticker ?? event.assetName}:${index}`}
            >
              <td className="px-4 py-3 tabular-nums">
                <p className="font-semibold">{event.eventDate}</p>
                <p className="text-xs text-[var(--muted)]">
                  {formatRecordedAt(event.recordedAt)}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold">
                  {EVENT_LABELS[event.eventType] ?? event.eventType}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {event.source ?? "출처 없음"}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold">{event.assetName}</p>
                <p className="text-xs text-[var(--muted)]">
                  {event.ticker ?? "티커 없음"}
                  {event.groupName ? ` / ${event.groupName}` : ""}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold">{event.accountName}</p>
                <p className="text-xs text-[var(--muted)]">{event.accountCode}</p>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {event.amountKrw === null ? "-" : krw.format(event.amountKrw)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {event.quantityDelta ?? "-"}
              </td>
              <td className="px-4 py-3 text-xs text-[var(--muted)]">
                <p className="font-semibold text-[var(--ink)]">
                  {event.evidenceStatus === "complete" ? "완전" : "부분"}
                </p>
                <p>{assetReferenceLabel(event.assetReferenceStatus)}</p>
                {event.correctionStatus !== "none" ? (
                  <p>정정 대상 미검증</p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatRecordedAt(value: string | null) {
  if (value === null) return "기록 시각 없음";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function assetReferenceLabel(
  value: TenantEventLedgerDto["assetReferenceStatus"],
) {
  if (value === "stored_asset_reference") return "현재 자산 연결";
  if (value === "legacy_only") return "레거시 자산 근거";
  return "자산 연결 없음";
}
