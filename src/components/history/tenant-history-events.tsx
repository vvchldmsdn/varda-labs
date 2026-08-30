import { TenantEventSummary } from "@/components/events/tenant-event-summary";
import { TenantEventTable } from "@/components/events/tenant-event-table";
import type { TenantEventLedgerQueryResult } from "@/db/queries/tenant-events";

export function TenantHistoryEvents({
  result,
}: {
  result: TenantEventLedgerQueryResult;
}) {
  if (result.state === "ready" || result.state === "partial") {
    return (
      <>
        {result.state === "partial" ? (
          <p className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
            저장 근거가 일부 비어 있거나 표시 한도에 도달했습니다. 확인된
            이벤트는 계속 표시합니다.
          </p>
        ) : null}
        <TenantEventSummary result={result} />
        <TenantEventTable events={result.events} />
      </>
    );
  }

  const message =
    result.state === "no_data"
      ? "현재 계정 범위에 연결된 이벤트 기록이 없습니다."
      : result.state === "integrity_error"
        ? "계정 소유권 또는 이벤트 관계가 일치하지 않아 이벤트 조회를 차단했습니다."
        : "이벤트 기록을 현재 읽을 수 없습니다.";

  return (
    <p className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
      {message}
    </p>
  );
}
