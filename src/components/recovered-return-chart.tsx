'use client';
import { useState } from 'react';
import type { RecoveredReturnCurve } from '@/lib/period-return-recovery';
import { Field as CairnField, Input as CairnInput } from "@/components/cairn-ui";


export function RecoveredReturnChart({ curve, compact = false }: { curve: RecoveredReturnCurve; compact?: boolean }) {
  const [selected, setSelected] = useState(curve.points.length - 1);
  const current = curve.points[Math.min(selected, curve.points.length - 1)];
  const values = curve.points.flatMap(p => p.returnPct === null ? [] : [p.returnPct]);
  const low = Math.min(0, ...values), high = Math.max(0, ...values), span = high - low || 1;
  const start = Date.parse(curve.baseDate), duration = Date.parse(curve.endDate) - start || 1;
  const x = (date: string) => 28 + (Date.parse(date) - start) / duration * 600;
  const y = (v: number) => 164 - (v - low) / span * 140;
  const segments: string[] = []; let segment = '';
  for (const p of curve.points) {
    if (p.returnPct === null) { if (segment) segments.push(segment); segment = ''; }
    else segment += `${segment ? ' L' : 'M'}${x(p.date)},${y(p.returnPct)}`;
  }
  if (segment) segments.push(segment);
  const pct = (v: number | null) => v === null ? '종가 미확인' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  return <figure aria-label="복구된 기간 수익률 · 원화 기준 추정" style={{ margin: 0, minWidth: 0, color: 'var(--ink, #20211f)' }}>
    <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: compact ? 10 : 13 }}>
      <span>기간 수익률 · 추정<br /><small>{curve.baseDate.slice(5).replace('-', '.')} 시작 0% · KRW</small></span>
      <span style={{ textAlign: 'right' }}>{current.date.slice(5).replace('-', '.')}<br /><strong style={{ color: 'var(--accent, #c64623)', fontSize: compact ? 15 : 23 }}>{pct(current.returnPct)}</strong></span>
    </figcaption>
    <svg viewBox="0 0 656 194" role="img" aria-label={`기간 수익률 ${curve.baseDate}부터 ${curve.endDate}까지, ${curve.missingDays}일은 종가 미확인으로 공백`} style={{ display: 'block', width: '100%', height: compact ? 200 : 240 }}>
      {[low, (low + high) / 2, high].map((v, i) => <g key={i}><line x1="28" x2="628" y1={y(v)} y2={y(v)} stroke="#d9dbd5" strokeDasharray="2 5" /><text x="28" y={y(v) - 4} fontSize="9" fill="#777a73">{v.toFixed(1)}%</text></g>)}
      {segments.map((d, i) => <path key={i} d={d} fill="none" stroke="#c64623" strokeWidth="1.7" vectorEffect="non-scaling-stroke" />)}
      {curve.points.map(p => p.returnPct === null ? null : <circle key={p.date} cx={x(p.date)} cy={y(p.returnPct)} r="2" fill="#c64623"><title>{`${p.date} ${pct(p.returnPct)}`}</title></circle>)}
      {current.returnPct !== null && <circle cx={x(current.date)} cy={y(current.returnPct)} r="4" fill="#c64623" stroke="#f7f8f3" strokeWidth="2" />}
      <text x="28" y="188" fontSize="10" fill="#777a73">{curve.baseDate.slice(5)}</text><text x="628" y="188" textAnchor="end" fontSize="10" fill="#777a73">{curve.endDate.slice(5)}</text>
    </svg>
    {!compact && <CairnField style={{ display: 'block', fontSize: 12 }}>조회 날짜 · {current.date}<CairnInput aria-label="복구 수익률 날짜" type="range" min="0" max={curve.points.length - 1} value={selected} onChange={e => setSelected(Number(e.target.value))} style={{ display: 'block', width: '100%', accentColor: '#c64623' }} /></CairnField>}
    <p style={{ color: '#777a73', fontSize: compact ? 9 : 12, lineHeight: 1.6, margin: '6px 0 0' }}>매수·매도 금액 반영 · 현금 제외{compact ? ` · ${curve.missingDays}일 종가 미확인` : ` · ${curve.missingDays}일 종가 미확인으로 공백`}</p>
    {!compact && <details style={{ fontSize: 12, color: '#777a73', lineHeight: 1.7, marginTop: 8 }}><summary>복구 기준 보기</summary><p>확인한 잔고에서 거래를 역산한 수량과 날짜별 종가·환율로 계산했습니다. 날짜만 확인된 거래는 해당 날짜 말의 투자 유입·회수로 처리합니다. 매수·매도 금액 자체를 수익으로 계산하지 않습니다.</p><p>시작일 대비 기간 성과이며, 매입원가 대비 손익률과 다릅니다. 수수료·세금·배당은 별도로 반영하지 않습니다. 금은 기존 수동 평가 기록을 유지합니다. 두 증권 계좌 중 두 번째 계좌는 제공된 VOO 거래만 포함합니다. 확인되지 않은 날짜의 값을 만들거나 공백을 연결하지 않습니다.</p></details>}
  </figure>;
}
