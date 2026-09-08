"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";


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
    <aside className="min-w-0 border-t border-[var(--line)] lg:border-l lg:border-t-0 lg:pl-6">
      <div className="flex items-end justify-between border-b border-[var(--line)] py-4 lg:pt-0">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">SNAPSHOTS</p>
          <h2 className="mt-1 text-base font-semibold"><T ko="날짜별 기록" en="Records by date"/></h2>
        </div>
        <p className="text-[11px] tabular-nums text-[var(--faint)]">
          {points.length}<T ko="개" en=" items"/></p>
      </div>

      <div className="max-h-[430px] overflow-y-auto overscroll-contain pr-1 lg:h-[430px]">
        {descending.map((point) => {
          const active = point.date === selectedDate;
          return (
            <button
              key={point.date}
              type="button"
              aria-pressed={active}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-[var(--wash)] border-l-2 px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)] ${
                active
                  ? "border-l-[var(--brand)] bg-[var(--brand-wash)]"
                  : "border-l-transparent hover:bg-[var(--wash)]"
              }`}
              onClick={() => onSelect(point.date)}
            >
              <span className="text-sm font-semibold tabular-nums">
                {<T ko={formatDate(point.date)} en={translateHomeHistory(formatDate(point.date))}/>}
              </span>
              <span className="text-right text-sm font-semibold tabular-nums">
                <T ko={formatCompactKrw(point.valueKrw)} en={formatCompactKrw(point.valueKrw, "en")}/>
              </span>
              <span className="mt-1 text-[11px] text-[var(--faint)]">
                {<T ko={point.events.length > 0
                  ? `활동 ${point.events.length}건`
                  : rowKindLabel(point.rowKind)} en={translateHomeHistory(point.events.length > 0
                  ? `활동 ${point.events.length}건`
                  : rowKindLabel(point.rowKind))}/>}
              </span>
              <span
                className={`mt-1 text-right text-xs font-medium tabular-nums ${tone(point.movementKrw)}`}
              >
                <T ko={formatSignedKrw(point.movementKrw)} en={formatSignedKrw(point.movementKrw, "en")}/>
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

function formatCompactKrw(value: number, locale: "ko" | "en" = "ko") {
  if (locale === "en") return ENGLISH_COMPACT_KRW.format(value);
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

function formatSignedKrw(value: number | null, locale: "ko" | "en" = "ko") {
  if (value === null) return locale === "en" ? "First record" : "첫 기록";
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatCompactKrw(Math.abs(value), locale)}`;
}

const ENGLISH_COMPACT_KRW = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "KRW", notation: "compact", maximumFractionDigits: 1,
});

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.5) return "text-[var(--muted)]";
  return value > 0 ? "text-[var(--brand)]" : "text-[var(--negative)]";
}
