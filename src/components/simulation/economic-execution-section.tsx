import type { SimulationEconomicPresentation } from "@/db/queries/simulation-owner-economic";
import type { SimulationOwnerResearchExecutionResult } from "@/lib/simulation-owner-research-execution";
import { CalculationGuideDialog } from "@/components/explanations/calculation-guide-dialog";
import { InvestmentLabDialog } from "@/components/investment-lab/investment-lab-dialog";
import { economicCalculationGuide } from "./economic-calculation-guide";
import { ResearchFanChart } from "./research-fan-chart";
import { SimulationText } from "./simulation-text";
import { simulationReturnLabel } from "./simulation-presentation";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";
import styles from "./simulation-workspace.module.css";

export function EconomicExecutionSection({ result, baseline }: {
  result: SimulationEconomicPresentation;
  baseline: SimulationOwnerResearchExecutionResult;
}) {
  return <section data-economic-execution={result.status} className={`${styles.execution} ${styles.economicExecution}`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-medium sm:text-base"><SimulationText ko="경제지표 시뮬레이션" en="Economic simulation" /></h2>
      <CalculationGuideDialog guide={economicCalculationGuide} label={{ ko: "계산 과정", en: "How it works" }} title={{ ko: "경제지표에서 내 자산까지", en: "From economic indicators to your assets" }} />
    </div>
    <p className="mt-2 text-xs leading-6 text-[var(--muted)]">
      <SimulationText ko="환율 · 금리 · 종목 가격을 함께 변화시킨 조건부 연구" en="Conditional research with joint FX, yield and holding-price changes" />
      {" · "}{baseline.coverage.modeledCurrentValuePct.toFixed(1)}<SimulationText ko="% 포함" en="% covered" />
    </p>
    {result.status !== "ready" ? <div role="status" className="my-6 border-y border-[var(--line)] py-10" data-economic-unavailable={result.reason}>
      <p className="text-xl"><SimulationText ko="경제지표 경로를 아직 계산할 수 없습니다." en="Economic paths cannot be calculated yet." /></p>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]"><SimulationText ko="현재 보유 종목의 가격 이력과 환율·금리의 겹치는 관측이 필요합니다. 최신 경제지표가 오래됐거나 이력이 부족하면 이 모형은 실행하지 않습니다. ‘과거 수익률 경로’를 선택해 준비된 다른 모형을 확인할 수 있습니다." en="This model needs overlapping holding returns, FX and yields, plus recent economic observations. Missing or stale evidence stops this model. Select Historical paths to inspect the other model if its data is ready." /></p>
      <p className="mt-3 text-xs text-[var(--muted)]"><SimulationText ko="확인 상태" en="Status" />: <EconomicReason reason={result.reason} /></p>
      <EconomicObservationReadiness result={result} />
      <p className="mt-4 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="‘모형·데이터’에서 종목별 준비 상태와 경제지표의 날짜를 확인하세요. 종목 가격 이력은 보유종목 관리에서 확인할 수 있습니다." en="Open Model & data for each holding's readiness and economic-data dates. Review holding price history in holdings management." /></p>
    </div> : <>
      <details className={styles.startingFactors} data-economic-starting-state>
        <summary><SimulationText ko="경제지표 출발값" en="Starting economic values" /><span><SimulationText ko="환율 · 금리" en="FX · yields" /></span></summary>
        <div className="flex flex-wrap gap-x-6 gap-y-2 pb-3">
        {result.currentFactors.map((factor) => <InvestmentLabDialog key={factor.factorKey} label={`${factor.factorKey === "usdkrw" ? "USD/KRW" : factor.factorKey === "us_10y_yield" ? "미국 10년" : "장단기 금리차"} ${factor.value.toFixed(2)}${factor.factorKey === "usdkrw" ? "" : factor.factorKey === "us_10y_yield" ? "%" : "%p"}`} labelEn={`${factor.label} ${factor.value.toFixed(2)}${factor.factorKey === "usdkrw" ? "" : factor.factorKey === "us_10y_yield" ? "%" : "pp"}`} title={factor.factorKey === "usdkrw" ? "달러/원 환율" : factor.factorKey === "us_10y_yield" ? "미국 10년 국채금리" : "미국 장단기 금리차"} titleEn={factor.label} icon="table">
          <p className="text-sm text-[var(--muted)]"><SimulationText ko="출발값" en="Starting value" /> {factor.value.toFixed(2)} {factor.factorKey === "usdkrw" ? "KRW / USD" : factor.factorKey === "us_10y_yield" ? "%" : "%p"} · {factor.factorDate}</p>
          <FactorTrajectory result={result} factorKey={factor.factorKey} />
          <p className="text-xs leading-6 text-[var(--muted)]"><SimulationText ko={`선은 단계별 중앙값, 면은 P10~P90입니다. ${result.assumptions.pathCount.toLocaleString("ko-KR")}개 경로에서 집계한 분포이며 실제 경제지표 전망을 보장하지 않습니다.`} en={`The line is the stepwise median; the band is P10–P90 across ${result.assumptions.pathCount.toLocaleString("en-US")} paths. This is a model distribution, not an assured economic forecast.`} /></p>
        </InvestmentLabDialog>)}
        </div>
      </details>
      <div className={styles.resultLayout}>
        <dl className={styles.resultSummary}>
          <div><dt><SimulationText ko="마지막 수익률 중간값" en="Median final return" /></dt><dd>{simulationReturnLabel(100 + result.terminal.p50ReturnPct)}</dd><p>{result.assumptions.horizon}<SimulationText ko={`단계 · ${result.assumptions.pathCount.toLocaleString("ko-KR")}개 공동 경로`} en={` steps · ${result.assumptions.pathCount.toLocaleString("en-US")} joint paths`} /></p></div>
          <div><dt><SimulationText ko="손실로 끝난 경로" en="Paths ending in loss" /></dt><dd>{result.terminal.lossProbabilityPct.toFixed(1)}%</dd><p><SimulationText ko="이 모형의 가정 안에서 계산한 비율" en="Frequency under this model's assumptions" /></p></div>
          <div><dt><SimulationText ko="중간 최대 하락 · P90 MDD" en="Largest drop · P90 MDD" /></dt><dd>{result.terminal.maxDrawdownP90Pct.toFixed(1)}%</dd><p><SimulationText ko="약 10% 경로는 이보다 더 하락" en="About 10% of paths fell further" /></p></div>
        </dl>
        <ResearchFanChart large execution={result} />
      </div>
      <InvestmentLabDialog label="출발 상태와 포함 종목" labelEn="Starting state & holdings" title="경제지표와 자산을 연결한 근거" titleEn="How economic data connects to holdings" icon="table" size="wide">
        <EconomicDataEvidence result={result} />
        <div className="mt-6 border-y border-[var(--line)]"><SimulationTerminalRiskMetrics terminal={result.terminal} /></div>
        <p className="mt-4 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="저장된 종가와 날짜별 환율로 계산합니다. 미조정 종가는 배당·분할을 반영한 총수익률과 다릅니다. 환율 효과는 이미 원화 수익률에 들어 있어 다시 곱하지 않습니다. 현재 평가액에서 제외된 부분은 포함 종목만 100%로 환산합니다." en="Inputs use stored closes and dated FX. Raw closes differ from dividend/split-adjusted total returns. FX is already represented in KRW returns and is not multiplied twice. Included holdings are renormalized to 100% when coverage is partial." /></p>
        <div className="mt-5 divide-y divide-[var(--line)]">{result.executionWeights.map((row) => <div key={row.instrumentKey} className="flex justify-between gap-4 py-3 text-sm"><span>{row.ticker} <span className="text-[var(--muted)]">{row.currency}</span></span><span>{(row.weightBps / 100).toFixed(2)}%</span></div>)}</div>
      </InvestmentLabDialog>
    </>}
  </section>;
}

export function EconomicDataEvidence({ result }: { result: SimulationEconomicPresentation }) {
  return <section data-economic-evidence>
    <h3 className="text-lg font-medium"><SimulationText ko="현재 지원하는 경제지표" en="Economic indicators in this model" /></h3>
    <p className="mt-2 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="USD/KRW, 미국 10년 국채금리, 미국 10년−2년 금리차를 사용합니다. 각국 정책금리나 뉴스 전체를 반영하는 모형은 아닙니다. 주식 가격은 보유 종목의 과거 공동 수익률과 각 지표에 대한 민감도로 함께 생성됩니다." en="Inputs are USD/KRW, the US 10-year Treasury yield and the US 10Y−2Y spread. This model does not cover all countries' policy rates or news. Holding-price paths combine joint historical returns with estimated sensitivity to these indicators." /></p>
    {result.status !== "ready" ? <p role="status" className="mt-4 text-sm leading-7 text-[var(--warning)]"><EconomicReason reason={result.reason} /></p> : null}
    <div className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">{result.factorSources.map((row) => <div key={row.factorKey} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><strong className="font-medium">{row.label}</strong><span className="text-[var(--muted)]"><SimulationText ko="공표일" en="Release" /> {row.currentReleaseDate ?? "—"}{row.currentCarryDays !== null ? <> · {row.currentCarryDays}<SimulationText ko="일 경과" en=" days old" /></> : null}{row.currentCarryDays === null ? <> · <SimulationText ko="관측 없음" en="No observation" /></> : row.currentCarryDays > result.policy.factorMaximumCarryDays ? <> · <SimulationText ko="최신성 기준 초과" en="Too old for this cutoff" /></> : null}</span></div>)}</div>
    <EconomicObservationReadiness result={result} />
    {result.status === "ready" ? <>
      <div className="my-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-[var(--muted)]"><SimulationText ko="겹치는 관측" en="Aligned observations" /></p><p className="mt-2">{result.source.alignedObservationCount}</p></div>
        <div><p className="text-xs text-[var(--muted)]"><SimulationText ko="출발 상태 유효 표본" en="Initial effective sample" /></p><p className="mt-2">{result.diagnostics.initialEffectiveSampleSize.toFixed(1)}</p></div>
        <div><p className="text-xs text-[var(--muted)]"><SimulationText ko="조건부 평균 반영" en="Initial local-mean blend" /></p><p className="mt-2">{(result.diagnostics.initialLocalBlend * 100).toFixed(1)}%</p></div>
        <div><p className="text-xs text-[var(--muted)]"><SimulationText ko="관측 범위 밖 모의 단계" en="Steps outside support" /></p><p className="mt-2">{result.diagnostics.extrapolatedStepsPct.toFixed(1)}%</p></div>
      </div>
    </> : null}
    <p className="mt-4 text-xs leading-6 text-[var(--muted)]"><SimulationText ko="가격 이력 기준일" en="Return-history cutoff" /> {result.source.matrixEndServiceDate ?? "—"} · <SimulationText ko="경제 상태 기준일" en="Economic-state cutoff" /> {result.source.stateAsOfServiceDate || "—"}</p>
    {result.status !== "ready" ? <p className="mt-3 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="자료를 임의로 채우지 않습니다. 아래 종목별 상태와 보유종목 관리에서 가격 이력을 확인하세요. 경제지표가 없거나 오래된 경우에는 최신 저장 자료가 필요하며, 기준일을 직접 선택했다면 계산 조건도 확인해 주세요." en="Missing evidence is not invented. Check holding readiness below and price history in holdings management. Missing or stale economic indicators need recent stored observations; also review Calculation settings if you selected a cutoff date." /></p> : null}
    <p className="mt-4 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="현재와 비슷한 과거 상태에서 관측된 다음 변화를 약하게 반영합니다. 모의 상태가 관측 범위를 벗어나면 조건부 평균의 영향이 줄어듭니다. 경제지표 사이 공분산은 과거 추정치를 유지합니다." en="The next change is weakly conditioned on similar historical states. That influence fades as simulated states move outside observed support. Economic-shock covariance remains the historical estimate." /></p>
    <p className="mt-3 text-xs leading-6 text-[var(--muted)]"><SimulationText ko="공표 당일 자료는 다음 서비스 일자부터 사용합니다. 실제 최초 공개시각과 개정 전 값은 보존되지 않아 엄격한 당시 정보 재현은 아닙니다. 예측 정확도 개선은 아직 입증되지 않았습니다." en="Same-day releases are deferred to a later service date. Original release timestamps and unrevised vintages are not preserved, so strict point-in-time reconstruction is not established. Improved forecasting accuracy has not been established." /></p>
  </section>;
}

function FactorTrajectory({ result, factorKey }: { result: Extract<SimulationEconomicPresentation, { status: "ready" }>; factorKey: string }) {
  const factor = result.factorBands.find((row) => row.factorKey === factorKey);
  if (!factor?.points.length) return null;
  const points = factor.points;
  const low = Math.min(...points.map((row) => row.p10));
  const high = Math.max(...points.map((row) => row.p90));
  const span = high - low || Math.max(Math.abs(high) * 0.01, 0.01);
  const x = (index: number) => 56 + index / Math.max(1, points.length - 1) * 476;
  const y = (value: number) => 220 - (value - low) / span * 180;
  const line = points.map((row, i) => `${x(i)},${y(row.p50)}`).join(" ");
  const band = [...points.map((row, i) => `${x(i)},${y(row.p90)}`), ...points.map((row, i) => `${x(i)},${y(row.p10)}`).reverse()].join(" ");
  return <figure className="my-4"><svg viewBox="0 0 550 250" role="img" aria-label={`${factorKey} P10 P50 P90`} className="w-full overflow-visible">
    <line x1="56" x2="532" y1="220" y2="220" stroke="var(--line)" />
    <text x="48" y="42" textAnchor="end" fill="var(--muted)" fontSize="11">{high.toFixed(2)}</text><text x="48" y="220" textAnchor="end" fill="var(--muted)" fontSize="11">{low.toFixed(2)}</text>
    <polygon points={band} fill="var(--brand)" opacity="0.12" /><polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2" className={styles.fanReveal} />
    <text x="56" y="244" fill="var(--muted)" fontSize="11">0</text><text x="532" y="244" textAnchor="end" fill="var(--muted)" fontSize="11">{points.at(-1)?.stepIndex}</text>
  </svg></figure>;
}

function EconomicReason({ reason }: { reason: string | null }) {
  if (reason === "insufficient_factor_overlap") return <SimulationText ko="환율·금리와 겹치는 이력 부족" en="Insufficient overlap with FX and yields" />;
  if (reason === "current_factor_state_stale") return <SimulationText ko="경제지표가 기준일의 최신성 한도를 넘었습니다." en="Economic observations are too old for the selected cutoff." />;
  if (reason === "current_factor_state_missing") return <SimulationText ko="기준일 이전에 사용할 경제지표 관측이 없습니다." en="Required economic observations are missing before the selected cutoff." />;
  if (reason === "invalid_state_as_of_date") return <SimulationText ko="계산 조건에서 경제 상태 기준일을 확인해 주세요." en="Review the economic-state cutoff in Calculation settings." />;
  if (reason === "invalid_factor_evidence") return <SimulationText ko="저장된 경제지표의 값이나 날짜를 확인해야 합니다." en="Stored economic values or dates need checking." />;
  if (reason?.includes("covariance") || reason === "simulation_nonfinite" || reason === "path_summary_unavailable") return <SimulationText ko="모형의 수치 계산을 완료하지 못했습니다. 다른 값으로 대체하지 않았습니다." en="The model's numerical calculation could not be completed. No substitute result was used." />;
  return <SimulationText ko="종목 식별·가격 이력 또는 모형 계산 조건 확인 필요" en="Holding identity, price history or model inputs need checking" />;
}

function EconomicObservationReadiness({ result }: { result: SimulationEconomicPresentation }) {
  // Overlap is not evaluated when current-state admission fails. A default zero
  // in that branch must not be displayed as an observed history count.
  if (result.status === "ready" || !["insufficient_factor_overlap", "insufficient_observations"].includes(result.reason)) return null;
  return <p className="mt-3 text-sm tabular-nums" data-economic-observation-shortfall>
    <SimulationText ko="함께 사용할 수 있는 관측" en="Usable aligned observations" /> {result.source.alignedObservationCount} / {result.source.requiredAlignedObservationCount}
    {" · "}<SimulationText ko="추가로 필요한 관측" en="Additional observations needed" /> {result.source.observationShortfall}
  </p>;
}
