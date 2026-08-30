"use client";

import { useState } from "react";

type Entry = Readonly<{ key: string; name: string; weightPct: number }>;
const COLORS = [
  "var(--brand)",
  "var(--ink)",
  "var(--brand-mid)",
  "var(--chart-teal)",
  "var(--secondary)",
  "var(--negative-mid)",
  "var(--faint)",
  "var(--brand-soft)",
];

export function PortfolioAllocationRing({
  entries,
  selectedKey,
  onSelect,
}: {
  entries: readonly Entry[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const active =
    entries.find((entry) => entry.key === (hoveredKey ?? selectedKey)) ??
    entries[0];
  const positive = entries.filter(
    (entry) => Number.isFinite(entry.weightPct) && entry.weightPct > 0,
  );
  const total = positive.reduce((sum, entry) => sum + entry.weightPct, 0);
  const segments = positive.map((entry, index) => ({
    ...entry,
    start:
      (positive.slice(0, index).reduce((sum, item) => sum + item.weightPct, 0) /
        total) *
      100,
    share: (entry.weightPct / total) * 100,
    color: COLORS[index % COLORS.length],
  }));

  return (
    <div
      className="relative"
      data-allocation-ring
      onPointerLeave={() => setHoveredKey(null)}
    >
      <svg
        className="varda-allocation-ring block"
        viewBox="0 0 520 520"
        role="group"
        aria-label="보유 종목별 평가액 비중"
      >
        <circle
          cx="260"
          cy="260"
          r="234"
          fill="none"
          stroke="var(--line)"
          strokeWidth="0.6"
        />
        <circle
          cx="260"
          cy="260"
          r="164"
          fill="none"
          stroke="var(--line)"
          strokeWidth="0.6"
        />
        {segments.map((segment) => (
          <circle
            key={segment.key}
            role="button"
            tabIndex={0}
            aria-label={`${segment.name} ${segment.weightPct.toFixed(2)}%`}
            aria-pressed={selectedKey === segment.key}
            cx="260"
            cy="260"
            r="199"
            pathLength="100"
            fill="none"
            stroke={segment.color}
            strokeWidth={active?.key === segment.key ? 43 : 32}
            strokeDasharray={`${Math.max(0.04, segment.share - 0.55)} ${100 - Math.max(0.04, segment.share - 0.55)}`}
            strokeDashoffset={-segment.start}
            transform="rotate(-90 260 260)"
            opacity={hoveredKey && hoveredKey !== segment.key ? 0.38 : 1}
            onPointerEnter={() => setHoveredKey(segment.key)}
            onFocus={() => setHoveredKey(segment.key)}
            onBlur={() => setHoveredKey(null)}
            onClick={() => onSelect(segment.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(segment.key);
              }
            }}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-24 text-center">
        <p className="text-[10px] text-[var(--faint)]">PORTFOLIO ALLOCATION</p>
        <p className="mt-4 max-w-48 text-sm font-medium leading-6 sm:text-base">
          {active?.name ?? "보유 종목 없음"}
        </p>
        <p className="mt-3 text-4xl font-normal tabular-nums sm:text-5xl">
          {active ? `${active.weightPct.toFixed(2)}%` : "-"}
        </p>
      </div>
    </div>
  );
}
