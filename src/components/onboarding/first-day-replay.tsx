import { ArrowDown } from "lucide-react";
import { EmptyState, InfoDisclosure, Metric, MetricGroup, SectionHeading } from "@/components/cairn-ui";
import { T } from "@/components/i18n/localized-text";
import { RecoveryNotice } from "@/components/recovery/recovery-notice";
import type { FirstDayReplay as Replay } from "@/lib/first-day-replay";
import styles from "./first-day-replay.module.css";

export function FirstDayReplay({ result }: { result: Replay }) {
  if (result.state !== "ready") return <section className={styles.panel}>
    <SectionHeading title={<T ko="과거 시장에 대입해 보면" en="Through past markets" />} />
    {result.reason === "read" ? <RecoveryNotice kind="retry" /> : <EmptyState
      title={result.reason === "valuation" ? <T ko="현재 평가를 먼저 확인해 주세요." en="Check your current valuation first." /> : <T ko="비교할 시장 자료가 더 필요해요." en="More market history is needed." />}
      description={<T ko="가격과 환율이 준비되면 가정 분석을 볼 수 있어요." en="Explore this hypothetical analysis once prices and exchange rates are available." />}
      action={<a className={styles.next} href="#first-market-data"><T ko="자료 준비 확인" en="Check data readiness" /><ArrowDown size={17} aria-hidden="true" /></a>}
    />}
  </section>;
  const min = Math.min(100, ...result.points), max = Math.max(100, ...result.points), span = Math.max(2, max - min);
  const y = (value: number) => 160 - (value - min) / span * 132;
  const path = result.points.map((point, index) => `${index ? "L" : "M"}${12 + index / (result.points.length - 1) * 676},${y(point)}`).join(" ");
  const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const partial = result.coveragePct < 99.995 || result.excluded.length > 0;
  return <section className={styles.panel} aria-label="현재 구성의 과거 시장 비교">
    <SectionHeading title={<T ko="과거 시장에 대입해 보면" en="Through past markets" />} actions={<span className={styles.badge}><T ko="가정 분석" en="Hypothetical" /></span>} />
    <p className={styles.note}><T ko="지금 비중으로 시작해 계속 보유한 경우 · 실제 수익률과 별도" en="Today's weights, held through the period · Separate from your actual returns" /></p>
    <MetricGroup className={styles.metrics}>
      <Metric size="hero" label={partial ? <T ko="포함 종목의 가정 변화" en="Included holdings: hypothetical change" /> : <T ko="현재 구성의 가정 변화" en="Hypothetical change" />} value={pct(result.changePct)} tone={result.changePct < 0 ? "negative" : "positive"} />
      <Metric label={<T ko="비교 기간" en="Intervals" />} value={result.dates.length - 1} unit={<T ko="구간" en="steps" />} />
      <Metric label={<T ko="포함 비중" en="Coverage" />} value={result.coveragePct.toFixed(1)} unit="%" />
    </MetricGroup>
    {partial && <p className={styles.partial}><T ko={`일부 구성만 비교 · 제외: ${result.excluded.join(", ") || "시장 자료가 없는 종목"}. 포함 비중을 100%로 환산했어요.`} en={`Partial comparison · Excluded: ${result.excluded.join(", ") || "holdings without market data"}. Included weights are scaled to 100%.`} /></p>}
    <figure className={styles.figure}><svg className={styles.chart} viewBox="0 0 700 180" role="img" aria-label={`시작 100, 마지막 ${result.points.at(-1)!.toFixed(2)}. 현재 비중으로 시작해 계속 보유한 가정 지수.`}><line x1="12" x2="688" y1={y(100)} y2={y(100)} stroke="currentColor" opacity=".2" strokeDasharray="3 4" /><path d={path} stroke="var(--ink,#252820)" strokeWidth="2.5" fill="none" /><circle cx="688" cy={y(result.points.at(-1)!)} r="4" fill="var(--accent,#f2552c)" /></svg><figcaption className={styles.axis}><span>{result.dates[0]} · <T ko="시작 100" en="Starts at 100" /></span><span>{result.dates.at(-1)}</span></figcaption></figure>
    <InfoDisclosure summary={<T ko="종목별 등락 보기" en="Explore each holding" />}>
      <p className={styles.note}><T ko="구간별 원화 기준 · 가로로 넘겨 날짜를 확인하세요." en="KRW changes by interval · Scroll sideways for dates." /></p>
      <div className={styles.heatmap} tabIndex={0} role="region" aria-label="종목별 과거 시장 등락 표"><table className={styles.table}><caption className={styles.srOnly}><T ko="개인 보유 이력이 아닌 시장 종가·환율 기준 등락" en="Market prices and exchange rates, not personal holding history" /></caption><thead><tr><th scope="col"><T ko="종목" en="Holding" /></th>{result.dates.slice(1).map(date => <th scope="col" key={date}><span className={styles.srOnly}>{date}</span>{date.slice(8)}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={`${row.name}-${index}`}><th scope="row">{row.name}</th>{row.returns.map((value, day) => <td key={day} title={`${result.dates[day + 1]} · ${row.name} ${pct(value)}`} style={{ background: Math.abs(value) < .005 ? "#e7e7df" : value > 0 ? `rgba(219,100,58,${Math.min(.85, .15 + Math.abs(value) * .16)})` : `rgba(85,114,141,${Math.min(.85, .15 + Math.abs(value) * .16)})` }}><span className={styles.srOnly}>{pct(value)}</span></td>)}</tr>)}</tbody></table></div>
      <div className={styles.legend}><span><i style={{background:"#638298"}}/><T ko="하락" en="Down" /></span><span><i style={{background:"#e7e7df"}}/><T ko="보합" en="Flat" /></span><span><i style={{background:"#db643a"}}/><T ko="상승" en="Up" /></span></div>
    </InfoDisclosure>
    <InfoDisclosure summary={<T ko="분석 기준" en="How this is calculated" />}><p><T ko="현재 비중으로 비교 시작일에 투자하고 추가 매매 없이 보유한 가정입니다. 확인된 수정 종가와 날짜별 환율을 사용하며 수수료·세금은 제외합니다. 나의 과거 수익률이나 미래 예측이 아니며 개인 히스토리에 저장하지 않습니다." en="Assumes investing at today's weights at the start and holding without further trades. Uses verified adjusted closes and dated FX rates, excluding fees and taxes. This is not your past return or a forecast, and is not saved to your personal history." /></p></InfoDisclosure>
  </section>;
}
