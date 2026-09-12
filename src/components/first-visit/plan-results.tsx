import { calculatePlan, type PlanInput } from "@/lib/investment-plan";
import styles from "./first-visit.module.css";
const money = (n: number) => new Intl.NumberFormat("ko-KR").format(n);
export function PlanResults({ input, sample = false }: { input: PlanInput; sample?: boolean }) {
  const calculation = calculatePlan(input);
  if (!calculation.ok) return <p role="alert">{calculation.error}</p>;
  const { rows, result } = calculation;
  const reached = rows.every(row => Math.abs(row.afterPct - row.targetPct) < 0.01);
  return <section className={styles.results} aria-label={sample ? "샘플 계산 결과" : "내 계산 결과"}>
    <p className={styles.eyebrow}>{sample ? "예시 배분 결과" : "내가 입력한 자산의 배분"}</p>
    <h2>이번 투자금 <strong>{money(input.amount)}원</strong>의 배분</h2>
    <p>{reached ? "목표 비중에 가까워졌어요. 원 단위 차이는 남을 수 있습니다." : "목표보다 부족한 자산에 배분합니다. 목표 비중과 차이는 남을 수 있어요."}</p>
    <div className={styles.resultRows}>{rows.map((row, i) => <article key={i}>
      <div className={styles.rowTitle}><h3>{row.name}</h3><strong>+{money(row.allocation)}원</strong></div>
      <div className={styles.bar} aria-hidden="true"><span style={{ width: `${row.afterPct}%` }} /><i style={{ left: `${row.targetPct}%` }} /></div>
      <div className={styles.stats}><span>현재 {row.beforePct === null ? "—" : `${row.beforePct.toFixed(2)}%`} → 배분 후 {row.afterPct.toFixed(2)}%</span><span>목표 {row.targetPct.toFixed(2)}% · 차이 {(row.afterPct - row.targetPct).toFixed(2)}%p</span></div>
    </article>)}</div>
    <p>배분 합계 {money(result.totalAllocatedKrw)}원 · 남는 현금 {money(result.residualCashKrw)}원</p>
    <details><summary>계산 방법과 한계</summary><p>목표까지 부족한 금액이 큰 자산에 더 많이 배분합니다. 이미 비중이 높은 자산은 팔지 않으므로, 새 투자금만으로 목표에 도달하지 못할 수 있어요.</p><p>입력한 원화 금액으로 계산한 계획입니다. 실제 매수 수량·세금·수수료는 별도이며, 원 단위 배분 후 남은 금액은 현금으로 표시합니다.</p></details>
  </section>;
}
