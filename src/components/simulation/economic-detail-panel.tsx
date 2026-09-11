import type { SimulationDetailData } from "@/db/queries/simulation-detail";
import { SimulationText } from "./simulation-text";
import { EconomicDataEvidence } from "./economic-execution-section";
import { ResearchFanChart, resolveResearchFanChartValueDomain } from "./research-fan-chart";
import { simulationReturnLabel } from "./simulation-presentation";
import { CalculationGuideDialog } from "@/components/explanations/calculation-guide-dialog";
import { economicCalculationGuide } from "./economic-calculation-guide";
import { EconomicValidationSection } from "./economic-validation-section";
import Link from "next/link";
import { buildPortfolioAnalysisScopeHref } from "@/lib/portfolio-analysis-scope";

export function EconomicDetailPanel({ data }: { data: SimulationDetailData }) {
  if (data.panel === "validation") return <EconomicValidationSection result={data.economicValidation} />;
  if (data.panel === "evidence") return <section>
    {data.economic ? <EconomicDataEvidence result={data.economic} /> : <Unavailable />}
    <EconomicHoldingEvidence data={data} />
    <Link className="mt-5 inline-flex min-h-11 items-center text-sm text-[var(--brand)] underline underline-offset-4" href={buildPortfolioAnalysisScopeHref("/portfolio/holdings", data.selectedScope.key)}><SimulationText ko="보유종목 준비 상태 확인" en="Review holding readiness" /></Link>
  </section>;
  const comparison = data.economicCandidates;
  if (!comparison || comparison.status !== "ready") return <Unavailable />;
  const current = comparison.currentExecution;
  const pathCount = comparison.pairing.pathCount;
  const searchPathCount = Math.ceil(pathCount / 2);
  const confirmationPathCount = Math.floor(pathCount / 2);
  const domain = resolveResearchFanChartValueDomain([current, ...comparison.outcomeCandidates.map((row) => row.execution)]);
  return <section data-economic-candidates>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-medium"><SimulationText ko="같은 미래, 다른 비중" en="Same paths, different weights" /></h3>
      <CalculationGuideDialog guide={economicCalculationGuide} label={{ ko: "탐색 원리", en: "Search method" }} title={{ ko: "비중 실험의 계산 원리", en: "How the weight experiment works" }} />
    </div>
    <p className="mt-2 text-sm leading-7 text-[var(--muted)]"><SimulationText ko={`경제 충격과 종목별 경로 ${pathCount.toLocaleString("ko-KR")}개는 그대로 두고 시작 비중만 바꿉니다. ${searchPathCount}개 경로에서 후보를 찾고 나머지 ${confirmationPathCount}개에서도 목적값이 개선된 경우만 표시합니다.`} en={`All ${pathCount.toLocaleString("en-US")} economic and holding paths stay fixed; only starting weights change. Candidates are searched on ${searchPathCount} paths and shown only if their objective also improves on the other ${confirmationPathCount}.`} /></p>
    <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[var(--line)] py-4 text-sm">
      <Metric ko="현재 P50 수익률" en="Current P50 return" value={simulationReturnLabel(current.terminal.p50Index)} />
      <Metric ko="현재 하위 P10" en="Current P10 return" value={simulationReturnLabel(current.terminal.p10Index)} />
      <Metric ko="현재 손실 종료" en="Current loss frequency" value={`${current.terminal.lossProbabilityPct.toFixed(1)}%`} />
    </div>
    {comparison.outcomeCandidates.length === 0 ? <p className="py-8 text-sm leading-7"><SimulationText ko="현재 제약 안에서는 탐색·확인 양쪽에서 개선된 후보를 찾지 못했습니다. 현재 비중이 최적이라는 뜻은 아닙니다." en="No candidate improved its objective in both partitions within these constraints. This does not establish that current weights are optimal." /></p> : <div className="divide-y divide-[var(--line)]">{comparison.outcomeCandidates.map((candidate) => <details key={candidate.objective} className="py-5" data-economic-objective={candidate.objective}>
      <summary className="cursor-pointer marker:text-[var(--brand)]"><span className="ml-2 text-base font-medium"><ObjectiveLabel objective={candidate.objective} /></span><span className="ml-3 text-xs text-[var(--muted)]"><SimulationText ko="확인 표본 목적값" en="Confirmation objective" /> +{candidate.confirmation.objectiveImprovementPctPoints.toFixed(2)}%p</span></summary>
      <p className="mt-3 text-sm text-[var(--muted)]"><SimulationText ko={`아래는 동일한 전체 ${pathCount.toLocaleString("ko-KR")}개 경로에서 현재 → 후보의 변화입니다. 다른 위험 지표까지 모두 좋아진다는 의미는 아닙니다. 후보 차트의 ${candidate.execution.samplePaths.length}개 표본선은 표시용이며 지표는 전체 경로로 계산합니다.`} en={`Below: current → candidate on the same full set of ${pathCount.toLocaleString("en-US")} paths. Other risk metrics can worsen. The candidate chart's ${candidate.execution.samplePaths.length} sample lines are for display; metrics use every path.`} /></p>
      <div className="my-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Metric ko="P50 수익률" en="P50 return" value={`${simulationReturnLabel(current.terminal.p50Index)} → ${simulationReturnLabel(candidate.execution.terminal.p50Index)}`} />
        <Metric ko="하위 P10" en="P10 return" value={`${simulationReturnLabel(current.terminal.p10Index)} → ${simulationReturnLabel(candidate.execution.terminal.p10Index)}`} />
        <Metric ko="손실 종료" en="Loss frequency" value={`${current.terminal.lossProbabilityPct.toFixed(1)} → ${candidate.execution.terminal.lossProbabilityPct.toFixed(1)}%`} />
        <Metric ko="P90 최대 낙폭" en="P90 MDD" value={`${current.terminal.maxDrawdownP90Pct.toFixed(1)} → ${candidate.execution.terminal.maxDrawdownP90Pct.toFixed(1)}%`} />
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[290px] text-right text-sm"><thead><tr className="text-xs text-[var(--muted)]"><th className="py-3 text-left"><SimulationText ko="종목" en="Holding" /></th><th><SimulationText ko="현재" en="Current" /></th><th><SimulationText ko="후보" en="Candidate" /></th><th><SimulationText ko="변화" en="Change" /></th></tr></thead><tbody>{candidate.weights.map((row) => <tr key={row.instrumentKey} className="border-t border-[var(--line)]"><td className="py-3 text-left">{row.ticker}</td><td>{(row.currentWeightBps / 100).toFixed(1)}%</td><td>{(row.candidateWeightBps / 100).toFixed(1)}%</td><td className={row.changeBps > 0 ? "text-[var(--brand)]" : row.changeBps < 0 ? "text-[var(--negative)]" : "text-[var(--muted)]"}>{row.changeBps > 0 ? "+" : ""}{(row.changeBps / 100).toFixed(1)}%p</td></tr>)}</tbody></table></div>
      <div className="mt-4"><ResearchFanChart compact execution={{ ...candidate.execution, name: candidate.objective === "median_growth" ? "P50" : candidate.objective === "downside_floor" ? "P10" : "P50 · P10" }} valueDomain={domain} /></div>
    </details>)}</div>}
    <p className="mt-5 border-t border-[var(--line)] pt-4 text-xs leading-6 text-[var(--muted)]"><SimulationText ko="매도·매수 총 교체는 편도 20%, 비원화 노출 변화는 10%p, 종목 상한은 35%와 현재 최대 비중 중 큰 값입니다. 공매도·차입은 없고 수수료·세금은 제외합니다. 제한된 국소 탐색 결과로, 전역 최적해나 투자 권유가 아닙니다. 별도 시기 검증은 ‘과거 검증’에서 확인하세요." en="One-way turnover is limited to 20%, non-KRW exposure change to 10pp, and each holding to the greater of 35% or the current largest weight. No shorts or leverage; fees and tax excluded. This is a bounded local search, not a global optimum or an investment recommendation. See Historical validation for tests on later observed periods." /></p>
  </section>;
}

export function ObjectiveLabel({ objective }: { objective: string }) {
  return <SimulationText ko={objective === "median_growth" ? "중앙 수익률을 높이는 구성" : objective === "downside_floor" ? "하위 결과를 방어하는 구성" : "수익·하방의 균형 구성"} en={objective === "median_growth" ? "Higher median return" : objective === "downside_floor" ? "Stronger lower-tail boundary" : "Return and downside balance"} />;
}
function Metric({ ko, en, value }: { ko: string; en: string; value: string }) { return <div><p className="text-xs text-[var(--muted)]"><SimulationText ko={ko} en={en} /></p><p className="mt-2 font-medium tabular-nums">{value}</p></div>; }
function Unavailable() { return <p role="status" className="py-8 text-sm leading-7"><SimulationText ko="경제지표 경로가 준비되면 이 분석을 계산할 수 있습니다. 메인 화면에서 종목 이력과 경제지표 상태를 확인해 주세요." en="This analysis needs ready economic paths. Check holding history and economic-data status on the main screen." /></p>; }

function EconomicHoldingEvidence({ data }: { data: SimulationDetailData }) {
  const preflight = data.inputPreflight;
  if (!preflight) return null;
  return <section className="mt-7 border-t border-[var(--line)] pt-5" data-economic-holding-evidence>
    <h3 className="text-lg font-medium"><SimulationText ko="포함 종목과 준비 상태" en="Holdings and input readiness" /></h3>
    <p className="mt-2 text-sm leading-7 text-[var(--muted)]"><SimulationText ko="현재 평가액에서 계산 대상 종목만 100%로 환산합니다. 아래 현재 비중은 환산 전이며, 계산 비중은 경제 경로가 준비되었을 때 표시합니다. 이력이 부족한 종목을 임의의 값으로 채우지 않습니다." en="Included holdings are renormalized to 100% of modeled value. Current weights below are before that normalization; model weights appear when economic paths are ready. Missing holding history is not invented." /></p>
    <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {data.instruments.map((row) => {
        const weight = data.economic?.executionWeights.find((item) => item.instrumentKey === row.instrumentKey);
        return <div key={row.instrumentKey} className="flex flex-wrap justify-between gap-3 py-4 text-sm" data-economic-holding={row.instrumentKey}>
          <div className="min-w-0 flex-1 basis-40">
            <p className="font-medium">{row.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.ticker} · {row.currency}</p>
            <p className="mt-2 text-xs leading-6"><SimulationText {...holdingRoleCopy(row.executionRole, weight !== undefined)} /> · <SimulationText {...holdingHistoryCopy(row.historicalStatus)} /></p>
          </div>
          <div className="text-right text-xs leading-6 tabular-nums">
            <p><SimulationText ko="현재 비중" en="Current weight" /> {row.originalWeightBps === null ? "—" : `${(row.originalWeightBps / 100).toFixed(2)}%`}</p>
            <p><SimulationText ko="계산 비중" en="Model weight" /> {weight ? `${(weight.weightBps / 100).toFixed(2)}%` : "—"}</p>
          </div>
        </div>;
      })}
    </div>
    {preflight.summary.fountExcludedHoldingCount > 0 ? <p className="mt-3 text-sm leading-7" data-economic-policy-exclusion>Fount {preflight.summary.fountExcludedHoldingCount}<SimulationText ko="개 보유 기록은 사용자 설정에 따라 이 연구에서 제외됩니다." en=" holding records are excluded from this research by your configuration." /></p> : null}
    {preflight.blockers.length > 0 ? <ul className="mt-3 space-y-2 text-sm leading-7 text-[var(--warning)]" data-economic-input-blockers>{preflight.blockers.map((reason) => <li key={reason}><SimulationText {...holdingBlockerCopy(reason)} /></li>)}</ul> : null}
    {preflight.valuationGaps.length > 0 ? <div className="mt-4 text-sm" data-economic-valuation-gaps><h4 className="font-medium"><SimulationText ko="현재 평가 확인 필요" en="Current valuation needs checking" /></h4><ul className="mt-2 space-y-2 text-[var(--muted)]">{preflight.valuationGaps.map((row, index) => <li key={index}>{row.name} · <SimulationText {...valuationGapCopy(row.reason)} /></li>)}</ul></div> : null}
    {preflight.identityGaps.length > 0 ? <div className="mt-4 text-sm" data-economic-identity-gaps><h4 className="font-medium"><SimulationText ko="종목 식별 확인 필요" en="Holding identity needs checking" /></h4><ul className="mt-2 space-y-2 text-[var(--muted)]">{preflight.identityGaps.map((row, index) => <li key={index}>{row.name}{row.ticker ? ` · ${row.ticker}` : ""}</li>)}</ul></div> : null}
  </section>;
}

function holdingRoleCopy(role: string, included: boolean) {
  if (included) return { ko: "계산에 포함", en: "Included in paths" };
  if (role === "modeled") return { ko: "계산 대상 · 아직 미실행", en: "Eligible holding · paths not run" };
  if (role === "omitted_manual_history") return { ko: "제외 · 별도 평가 이력 필요", en: "Excluded · separate valuation history required" };
  return { ko: "제외 · 현재 비중 없음", en: "Excluded · no current weight" };
}

function holdingHistoryCopy(status: string) {
  const labels: Record<string, { ko: string; en: string }> = {
    provenance_ready_for_separate_review: { ko: "가격 이력 사용 가능", en: "Price history available" },
    stored_coverage_incomplete: { ko: "가격 이력 부족", en: "Insufficient price history" },
    provenance_incomplete: { ko: "가격 출처 확인 필요", en: "Price-source evidence needed" },
    zero_weight_not_evaluated: { ko: "비중이 없어 이력 미점검", en: "History not checked for zero weight" },
    excluded_by_policy: { ko: "정책에 따라 이력 제외", en: "History excluded by policy" },
    manual_history_required: { ko: "기록된 평가 이력 필요", en: "Recorded valuation history required" },
    identity_unresolved: { ko: "종목 식별 필요", en: "Holding identity needed" },
  };
  return labels[status] ?? { ko: "가격 이력 확인 필요", en: "Price history needs checking" };
}

function holdingBlockerCopy(reason: string) {
  const labels: Record<string, { ko: string; en: string }> = {
    account_scope_mismatch: { ko: "선택한 분석 범위를 다시 확인해 주세요.", en: "Review the selected analysis scope." },
    empty_positive_portfolio: { ko: "평가액이 있는 보유종목이 필요합니다.", en: "Holdings with a positive current value are required." },
    valuation_evidence_incomplete: { ko: "현재 가격이나 환율을 확인하지 못한 종목이 있습니다.", en: "Some holdings need current price or FX evidence." },
    instrument_identity_unresolved: { ko: "종목 정보를 확인해야 계산을 시작할 수 있습니다.", en: "Holding identities must be resolved before calculation." },
    instrument_limit_exceeded: { ko: "계산 가능한 종목 수 한도를 넘었습니다.", en: "The supported holding-count limit was exceeded." },
    weight_derivation_failed: { ko: "현재 평가액으로 비중을 계산하지 못했습니다.", en: "Weights could not be calculated from current values." },
  };
  return labels[reason] ?? { ko: "보유종목의 준비 상태를 확인해 주세요.", en: "Review holding readiness." };
}

function valuationGapCopy(reason: string) {
  if (reason === "missing_price") return { ko: "현재 가격 없음", en: "Current price missing" };
  if (reason === "missing_fx") return { ko: "환율 없음", en: "FX rate missing" };
  if (reason === "unsupported_currency") return { ko: "지원하지 않는 통화", en: "Unsupported currency" };
  return { ko: "평가 근거 확인 필요", en: "Valuation evidence needed" };
}
