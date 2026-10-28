import { EmptyState, Metric, MetricGroup, SectionHeading } from "@/components/cairn-ui";
import type { FirstDayReplay as Replay } from "@/lib/first-day-replay";
import styles from "./first-day-replay.module.css";

export function FirstDayReplay({ result }: { result: Replay }) {
  if (result.state !== "ready") return <section className={styles.panel}><SectionHeading title="지금 구성으로 과거 시장을 지나가면" /><EmptyState title={result.reason === "valuation" ? "현재 평가를 먼저 확인해 주세요." : "비교할 시장 자료를 준비하고 있어요."} description="공통 날짜의 종가·환율이 확인되면 가정 그래프와 종목별 등락을 보여드립니다. 아래 시장 자료 준비 상태에서 확인할 수 있어요." /></section>;
  const min = Math.min(100, ...result.points), max = Math.max(100, ...result.points), span = Math.max(2, max - min);
  const y = (value: number) => 160 - (value - min) / span * 132;
  const path = result.points.map((point, index) => `${index ? "L" : "M"}${12 + index / (result.points.length - 1) * 676},${y(point)}`).join(" ");
  const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  const partial = result.coveragePct < 99.995 || result.excluded.length > 0;
  return <section className={styles.panel} aria-label="현재 구성의 과거 시장 비교">
    <SectionHeading title="지금 구성으로 과거 시장을 지나가면" description="가입 첫날에도 볼 수 있는 시장 비교" />
    <span className={styles.badge}>가정 분석 · 실제 투자 성과와 별도</span>
    <MetricGroup className={styles.metrics}><Metric label={partial ? "포함 종목의 가정 변화" : "현재 구성의 가정 변화"} value={pct(result.changePct)} tone={result.changePct < 0 ? "negative" : "positive"} /><Metric label="비교 기간" value={result.dates.length - 1} unit="구간" /><Metric label="포함 비중" value={result.coveragePct.toFixed(1)} unit="%" /></MetricGroup>
    {partial && <p className={styles.note}>일부 구성만 비교합니다. 제외: {result.excluded.join(", ") || "시장 자료가 없는 종목"}. 포함 종목의 비중을 다시 100%로 환산했습니다.</p>}
    <figure style={{ margin: 0 }}><svg className={styles.chart} viewBox="0 0 700 180" role="img" aria-label={`시작 100, 마지막 ${result.points.at(-1)!.toFixed(2)}. 현재 비중으로 시작해 계속 보유한 가정 지수.`}><line x1="12" x2="688" y1={y(100)} y2={y(100)} stroke="currentColor" opacity=".2" strokeDasharray="3 4" /><path d={path} stroke="var(--ink,#252820)" strokeWidth="2.5" fill="none" /><circle cx="688" cy={y(result.points.at(-1)!)} r="4" fill="var(--accent,#f2552c)" /></svg><figcaption className={styles.axis}><span>{result.dates[0]} · 시작 100</span><span>{result.dates.at(-1)}</span></figcaption></figure>
    <SectionHeading title="종목별 시장 등락" description="각 구간의 원화 기준 변화 · 가로로 넘겨 날짜를 확인하세요." />
    <div className={styles.heatmap} tabIndex={0} role="region" aria-label="종목별 과거 시장 등락 표"><table className={styles.table}><caption className={styles.srOnly}>개인 보유 이력이 아닌 시장 종가·환율 기준 등락</caption><thead><tr><th scope="col">종목</th>{result.dates.slice(1).map(date => <th scope="col" key={date}><span className={styles.srOnly}>{date}</span>{date.slice(8)}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={`${row.name}-${index}`}><th scope="row">{row.name}</th>{row.returns.map((value, day) => <td key={day} title={`${result.dates[day + 1]} · ${row.name} ${pct(value)}`} style={{ background: Math.abs(value) < .005 ? "#e7e7df" : value > 0 ? `rgba(219,100,58,${Math.min(.85, .15 + Math.abs(value) * .16)})` : `rgba(85,114,141,${Math.min(.85, .15 + Math.abs(value) * .16)})` }}><span className={styles.srOnly}>{pct(value)}</span></td>)}</tr>)}</tbody></table></div>
    <div className={styles.legend}><span><i style={{background:"#638298"}}/>하락</span><span><i style={{background:"#e7e7df"}}/>보합</span><span><i style={{background:"#db643a"}}/>상승</span></div>
    <p className={styles.note}>오늘 비중으로 비교 시작일에 투자하고 추가 매매 없이 보유했다고 가정합니다. 확인된 수정 종가와 날짜별 환율을 사용하며 수수료·세금은 제외합니다. 현재 구성의 특성을 살펴보는 비교이며, 나의 과거 수익률이나 미래 예측은 아닙니다. 개인 히스토리에는 저장하지 않습니다.</p>
  </section>;
}
