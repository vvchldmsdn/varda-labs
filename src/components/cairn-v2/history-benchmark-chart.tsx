"use client";

import { useId } from "react";
import { Input } from "@/components/cairn-ui";
import { useMeasuredPlot } from "@/components/use-measured-plot";
import { useI18n } from "@/components/i18n/locale-provider";
import { nearestLabDateIndex, labCompactKrw } from "@/components/investment-lab/investment-lab-chart-presentation";
import type { BenchmarkPoint } from "@/lib/cairn-v2/history-benchmark";
import styles from "./history-benchmark.module.css";

export function HistoryBenchmarkChart({ points, selectedDate, onSelect, label }: {
  points: BenchmarkPoint[]; selectedDate: string; onSelect: (date: string) => void; label: string;
}) {
  const { t, locale } = useI18n();
  const [size, ref] = useMeasuredPlot();
  const id = useId();
  const width = Math.max(180, size.width || 320), height = Math.max(200, Math.min(330, width * .42));
  const left = 55, right = 12, top = 18, bottom = height - 25;
  const dates = points.map(point => point.date), times = dates.map(date => Date.parse(date + "T00:00:00Z"));
  const duration = Math.max(1, times.at(-1)! - times[0]);
  const values = points.flatMap(point => [point.actual, point.hypothetical]);
  const low = Math.min(...values), high = Math.max(...values), delta = Math.max(1, high - low);
  const min = low - delta * .1, max = high + delta * .1;
  const x = (i: number) => left + ((times[i] - times[0]) / duration) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (bottom - top);
  const index = Math.max(0, points.findIndex(point => point.date === selectedDate)), point = points[index];
  function inspect(svg: SVGSVGElement, clientX: number) {
    const box = svg.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, ((clientX - box.left) * width / box.width - left) / (width - left - right)));
    onSelect(dates[nearestLabDateIndex(dates, times[0] + fraction * duration)]);
  }
  return <figure className={styles.chart}>
    <figcaption><span>{t("내 포트폴리오", "My portfolio")}</span><span data-series="scenario">{label}</span></figcaption>
    <div ref={ref}>
      <svg role="img" aria-labelledby={id} viewBox={`0 0 ${width} ${height}`} onPointerMove={event => inspect(event.currentTarget, event.clientX)} onPointerDown={event => inspect(event.currentTarget, event.clientX)}>
        <title id={id}>{t("내 포트폴리오와 가상 배분 비교 · 원화", "Portfolio and hypothetical allocation · KRW")}</title>
        {[low, (low + high) / 2, high].filter((value, i, all) => all.indexOf(value) === i).map(value => <g key={value}>
          <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className={styles.grid} />
          <text x={left - 8} y={y(value)} textAnchor="end" dominantBaseline="middle">{labCompactKrw(value, locale)}</text>
        </g>)}
        <polyline points={points.map((row, i) => `${x(i)},${y(row.actual)}`).join(" ")} className={styles.actual} />
        <polyline points={points.map((row, i) => `${x(i)},${y(row.hypothetical)}`).join(" ")} className={styles.hypothetical} />
        <line x1={x(index)} x2={x(index)} y1={top} y2={bottom} className={styles.cursor} />
        <circle cx={x(index)} cy={y(point.actual)} r={4} className={styles.actualDot} />
        <circle cx={x(index)} cy={y(point.hypothetical)} r={4} className={styles.scenarioDot} />
        {[0, points.length - 1].map(i => <text key={i} x={x(i)} y={height - 4} textAnchor={i === 0 ? "start" : "end"}>{dates[i].slice(5).replace("-", ".")}</text>)}
      </svg>
    </div>
    <Input className={styles.scrubber} type="range" min={0} max={points.length - 1} value={index} onChange={event => onSelect(dates[Number(event.target.value)])}
      aria-label={t("비교 날짜", "Comparison date")} aria-valuetext={`${point.date} · ${t("실제", "Actual")} ${point.actual.toLocaleString(locale)} KRW · ${label} ${point.hypothetical.toLocaleString(locale)} KRW`} />
  </figure>;
}
