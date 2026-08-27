"use client";

import { formatHistoryKrw } from "@/components/history/history-format";
import type { HistoryOverviewPoint } from "@/lib/history-overview";

export function HistorySnapshotRail({
  onSelect,
  points,
  selectedDate,
}: {
  onSelect: (date: string) => void;
  points: readonly HistoryOverviewPoint[];
  selectedDate: string | null;
}) {
  const descending = [...points].reverse();

  return (
    <aside className="min-w-0 border-t border-[#dde1db] lg:border-l lg:border-t-0 lg:pl-6">
      <div className="flex items-end justify-between border-b border-[#dde1db] py-4 lg:pt-0">
        <div>
          <p className="text-[11px] font-medium text-[#777d75]">SNAPSHOTS</p>
          <h2 className="mt-1 text-base font-semibold">날짜별 기록</h2>
        </div>
        <p className="text-[11px] tabular-nums text-[#858a83]">
          {points.length}개
        </p>
      </div>

      <div className="max-h-[430px] overflow-y-auto overscroll-contain pr-1 lg:h-[430px]">
        {descending.map((point) => {
          const active = point.date === selectedDate;
          return (
            <button
              key={point.date}
              type="button"
              aria-pressed={active}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-[#e5e8e3] border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#347e62] ${
                active
                  ? "border-l-[#d66758] bg-[#f6eeeb]"
                  : "border-l-transparent hover:bg-[#f1f3ef]"
              }`}
              onClick={() => onSelect(point.date)}
            >
              <span className="text-sm font-semibold tabular-nums">
                {formatDate(point.date)}
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                {formatCompactKrw(point.valueKrw)}
              </span>
              <span className="mt-1 text-[11px] text-[#7c827a]">
                {point.events.length > 0
                  ? `활동 ${point.events.length}건`
                  : rowKindLabel(point.rowKind)}
              </span>
              <span
                className={`mt-1 text-right text-xs font-medium tabular-nums ${tone(point.movementKrw)}`}
              >
                {formatSignedKrw(point.movementKrw)}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function rowKindLabel(rowKind: HistoryOverviewPoint["rowKind"]) {
  if (rowKind === "stored") return "저장값";
  if (rowKind === "partial") return "부분 합산";
  return "표시용 합산";
}

function formatCompactKrw(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `₩${(value / 100_000_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `₩${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  }
  return formatHistoryKrw(value);
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "첫 기록";
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatCompactKrw(Math.abs(value))}`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.5) return "text-[#666d65]";
  return value > 0 ? "text-[#347e62]" : "text-[#cb5551]";
}
