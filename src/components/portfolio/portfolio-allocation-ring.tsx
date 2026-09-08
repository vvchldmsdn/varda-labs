"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";


import { useState, type CSSProperties } from "react";
import styles from "../portfolio-structure/allocation-ring.module.css";

type Entry = Readonly<{ key: string; name: string; weightPct: number }>;
const COLORS = ["#ef5a32", "#343932", "#cca17b", "#8c9f89", "#697f8c", "#c98e76", "#9a96a8", "#bbbcaa"];
const TAU = Math.PI * 2;

export function PortfolioAllocationRing({ entries, selectedKey, onSelect }: {
  entries: readonly Entry[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const pt = usePortfolioText();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const active = entries.find((entry) => entry.key === (hoveredKey ?? selectedKey)) ?? entries[0];
  const positive = entries.filter((entry) => Number.isFinite(entry.weightPct) && entry.weightPct > 0);
  const total = positive.reduce((sum, entry) => sum + entry.weightPct, 0);
  const segments = positive.map((entry, index) => {
    const span = entry.weightPct / total * TAU;
    const start = positive.slice(0, index).reduce(
      (angle, previous) => angle + previous.weightPct / total * TAU,
      -Math.PI / 2,
    );
    return { ...entry, start, span, color: COLORS[index % COLORS.length] };
  });

  return (
    <div className={styles.ring} data-allocation-ring onPointerLeave={() => setHoveredKey(null)}>
      <svg className={styles.svg} viewBox="0 0 520 520" role="group" aria-label={pt("보유 종목별 평가액 비중")}>
        {segments.length === 0 ? <circle cx="260" cy="260" r="185" fill="none" stroke="var(--line)" strokeWidth="52" /> : null}
        {segments.map((segment, index) => {
          const middle = segment.start + segment.span / 2;
          const lifted = active?.key === segment.key;
          return (
            <g key={segment.key} className={styles.segmentEntry} style={{ "--segment-delay": `${Math.min(index, 8) * 24}ms` } as CSSProperties}>
              <path
                className={styles.segment}
                d={roundedSector(segment.start, segment.span, segments.length === 1)}
                fill={segment.color}
                role="button"
                tabIndex={0}
                aria-label={`${segment.name} ${segment.weightPct.toFixed(2)}%`}
                aria-pressed={selectedKey === segment.key}
                data-active={lifted}
                data-share={segment.weightPct / total}
                style={{
                  "--lift-x": `${(Math.cos(middle) * 9).toFixed(3)}px`,
                  "--lift-y": `${(Math.sin(middle) * 9).toFixed(3)}px`,
                  opacity: hoveredKey && !lifted ? .6 : 1,
                } as CSSProperties}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") setHoveredKey(segment.key); }}
                onFocus={() => setHoveredKey(segment.key)}
                onBlur={() => setHoveredKey(null)}
                onClick={() => { setHoveredKey(null); onSelect(segment.key); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(segment.key);
                  }
                  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
                    event.preventDefault();
                    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
                    const buttons = event.currentTarget.ownerSVGElement?.querySelectorAll<SVGPathElement>('[role="button"]');
                    buttons?.[(index + direction + segments.length) % segments.length]?.focus();
                  }
                }}
              />
            </g>
          );
        })}
      </svg>
      <div className={styles.center}>
        <span className={styles.centerLabel}><PortfolioText ko={hoveredKey ? "살펴보는 종목" : "선택한 종목"} /></span>
        <div key={active?.key} className={styles.centerValue}>
          <strong>{active && Number.isFinite(active.weightPct) ? <>{active.weightPct.toFixed(2)}<small>%</small></> : "—"}</strong>
          <p>{active?.name ?? <PortfolioText ko="보유 종목 없음" />}</p>
        </div>
      </div>
      <p className={styles.hint}><PortfolioText ko={"조각을 선택해 비중과 목표를 비교하세요"} /></p>
    </div>
  );
}

function point(radius: number, angle: number) {
  return `${(260 + radius * Math.cos(angle)).toFixed(3)},${(260 + radius * Math.sin(angle)).toFixed(3)}`;
}

// Rounding stays inside each value's angular sector. No cap extends into a
// neighbour and no minimum angle exaggerates a very small holding.
function roundedSector(start: number, span: number, fullCircle: boolean) {
  const outer = 220;
  const inner = 153;
  const middle = (outer + inner) / 2;
  if (fullCircle) {
    return `M260,40 A220,220 0 1 1 260,480 A220,220 0 1 1 260,40 M260,107 A153,153 0 1 0 260,413 A153,153 0 1 0 260,107 Z`;
  }
  const gap = Math.min(.022, span * .08);
  const a = start + gap / 2;
  const b = start + span - gap / 2;
  const corner = Math.min(.105, (b - a) / 4);
  const large = b - a - corner * 2 > Math.PI ? 1 : 0;
  return [
    `M${point(outer, a + corner)}`,
    `A${outer},${outer} 0 ${large} 1 ${point(outer, b - corner)}`,
    `Q${point(outer, b)} ${point(middle, b)}`,
    `Q${point(inner, b)} ${point(inner, b - corner)}`,
    `A${inner},${inner} 0 ${large} 0 ${point(inner, a + corner)}`,
    `Q${point(inner, a)} ${point(middle, a)}`,
    `Q${point(outer, a)} ${point(outer, a + corner)} Z`,
  ].join(" ");
}
