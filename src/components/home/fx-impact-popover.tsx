"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";
import { useId, useMemo, useRef, useState } from "react";
import { formatDate, formatPercent, formatSignedKrw, toneClass } from "@/components/home/portfolio-format";
import type { DashboardFxTrendPoint } from "@/lib/fx-trend";
import styles from "./fx-impact-popover.module.css";

const CHART_WIDTH = 420;
const CHART_HEIGHT = 132;
const CHART_PADDING = 10;

export function FxImpactPopover({ basisDate, compact = false, impactKrw, impactPct, points }: {
  basisDate: string | null;
  compact?: boolean;
  impactKrw: number | null;
  impactPct: number | null;
  points: readonly DashboardFxTrendPoint[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const chart = useMemo(() => buildChart(points), [points]);
  const latest = points.at(-1) ?? null;
  return <div className={styles.root}>
    <button ref={triggerRef} type="button" aria-expanded={open} aria-controls={panelId}
      className={compact ? styles.trigger : styles.impactTrigger}
      onClick={() => setOpen(value => !value)}>
          {compact ? <><T ko="환율 추세 살펴보기" en="Explore the exchange rate"/> <span aria-hidden="true">{open ? "−" : "+"}</span></> : <>
          <span className="flex items-center justify-between gap-3 text-xs font-medium text-[var(--muted)]"><T ko="환율 영향" en="FX impact"/><span aria-hidden="true" className="text-base text-[var(--faint)]">{open ? "−" : "+"}</span>
          </span>
          <span className={`mt-3 block truncate text-xl font-medium tabular-nums ${toneClass(impactKrw)}`}>
            {<T ko={formatSignedKrw(impactKrw)} en={translateHomeHistory(formatSignedKrw(impactKrw))}/>}
          </span>
          <span className="mt-2 block truncate text-xs text-[var(--muted)]">
            {formatPercent(impactPct, true)}
          </span>
          </>}
    </button>
    {open ? <section id={panelId} aria-label={t("원 달러 환율 추세", "USD/KRW exchange rate trend")} className={styles.panel}>
          <div className="flex items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-medium text-[var(--muted)]">USD / KRW</p>
              <h3 className="mt-1 text-base font-semibold text-[var(--ink)]"><T ko="원/달러 추세" en="USD/KRW trend"/></h3>
              <p className="mt-1 text-[11px] text-[var(--faint)]">
                {<T ko={latest ? `${formatDate(latest.date)} · 최근 ${points.length}개 관측치` : "저장 이력 없음"} en={translateHomeHistory(latest ? `${formatDate(latest.date)} · 최근 ${points.length}개 관측치` : "저장 이력 없음")}/>}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("환율 추세 닫기", "Close exchange rate trend")}
              className="grid h-8 w-8 place-items-center rounded-full text-xl text-[var(--muted)] hover:bg-[var(--wash)] focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>

          {latest && chart ? (
            <>
              <dl className="mt-5 grid grid-cols-3 border-y border-[var(--wash)] py-3 text-xs">
                <FxValue label={t("현재", "Current")} value={latest.rate} />
                <FxValue label={t("60일선", "60-day MA")} value={latest.ma60} divided />
                <FxValue label={t("120일선", "120-day MA")} value={latest.ma120} divided />
              </dl>
              <div className="mt-4">
                <svg
                  aria-label={t("원 달러 환율과 60일선, 120일선 추세", "USD/KRW with 60-day and 120-day moving averages")}
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
                      stroke="var(--wash)"
                      strokeWidth="1"
                    />
                  ))}
                  <path d={chart.ma120Path} fill="none" stroke="var(--warning)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                  <path d={chart.ma60Path} fill="none" stroke="var(--brand-mid)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                  <path d={chart.ratePath} fill="none" stroke="var(--ink)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-[var(--faint)]">
                  <span>{<T ko={formatDate(points[0].date)} en={translateHomeHistory(formatDate(points[0].date))}/>}</span>
                  <span>{<T ko={formatDate(latest.date)} en={translateHomeHistory(formatDate(latest.date))}/>}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-[var(--muted)]">
                  <Legend color="var(--ink)" label={t("원/달러", "USD/KRW")} />
                  <Legend color="var(--brand-mid)" label={t("60일선", "60-day MA")} />
                  <Legend color="var(--warning)" label={t("120일선", "120-day MA")} />
                </div>
                <p className="mt-4 border-t border-[var(--wash)] pt-3 text-[10px] leading-4 text-[var(--faint)]"><T ko={`오늘의 환율 영향은 ${basisDate ? formatDate(basisDate) : "최근"} 기준 스냅샷과 현재 환율의 차이로 계산합니다.`} en={`Today's FX impact compares the exchange rate in the ${basisDate ? formatDate(basisDate) : "latest"} baseline snapshot with the current rate.`}/></p>
              </div>
            </>
          ) : (
            <p className="mt-6 border-y border-[var(--wash)] py-8 text-center text-sm text-[var(--muted)]"><T ko="표시할 환율 이력이 아직 없습니다." en="No exchange rate history is available yet."/></p>
          )}

    </section> : null}
  </div>;
}

function FxValue({ divided = false, label, value }: { divided?: boolean; label: string; value: number | null }) {
  return (
    <div className={`min-w-0 px-3 first:pl-0 last:pr-0 ${divided ? "border-l border-[var(--wash)]" : ""}`}>
      <dt className="text-[var(--faint)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className="mt-1 truncate font-medium tabular-nums text-[var(--ink)]">
        {value === null ? "-" : value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </dd>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-px w-5" style={{ backgroundColor: color }} />
      {<T ko={label} en={translateHomeHistory(label)}/>}
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
