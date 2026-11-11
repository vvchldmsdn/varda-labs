'use client';
import { useState, type PointerEvent, type ReactNode } from 'react';
import type { RecoveredReturnCurve } from '@/lib/period-return-recovery';
import { buildReturnTimeline, returnTimelineSegments, returnTimelineLabel, type StoredReturnPoint } from '@/lib/return-timeline';
import styles from './return-timeline-chart.module.css';
import { Input as CairnInput } from "@/components/cairn-ui";
import { useMeasuredPlot } from "@/components/use-measured-plot";


export function ReturnTimelineChart({ stored, curve, compact = false, rangeDays, selectedDate, onSelect, onInspect, hideReadout = false, renderOverlay, renderLegend }: {
  stored: readonly StoredReturnPoint[]; curve: RecoveredReturnCurve; compact?: boolean; rangeDays?: number;
  selectedDate?: string | null; onSelect?: (date: string) => void; onInspect?: (date: string | null) => void; hideReadout?: boolean;
  renderOverlay?: (plot: {start:string;end:string;x:(date:string)=>number;top:number;bottom:number}) => ReactNode;
  renderLegend?: (date:string, returnLabel:string, window:{start:string;end:string}, inspecting:boolean) => ReactNode;
}) {
  const points = buildReturnTimeline(stored, curve, rangeDays);
  const [measured, setPlotElement] = useMeasuredPlot();
  const [localDate, setLocalDate] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const chosen = points.findIndex(p => p.date === (hoverDate ?? selectedDate ?? localDate));
  const index = chosen < 0 ? points.length - 1 : chosen;
  const current = points[index];
  if (!current) return null;
  const values = points.flatMap(p => [p.storedPct, p.recoveredPct].filter((v): v is number => v !== null));
  const min = Math.min(0, ...values), max = Math.max(0, ...values), padding = Math.max((max - min) * .12, .4);
  const low = min - padding, high = max + padding;
  const first = Date.parse(points[0].date), elapsed = Date.parse(points.at(-1)!.date) - first || 1;
  const width = measured.width || 960, height = measured.height || (compact ? 185 : 300);
  const left = 14, right = width - 14, top = 30, bottom = height - 20;
  const x = (date: string) => left + (Date.parse(date) - first) / elapsed * (right - left);
  const y = (v: number) => bottom - (v - low) / (high - low) * (bottom - top);
  const percent = (v: number | null) => v === null ? '종가 미확인' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  const series = [
    { field: 'storedPct' as const, color: 'var(--ink, #20211f)' },
    { field: 'recoveredPct' as const, color: 'var(--brand, #c64623)' },
  ];
  const gaps = points.filter(p => p.basis === 'recovered' && p.recoveredPct === null);
  const hasPrior = points.some(p => p.date < curve.baseDate && p.storedPct !== null);
  const baseVisible = points[0].date <= curve.baseDate && points.at(-1)!.date >= curve.baseDate;
  const choose = (date: string) => { setLocalDate(date); onSelect?.(date); };
  const leave = () => { setHoverDate(null); onInspect?.(null); };
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at = (event.clientX - rect.left) / rect.width * width;
    const nearest = points.reduce((best, p) => Math.abs(x(p.date) - at) < Math.abs(x(best.date) - at) ? p : best, points[0]);
    setHoverDate(nearest.date); onInspect?.(nearest.date);
    if (event.type === 'pointerdown') choose(nearest.date);
  };
  return <figure className={`${styles.chart} ${compact ? styles.compact : ''}`} data-return-timeline aria-label="저장 수익률과 복구 기간 수익률을 같은 날짜 축에 표시">
    <figcaption className={styles.legend}>
      <span><i className={styles.storedDot}/>저장 수익률</span>
      <span><i className={styles.recoveredDot}/>복구 기간 · {curve.baseDate.slice(5).replace('-', '.')} = 0%</span>
    </figcaption>
    {!hideReadout && <div className={styles.readout}><span>{current.date} · {returnTimelineLabel(current)}</span><strong>{percent(current.returnPct)}</strong></div>}
    <div ref={setPlotElement} className={styles.plotArea}>
    {baseVisible && <span className={styles.basisLabel} style={{left: `${Math.min(70,x(curve.baseDate)/width*100)}%`}}>{hasPrior ? "계산 기준 변경" : "복구 시작 · 0%"}</span>}
    <svg onClick={compact ? event => event.stopPropagation() : undefined} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`수익률 추이 ${points[0].date}부터 ${points.at(-1)!.date}, 계산 기준 구분, ${gaps.length}일 종가 미확인`}
      className={styles.plot} onPointerMove={inspect} onPointerDown={inspect} onPointerLeave={leave} onPointerCancel={leave}>
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="var(--line, #d9dbd5)" strokeDasharray="3 6" />
      {gaps.map(p => {
        const gapWidth = Math.min(right - left, Math.max(4, (right - left) * 86400000 / elapsed));
        const start = Math.max(left, x(p.date) - gapWidth / 2);
        return <rect key={p.date} x={start} y={top} width={Math.min(gapWidth, right - start)} height={bottom - top} fill="var(--muted, #777a73)" opacity=".07"><title>{`${p.date} · 해당 거래일 종가 미수집`}</title></rect>;
      })}
      {series.flatMap(({ field, color }) => returnTimelineSegments(points, field).map((segment, i) => <g key={`${field}-${i}`} data-return-series={field}>
        <path data-history-line pathLength="1" d={segment.map((p, j) => `${j ? 'L' : 'M'}${x(p.date).toFixed(2)},${y(p[field]!).toFixed(2)}`).join(' ')} fill="none" stroke={color} strokeWidth={compact ? 1.4 : 2.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {segment.length === 1 && <circle cx={x(segment[0].date)} cy={y(segment[0][field]!)} r="3" fill={color}/>}
      </g>))}
      {baseVisible && <g><line x1={x(curve.baseDate)} x2={x(curve.baseDate)} y1={top} y2={bottom} stroke="var(--muted, #777a73)" strokeDasharray="4 5" opacity=".6"/></g>}
      {renderOverlay?.({start:points[0].date,end:points[points.length-1].date,x,top,bottom})}
      <line x1={x(current.date)} x2={x(current.date)} y1={top} y2={bottom} stroke="var(--ink, #20211f)" strokeDasharray="2 5" opacity=".16" />
      {current.returnPct !== null && <circle cx={x(current.date)} cy={y(current.returnPct)} r={compact ? 4 : 6} fill={current.basis === 'stored' ? 'var(--ink, #20211f)' : 'var(--brand, #c64623)'} stroke="var(--paper, #f7f8f3)" strokeWidth="2"/>}
    </svg>
    </div>
    <div className={styles.dates}><span>{points[0].date.replaceAll('-', '.')}</span><span>{points.at(-1)!.date.replaceAll('-', '.')}</span></div>
    {renderLegend?.(current.date, percent(current.returnPct), {start:points[0].date,end:points[points.length-1].date}, chosen >= 0)}
    {!compact && <CairnInput className={styles.slider} type="range" aria-label="히스토리 그래프 날짜 탐색" min="0" max={points.length - 1} value={index} aria-valuetext={`${current.date} ${returnTimelineLabel(current)} ${percent(current.returnPct)}`} onChange={event => { leave(); choose(points[Number(event.target.value)].date); }}/>}
    <p className={styles.note}>{current.returnPct === null ? `${current.date} · 종가가 없어 계산하지 않았습니다.` : `${gaps.length ? `회색 구간 ${gaps.length}일 · 종가 미확인` : '확인된 날짜별 기록'} · 서로 다른 계산 기준은 선으로 연결하지 않습니다.`}</p>
    {!compact && <details className={styles.details}><summary>계산 기준과 공백 이유</summary><p>검은 선은 기존에 저장된 매입원가 대비 수익률입니다. 주황 선은 {curve.baseDate} 평가액을 시작점으로, 이후 매수·매도 체결금액을 조정해 계산한 원화 투자자산 기간 수익률입니다. 기존 수익률에 더하거나 곱하지 않습니다.</p><p>일부 보유 종목의 해당 거래일 종가가 저장돼 있지 않아 전체 평가액과 수익률을 계산할 수 없는 날짜입니다. 휴장일에는 직전 거래일 종가가 필요합니다. 회색 구간을 선택하면 날짜를 확인할 수 있습니다.</p><p>복구 범위는 {curve.endDate}까지입니다. 현금은 제외하며, 거래 시각은 일말로 가정합니다. 수수료·세금·배당은 별도로 복원하지 않았고 금은 기존 평가를 유지합니다. 두 번째 계좌는 제공된 VOO 거래와 기존 원장 범위만 포함합니다.</p></details>}
  </figure>;
}
