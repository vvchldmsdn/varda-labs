"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./home-history-tooltip.module.css";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
const inset = 4;
const gap = 9;
const fit = (v: number, max: number) => Math.max(inset, Math.min(v, max - inset));

/** Length of the observed polyline inside the card's rectangle (including
 * a small gutter), with nulls delimiting separate observations. */
function coveredLine(points: (Point | null)[], left: number, top: number, card: Size) {
  const right = left + card.width + 3, bottom = top + card.height + 3;
  left -= 3;
  top -= 3;
  let covered = 0;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const prev = points[i - 1];
    if (!point || point.x < left || (prev && prev.x > right)) continue;
    if (!prev) {
      if (point.x <= right && point.y >= top && point.y <= bottom) covered += 1;
      continue;
    }
    const dx = point.x - prev.x, dy = point.y - prev.y;
    let start = dx ? Math.max(0, (left - prev.x) / dx) : 0;
    let end = dx ? Math.min(1, (right - prev.x) / dx) : 1;
    if (dy) {
      const a = (top - prev.y) / dy, b = (bottom - prev.y) / dy;
      start = Math.max(start, Math.min(a, b));
      end = Math.min(end, Math.max(a, b));
    } else if (prev.y < top || prev.y > bottom) {
      continue;
    }
    covered += Math.max(0, end - start) * Math.hypot(dx, dy);
  }
  return covered;
}

/** Follow beside the dot when possible. On a narrow plot a corner may be
 * the only place where the full line remains visible. */
export function tooltipPosition(plot: Size, card: Size, anchor: Point, points: (Point | null)[],
  visible = {top:0, bottom:plot.height}) {
  // With only a sliver of the plot visible, let the card extend into the
  // surrounding chart margin before letting the fixed navigation cover it.
  const firstY = Math.min(Math.max(0, visible.top) + inset, visible.bottom - card.height - inset);
  const lastY = Math.min(plot.height, visible.bottom) - card.height - inset;
  const xSlots = [anchor.x + gap, anchor.x - gap - card.width, inset, plot.width - card.width];
  const ySlots = [anchor.y + gap, anchor.y - gap - card.height, firstY, lastY];
  const xs = new Set(xSlots.map(x => fit(x, plot.width - card.width)));
  const ys = new Set(ySlots.map(y => Math.max(firstY, Math.min(y, lastY))));
  let best = { x: inset, y: firstY };
  let bestOverlap = Infinity, bestDistance = Infinity;
  for (const x of xs) for (const y of ys) {
    const horizontal = Math.max(0, x - anchor.x, anchor.x - x - card.width);
    const vertical = Math.max(0, y - anchor.y, anchor.y - y - card.height);
    if (horizontal < 4 && vertical < 4) continue;
    const overlap = coveredLine(points, x, y, card);
    const distance = Math.hypot(horizontal, vertical);
    if (overlap < bestOverlap || (overlap === bestOverlap && distance < bestDistance)) {
      best = { x, y };
      bestOverlap = overlap;
      bestDistance = distance;
    }
  }
  return best;
}

function useVisiblePlot() {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{height:number; top:number; bottom:number}>();
  useLayoutEffect(() => {
    const card = ref.current;
    const plot = card?.closest("[data-history-plot]");
    if (!card || !plot) return;
    const nav = document.getElementById("beta-home-navigation");
    const header = nav?.closest("aside");
    const viewport = window.visualViewport;
    const update = () => {
      const rect = plot.getBoundingClientRect();
      let top = viewport?.offsetTop ?? 0;
      let bottom = top + (viewport?.height ?? window.innerHeight);
      const heading = header?.getBoundingClientRect();
      if (heading && heading.left < rect.right && heading.right > rect.left) top = Math.max(top, heading.bottom);
      if (nav && getComputedStyle(nav).position === "fixed") bottom = Math.min(bottom, nav.getBoundingClientRect().top);
      const next = {height:card.offsetHeight, top:top - rect.top, bottom:bottom - rect.top};
      setBounds(prev => prev && prev.height === next.height && prev.top === next.top && prev.bottom === next.bottom ? prev : next);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(card);
    resize.observe(plot);
    window.addEventListener("scroll", update, {capture:true, passive:true});
    window.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    viewport?.addEventListener("resize", update);
    return () => {
      resize.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      viewport?.removeEventListener("resize", update);
    };
  }, []);
  return [ref, bounds] as const;
}

export function HomeHistoryTooltip({ id, date, returns, value, impact, plot, anchor, points }: {
  id: string; date: string; returns: boolean; value: string;
  impact?: { price: number | null; fx: number | null };
  plot: Size; anchor: Point; points: (Point | null)[];
}) {
  const { locale, t } = useI18n();
  const [ref, bounds] = useVisiblePlot();
  const width = Math.min(plot.width < 400 ? 156 : 174, Math.max(1, plot.width - 2 * inset));
  const offscreen = bounds && (bounds.top >= plot.height || bounds.bottom <= 0 || bounds.top >= bounds.bottom);
  const { x, y } = tooltipPosition(plot, { width, height: bounds?.height || 86 }, anchor, points, offscreen ? undefined : bounds);
  const money = (amount: number | null | undefined) => {
    if (amount == null || !Number.isFinite(amount)) return "—";
    return amount.toLocaleString(locale, { maximumFractionDigits:0, signDisplay:"exceptZero" }) + t("원", " KRW");
  };
  const series = [
    { key: "price", label: t("가격 기여", "Price effect"), value: money(impact?.price) },
    { key: "fx", label: t("환율 기여", "FX effect"), value: money(impact?.fx) },
  ];
  return <div ref={ref} className={styles.position} style={{ width, visibility:offscreen ? "hidden" : undefined, transform: `translate(${x}px, ${y}px)` }}>
    <div id={id} role="tooltip" data-history-tooltip className={styles.card}>
      <div className={styles.meta}>
        <time dateTime={date} data-tooltip-date={date} aria-label={date}>{date.slice(2).replaceAll("-", ".")}</time>
        <span>{t("기여 · 현재 보유 기준", "Effects · current holdings")}</span>
      </div>
      <dl><div data-tooltip-series="value">
        <dt>{returns ? t("수익률", "Return") : t("평가액", "Value")}</dt>
        <dd aria-label={value === "—" ? t("자료 없음", "Unavailable") : undefined}>{value}</dd>
      </div></dl>
      <dl>{series.map(row => <div key={row.key} data-tooltip-series={row.key}>
        <dt>{row.label}</dt><dd aria-label={row.value === "—" ? t("자료 없음", "Unavailable") : undefined}>{row.value}</dd>
      </div>)}</dl>
    </div>
  </div>;
}
