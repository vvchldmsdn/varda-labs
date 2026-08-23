"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  formatDate,
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";
import type { DashboardFxTrendPoint } from "@/lib/fx-trend";

const CHART_WIDTH = 420;
const CHART_HEIGHT = 132;
const CHART_PADDING = 10;
const PANEL_WIDTH = 460;
const PANEL_GAP = 10;
const VIEWPORT_MARGIN = 16;

type PanelPosition = {
  left: number;
  maxHeight: number;
  placement: "top" | "bottom";
  top: number;
};

export function FxImpactPopover({
  impactKrw,
  impactPct,
  points,
}: {
  impactKrw: number | null;
  impactPct: number | null;
  points: readonly DashboardFxTrendPoint[];
}) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chart = useMemo(() => buildChart(points), [points]);
  const latest = points.at(-1) ?? null;

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(window.innerHeight - VIEWPORT_MARGIN * 2, 240);
    const panelHeight = Math.min(panelRect.height, maxHeight);
    const spaceAbove = triggerRect.top - VIEWPORT_MARGIN - PANEL_GAP;
    const spaceBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN - PANEL_GAP;
    const placement = spaceBelow >= panelHeight || spaceBelow >= spaceAbove ? "bottom" : "top";
    const preferredLeft = window.innerWidth >= 1024
      ? triggerRect.right - panelWidth
      : triggerRect.left;
    const left = Math.min(
      Math.max(preferredLeft, VIEWPORT_MARGIN),
      window.innerWidth - panelWidth - VIEWPORT_MARGIN,
    );
    const top = placement === "top"
      ? Math.max(VIEWPORT_MARGIN, triggerRect.top - PANEL_GAP - panelHeight)
      : Math.min(triggerRect.bottom + PANEL_GAP, window.innerHeight - VIEWPORT_MARGIN - panelHeight);

    setPanelPosition({ left, maxHeight, placement, top });
  }, []);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => {
      updatePanelPosition();
      panelRef.current?.focus();
    });
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
        setPanelPosition(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setPanelPosition(null);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const panel = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="원 달러 환율 추세"
          data-placement={panelPosition?.placement}
          tabIndex={-1}
          className="z-50 overflow-y-auto rounded-[6px] border border-[#cfd4cd] bg-[#fbfcf9] p-5 shadow-[0_18px_48px_rgba(26,32,27,0.16)] focus:outline-none"
          style={{
            left: panelPosition?.left ?? VIEWPORT_MARGIN,
            maxHeight: panelPosition?.maxHeight ?? `calc(100dvh - ${VIEWPORT_MARGIN * 2}px)`,
            position: "fixed",
            top: panelPosition?.top ?? VIEWPORT_MARGIN,
            visibility: panelPosition ? "visible" : "hidden",
            width: `min(${PANEL_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
          }}
        >
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-medium text-[#7b8079]">USD / KRW</p>
              <h3 className="mt-1 text-base font-semibold text-[#242824]">원/달러 추세</h3>
              <p className="mt-1 text-[11px] text-[#7d837b]">
                {latest ? `${formatDate(latest.date)} · 최근 ${points.length}개 관측치` : "저장 이력 없음"}
              </p>
            </div>
            <button
              type="button"
              aria-label="환율 추세 닫기"
              className="grid h-8 w-8 place-items-center rounded-full text-xl text-[#686e67] hover:bg-[#ecefe9] focus-visible:outline-2 focus-visible:outline-[#347e62]"
              onClick={() => {
                setOpen(false);
                setPanelPosition(null);
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>

          {latest && chart ? (
            <>
              <dl className="mt-5 grid grid-cols-3 border-y border-[#e0e4de] py-3 text-xs">
                <FxValue label="현재" value={latest.rate} />
                <FxValue label="60일선" value={latest.ma60} divided />
                <FxValue label="120일선" value={latest.ma120} divided />
              </dl>
              <div className="mt-4">
                <svg
                  aria-label="원 달러 환율과 60일선, 120일선 추세"
                  className="h-[150px] w-full overflow-visible"
                  role="img"
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                >
                  {[0.25, 0.5, 0.75].map((ratio) => (
                    <line
                      key={ratio}
                      x1={CHART_PADDING}
                      x2={CHART_WIDTH - CHART_PADDING}
                      y1={CHART_PADDING + (CHART_HEIGHT - CHART_PADDING * 2) * ratio}
                      y2={CHART_PADDING + (CHART_HEIGHT - CHART_PADDING * 2) * ratio}
                      stroke="#e4e7e2"
                      strokeWidth="1"
                    />
                  ))}
                  <path d={chart.ma120Path} fill="none" stroke="#a68d72" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  <path d={chart.ma60Path} fill="none" stroke="#6f9b87" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                  <path d={chart.ratePath} fill="none" stroke="#202520" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-[#858b83]">
                  <span>{formatDate(points[0].date)}</span>
                  <span>{formatDate(latest.date)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-[#6f756d]">
                  <Legend color="#202520" label="원/달러" />
                  <Legend color="#6f9b87" label="60일선" />
                  <Legend color="#a68d72" label="120일선" />
                </div>
              </div>
            </>
          ) : (
            <p className="mt-6 border-y border-[#e0e4de] py-8 text-center text-sm text-[#747a72]">
              표시할 환율 이력이 아직 없습니다.
            </p>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div
        ref={rootRef}
        className="relative min-w-0 border-b border-[#e2e5df] sm:even:border-r sm:even:border-[#e2e5df] lg:border-b-0 lg:border-r lg:border-[#e2e5df]"
      >
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="block min-h-full w-full px-5 py-6 text-left transition-colors hover:bg-[#f1f4ef] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#347e62]"
          onClick={() => {
            setPanelPosition(null);
            setOpen((value) => !value);
          }}
        >
          <span className="flex items-center justify-between gap-3 text-xs font-medium text-[#6d736b]">
            환율 영향
            <span aria-hidden="true" className="text-base text-[#8a9088]">↗</span>
          </span>
          <span className={`mt-3 block truncate text-xl font-medium tabular-nums ${toneClass(impactKrw)}`}>
            {formatSignedKrw(impactKrw)}
          </span>
          <span className="mt-2 block truncate text-xs text-[#747a72]">
            {formatPercent(impactPct, true)}
          </span>
        </button>
      </div>
      {panel}
    </>
  );
}

function FxValue({ divided = false, label, value }: { divided?: boolean; label: string; value: number | null }) {
  return (
    <div className={`min-w-0 px-3 first:pl-0 last:pr-0 ${divided ? "border-l border-[#e0e4de]" : ""}`}>
      <dt className="text-[#7b8179]">{label}</dt>
      <dd className="mt-1 truncate font-medium tabular-nums text-[#252925]">
        {value === null ? "-" : value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </dd>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-px w-5" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function buildChart(points: readonly DashboardFxTrendPoint[]) {
  if (points.length < 2) return null;
  const values = points.flatMap((point) => [point.rate, point.ma60, point.ma120]).filter((value): value is number => value !== null);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.12, 1);
  const domain = { minimum: minimum - padding, maximum: maximum + padding };

  return {
    ratePath: chartPath(points, (point) => point.rate, domain),
    ma60Path: chartPath(points, (point) => point.ma60, domain),
    ma120Path: chartPath(points, (point) => point.ma120, domain),
  };
}

function chartPath(
  points: readonly DashboardFxTrendPoint[],
  valueOf: (point: DashboardFxTrendPoint) => number | null,
  domain: { minimum: number; maximum: number },
) {
  const width = CHART_WIDTH - CHART_PADDING * 2;
  const height = CHART_HEIGHT - CHART_PADDING * 2;
  const range = Math.max(domain.maximum - domain.minimum, 1);
  let drawing = false;

  return points.map((point, index) => {
    const value = valueOf(point);
    if (value === null) {
      drawing = false;
      return "";
    }
    const x = CHART_PADDING + (index / Math.max(points.length - 1, 1)) * width;
    const y = CHART_PADDING + ((domain.maximum - value) / range) * height;
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}
