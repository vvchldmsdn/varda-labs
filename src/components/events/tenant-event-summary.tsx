import type { TenantEventLedgerReadResult } from "@/lib/tenant-event-ledger-read-model";

type EventEvidence = Extract<
  TenantEventLedgerReadResult,
  { state: "ready" | "partial" }
>;

export function TenantEventSummary({ result }: { result: EventEvidence }) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryItem label="연결된 이벤트" value={`${result.eventCount}건`} />
      <SummaryItem
        label="거래 / 자산 상태"
        value={`${result.tradeCount} / ${result.lifecycleCount}`}
      />
      <SummaryItem label="불완전 근거" value={`${result.partialCount}건`} />
      <SummaryItem label="기간" value={formatDateRange(result.dateRange)} />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatDateRange({
  minDate,
  maxDate,
}: EventEvidence["dateRange"]) {
  if (minDate === null || maxDate === null) return "확인 불가";
  return minDate === maxDate ? minDate : `${minDate} - ${maxDate}`;
}
