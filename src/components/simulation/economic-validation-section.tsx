import type { SimulationOwnerEconomicValidationResult } from "@/lib/simulation-owner-economic-validation";
import { SimulationText } from "./simulation-text";

export function EconomicValidationSection({ result }: { result: SimulationOwnerEconomicValidationResult | null }) {
  const ready = result?.rows.filter((row) => row.status === "ready") ?? [];
  return <section data-economic-validation={result?.status ?? "unavailable"}>
    <h3 className="text-lg font-medium"><SimulationText ko="과거 시점에서 다시 시작해 보기" en="Restarting from historical dates" /></h3>
    <ol className="my-5 grid gap-3 border-y border-[var(--line)] py-4 text-sm sm:grid-cols-3">
      <li><span className="mr-2 text-[var(--brand)]">01</span><SimulationText ko="90개 관측으로 모형 학습" en="Fit on 90 observations" /></li>
      <li><span className="mr-2 text-[var(--brand)]">02</span><SimulationText ko="미래를 보기 전에 비중 탐색" en="Search weights before seeing outcomes" /></li>
      <li><span className="mr-2 text-[var(--brand)]">03</span><SimulationText ko="다음 21개 실제 관측과 대조" en="Compare with the next 21 observations" /></li>
    </ol>
    <p className="text-sm leading-7 text-[var(--muted)]"><SimulationText ko="현재 보유 종목과 비중을 과거에 적용한 연구입니다. 겹치지 않는 최대 3개 구간을 사용하며, 경제지표 모형에서 고른 후보가 실제로 나빠진 구간도 그대로 표시합니다. 실제 과거 계좌 성과를 재현하는 기록은 아닙니다." en="This applies today's holdings and weights retrospectively over up to three non-overlapping periods. Candidate results remain visible even when they underperform. It is not a reconstruction of historical account performance." /></p>
    {!ready.length ? <p role="status" className="my-6 border-l-2 border-[var(--warning)] pl-4 text-sm leading-7"><SimulationText ko="학습과 이후 결과를 분리할 만큼의 공통 가격·환율·금리 이력이 아직 없습니다. 점검하지 못한 정확도를 좋다고 표시하지 않습니다." en="There is not enough aligned price, FX and yield history to separate training from later outcomes. No accuracy score is claimed for missing validation." /></p> : <>
      <p className="my-4 text-xs text-[var(--muted)]">{ready.length} / {result?.summary.endpointCount} <SimulationText ko="구간 확인 · 적은 표본만으로 예측력 우열을 판정하지 않습니다." en="periods available · Too few observations to establish forecasting superiority." /></p>
      <div className="overflow-x-auto"><table className="w-full min-w-[430px] text-right text-sm"><thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]"><th className="py-3 text-left"><SimulationText ko="현재 비중의 모형 비교" en="Model check at current weights" /></th><th><SimulationText ko="경제 상태 조건부" en="State-conditioned" /></th><th><SimulationText ko="무조건 요인 모형" en="Unconditional factor" /></th></tr></thead><tbody>
        <tr><td className="py-3 text-left"><SimulationText ko="P10~P90 실제 포함률" en="Observed P10–P90 coverage" /></td><td>{number(result?.summary.economic.bandCoveragePct, "%")}</td><td>{number(result?.summary.baseline.bandCoveragePct, "%")}</td></tr>
        <tr><td className="py-3 text-left"><SimulationText ko="중앙 수익률 평균 오차" en="Mean absolute median error" /></td><td>{number(result?.summary.economic.meanAbsoluteP50ErrorPctPoints, "%p")}</td><td>{number(result?.summary.baseline.meanAbsoluteP50ErrorPctPoints, "%p")}</td></tr>
        <tr><td className="py-3 text-left"><SimulationText ko="손실 확률 오차 · Brier" en="Loss probability error · Brier" /></td><td>{number(result?.summary.economic.meanLossBrierScore)}</td><td>{number(result?.summary.baseline.meanLossBrierScore)}</td></tr>
      </tbody></table></div>
      <p className="mt-2 text-xs leading-6 text-[var(--muted)]"><SimulationText ko="오차는 작을수록 좋습니다. 두 모형을 모두 계산할 수 있는 동일 구간만 집계합니다. Brier는 예측 손실 확률과 실제 손실 여부(0/1)의 차이를 제곱한 값입니다." en="Lower errors are better. Aggregates use only periods available for both models. Brier is the squared difference between predicted loss probability and the observed loss indicator (0/1)." /></p>
      <div className="mt-5 divide-y divide-[var(--line)]">{ready.map((row) => <details key={row.outcomeEndServiceDate} className="py-4">
        <summary className="cursor-pointer text-sm">{row.trainingEndServiceDate} → {row.outcomeEndServiceDate}<span className="ml-3 text-[var(--muted)]"><SimulationText ko="실제 수익률" en="Observed return" /> {number(row.currentObserved.terminalReturnPct, "%")}</span></summary>
        <p className="mt-3 text-xs text-[var(--muted)]"><SimulationText ko="실제 최대 낙폭" en="Observed MDD" /> {number(row.currentObserved.maxDrawdownPct, "%")}</p>
        {!row.candidates.length ? <p className="mt-3 text-sm"><SimulationText ko="해당 학습 구간에서 확인된 개선 후보 없음" en="No confirmed improvement candidate in this training window" /></p> : row.candidates.map((candidate) => <div key={candidate.objective} className="mt-4 border-t border-[var(--line)] pt-3 text-sm">
          <p className="font-medium">{candidate.objective === "median_growth" ? "P50" : candidate.objective === "downside_floor" ? "P10" : "P50 · P10"}</p>
          <p className="mt-2"><SimulationText ko="후보 실제 수익률" en="Candidate observed return" /> {number(candidate.observed.terminalReturnPct, "%")} <span className="ml-2 text-[var(--muted)]">(<SimulationText ko="현재 비중 대비" en="vs current weights" /> {number(candidate.actualReturnDeltaPctPoints, "%p")})</span></p>
          <p className="mt-2 text-[var(--muted)]"><SimulationText ko="최대 낙폭 변화" en="MDD change" /> {number(candidate.actualMddDeltaPctPoints, "%p")} <SimulationText ko="· 양수면 낙폭 증가" en="· Positive means a larger drawdown" /></p>
        </div>)}
      </details>)}</div>
    </>}
    <p className="mt-5 border-t border-[var(--line)] pt-4 text-xs leading-6 text-[var(--muted)]"><SimulationText ko="21단계 검증은 63·126단계 예측 정확도를 입증하지 않습니다. 최초 공표 시각·개정 전 경제지표 값은 보존되지 않아 엄격한 당시 정보 검증에도 한계가 있습니다. 매매 비용·세금은 포함하지 않습니다." en="A 21-step diagnostic does not establish 63- or 126-step forecast accuracy. Original publication timestamps and data vintages are not preserved. Trading costs and tax are excluded." /></p>
  </section>;
}
function number(value: number | null | undefined, suffix = "") { return value === null || value === undefined ? "—" : `${value.toFixed(2)}${suffix}`; }
