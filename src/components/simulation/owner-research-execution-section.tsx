import Link from "next/link";
import { SimulationText } from "@/components/simulation/simulation-text";
import { buildPortfolioAnalysisScopeHref, type PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import type { SimulationOwnerResearchExecutionResult } from "@/lib/simulation-owner-research-execution";
import { InvestmentLabDialog as SimulationDialog } from "@/components/investment-lab/investment-lab-dialog";
import { CalculationGuideDialog } from "@/components/explanations/calculation-guide-dialog";
import { simulationCalculationGuide } from "./simulation-calculation-guide";
import { ResearchFanChart } from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";
import { simulationReturnLabel } from "./simulation-presentation";
import styles from "./simulation-workspace.module.css";

type ReadyExecution = Extract<
  SimulationOwnerResearchExecutionResult,
  { status: "ready" }
>;

export function OwnerResearchExecutionSection({
  execution,
  selectedScopeKey,
}: {
  execution: SimulationOwnerResearchExecutionResult;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  return (
    <section
      aria-labelledby="owner-research-execution-title"
      className={styles.execution}
      data-owner-research-execution
      data-owner-research-account={execution.account}
      data-owner-research-status={execution.status}
      data-owner-research-end-source={execution.endSelection.source}
    >
      <div className={`${styles.executionHeader} flex flex-wrap items-start justify-between gap-4`}>
        <div>
          <h2
            className="text-base font-semibold sm:text-lg"
            id="owner-research-execution-title"
          >
            <SimulationText ko={"내 포트폴리오 확률 경로"} />{" "}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1">
        <CalculationGuideDialog
          guide={simulationCalculationGuide}
          label={{ ko: "계산 과정", en: "How it works" }}
          title={{ ko: "시뮬레이션, 이렇게 계산해요", en: "How the simulation is calculated" }}
        />
        <SimulationDialog
          label="종목별 계산 근거" labelEn="Holdings & calculation evidence"
          title="사용한 종목과 계산 근거" titleEn="Holdings and calculation evidence"
          icon="table"
          size="wide"
          compactLabel
        >
          <p className="text-sm leading-6 text-[var(--muted)]"><SimulationText ko="어떤 종목이 포함됐는지 먼저 확인하세요. 계산 방식과 용어는 ‘계산 과정’에서 순서대로 볼 수 있습니다." en="Check which holdings were included below. The How it works guide walks through the method and terms." /></p>
          <details className="mt-4 border-y border-[var(--line)] py-3">
            <summary className="cursor-pointer text-sm font-medium"><SimulationText ko="계산 기준 상세" en="Detailed calculation criteria" /></summary>
          <div className="mt-4 grid gap-6 text-sm leading-7 text-[var(--muted)] sm:grid-cols-2">
            <div>
              <h3 className="mb-2 font-medium text-[var(--ink)]">
                P10 · P50 · P90
              </h3>
              <p>
                <SimulationText ko={"각 시점에서 계산 경로의 아래 10%, 중앙 50%, 위 90% 경계입니다. P10~P90은 모형 안에서 약 80%의 경로가 위치하는 구간이며, 실제 미래에 대한 80% 보장 구간은 아닙니다."} />{" "}</p>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--ink)]">
                <SimulationText ko={"손실 확률과 최대 낙폭"} />{" "}</h3>
              <p>
                <SimulationText ko={"손실 종료 확률은 종료값이 시작값보다 작은 경로의 비율입니다. MDD는 경로 안에서 고점 대비 가장 크게 하락한 폭입니다. P90 MDD는 더 큰 손실 쪽 경계입니다."} />{" "}</p>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--ink)]">
                <SimulationText ko={`${execution.policy.pathCount.toLocaleString("ko-KR")}개 경로 · 전체 표시`} en={`${execution.policy.pathCount.toLocaleString("en-US")} paths · All displayed`} />{" "}</h3>
              <p>
                <SimulationText ko={`최근 90개 공동 수익률을 평균 5단계 블록으로 재표본 추출합니다. 최초 배분 후 리밸런싱 없이 ${execution.policy.pathCount.toLocaleString("ko-KR")}개 경로를 계산하며, 메인 차트에는 전체 경로와 분포를 표시합니다. 비중 후보 차트의 표본선과 달리 지표는 전체 경로로 계산합니다.`} en={`Resample the latest 90 joint returns in blocks averaging five steps. Calculate ${execution.policy.pathCount.toLocaleString("en-US")} paths with no rebalancing after initial allocation. The main chart displays every path and the distribution. Candidate charts show sample lines, while metrics use every path.`} />{" "}</p>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--ink)]">
                <SimulationText ko={"포함 범위와 가정"} />{" "}</h3>
              <p>
                <SimulationText ko={"현재 평가액의"} />{" "}
                {execution.coverage.modeledCurrentValuePct.toFixed(2)}<SimulationText ko={"%가 계산 대상입니다. 제외한 비중은 이력을 꾸며내지 않고 남겨 두며, 포함 종목만 100%로 다시 환산합니다. 수수료·세금·현금수익률 미포함, 조회 시 계산 · 저장 안 함."} />{" "}</p>
            </div>
          </div>
          </details>
          {execution.status === "ready" &&
          execution.coverage.omittedWeightBps > 0 ? (
            <p
              data-owner-research-partial-coverage
              className="mt-6 border-l-2 border-[var(--warning)] pl-3 text-sm leading-7 text-[var(--warning)]"
            >
              {formatWeight(execution.coverage.omittedWeightBps)} {" "}<SimulationText ko={"제외 · 포함 종목만 100%로 환산한 부분 포트폴리오입니다."} />{" "}</p>
          ) : null}
          <div className="mt-6 overflow-x-auto border-y border-[var(--line)]">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted)]">
                  <th className="py-3 font-normal"><SimulationText ko={"종목"} /></th>
                  <th className="py-3 text-right font-normal"><SimulationText ko={"현재 비중"} /></th>
                  <th className="py-3 text-right font-normal"><SimulationText ko={"계산 비중"} /></th>
                  <th className="py-3 text-right font-normal"><SimulationText ko={"포함 여부"} /></th>
                </tr>
              </thead>
              <tbody>
                {execution.instruments.map((row) => {
                  const weight =
                    execution.status === "ready"
                      ? execution.executionWeights.find(
                          (item) => item.instrumentKey === row.instrumentKey,
                        )
                      : null;
                  return (
                    <tr
                      key={row.instrumentKey}
                      className="border-t border-[var(--wash)]"
                    >
                      <td className="py-3">
                        {row.name}
                        <span className="ml-2 text-xs text-[var(--faint)]">
                          {row.ticker}
                        </span>
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        <SimulationText ko={row.originalWeightBps === null
                          ? "미확인"
                          : formatWeight(row.originalWeightBps)} />
                      </td>
                      <td className="py-3 text-right tabular-nums">
                        {weight ? formatWeight(weight.weightBps) : "-"}
                      </td>
                      <td className="py-3 text-right text-xs text-[var(--muted)]">
                        <SimulationText ko={row.executionRole === "omitted_manual_history"
                          ? "수동 평가 제외"
                          : row.executionRole === "omitted_zero_weight"
                            ? "비중 없음"
                            : execution.status === "ready"
                              ? "포함"
                              : "입력 확인 필요"} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {execution.status === "ready" ? (
            <div className="mt-8">
              <h3 className="text-lg font-medium text-[var(--ink)]">
                <SimulationText ko={"위험과 계산 근거"} />{" "}</h3>
              <div className="mt-4 border-y border-[var(--line)]">
                <SimulationTerminalRiskMetrics terminal={execution.terminal} />
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
                <SimulationText ko={"기준일"} />{" "}{formatDate(execution.source.endServiceDate)} {" "}<SimulationText ko={"· 입력 수익률"} />{" "}{execution.source.returnStepCount}<SimulationText ko={"개 · 평균 블록 5단계 · 최초 배분 후 리밸런싱 없음"} />{" "}</p>
              {execution.source.priceBasis === "raw_price_return" ? (
                <p
                  data-owner-research-raw-close-disclosure
                  className="mt-2 text-sm leading-7 text-[var(--warning)]"
                >
                  <SimulationText ko={"저장된 KIS 미조정 종가·날짜별 환율 기준. 배당·액면분할 조정 총수익률이 아닙니다."} />{" "}</p>
              ) : null}
            </div>
          ) : null}
          {execution.status === "ready" ? <ExecutionAssumptions execution={execution} /> : null}
        </SimulationDialog>
        </div>
      </div>
      <p className={styles.executionMeta}>
        <span>
          <SimulationText ko={execution.endSelection.endServiceDate
            ? formatDate(execution.endSelection.endServiceDate)
            : "기준일 미확인"} />{" "}
          <span className="hidden sm:inline"> · <SimulationText ko={endSourceLabel(execution.endSelection.source)} /></span>
        </span>
        <span>
          {execution.coverage.modeledInstrumentCount} /{" "}
          {execution.coverage.candidateInstrumentCount}<SimulationText ko={"종목"} en=" holdings" />{" "}</span>
        <span>
          {execution.coverage.modeledCurrentValuePct.toFixed(1)}<SimulationText ko={"% 포함"} />{" "}</span>
        {execution.coverage.omittedWeightBps > 0 ? <span className="text-[var(--warning)]"><SimulationText ko={"일부 종목 제외"} /></span> : null}
      </p>
      {execution.status === "ready" ? (
        <ReadyOwnerExecution execution={execution} />
      ) : (
        <div
          data-owner-research-unavailable-reason={execution.reason}
          className="my-8 flex min-h-64 flex-col justify-center border-y border-[var(--line)]"
        >
          <p className="text-xl font-medium">
            <SimulationText ko="아직 이 구성으로 계산할 수 없습니다." en="This portfolio cannot be simulated yet." /></p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
            <SimulationText {...unavailableReasonLabel(execution.reason)} />
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {execution.reason === "invalid_end_service_date" || execution.reason === "invalid_horizon_selection" ? (
              <SimulationText ko="최신 공통 기준일과 기본 기간으로 돌아가 다시 계산할 수 있습니다." en="Return to the latest common date and default period to recalculate." />
            ) : (
              <SimulationText ko="종목 관리에서 현재 가격과 과거 가격의 준비 상태를 확인하세요. 내 가입 전 시장 이력도 사용할 수 있으며, 개인 투자 기록이 쌓일 때까지 기다릴 필요는 없습니다." en="Check current prices and historical data readiness in holdings. Market history from before signup can be used; you do not need to wait for personal investment records." />
            )}
          </p>
          <Link
            href={buildPortfolioAnalysisScopeHref(
              execution.reason === "invalid_end_service_date" || execution.reason === "invalid_horizon_selection" ? "/simulation" : "/portfolio/holdings",
              selectedScopeKey,
            )}
            prefetch={false}
            className="mt-5 inline-flex min-h-11 w-fit items-center rounded-full bg-[var(--ink)] px-5 py-2 text-sm font-medium text-[var(--paper)] transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
          >
            {execution.reason === "invalid_end_service_date" || execution.reason === "invalid_horizon_selection" ? (
              <SimulationText ko="기본 조건으로 다시 계산" en="Recalculate with default settings" />
            ) : (
              <SimulationText ko="종목·분석 데이터 확인" en="Check holdings and analysis data" />
            )}
          </Link>
        </div>
      )}
    </section>
  );
}

function ReadyOwnerExecution({ execution }: { execution: ReadyExecution }) {
  return (
    <div
      className={styles.resultLayout}
      data-owner-research-horizon={execution.assumptions.horizon}
      data-owner-research-path-count={execution.assumptions.pathCount}
    >
      <dl className={styles.resultSummary}>
        <div>
          <dt><SimulationText ko="마지막 수익률 중간값" en="Middle final return" /></dt>
          <dd className={execution.terminal.p50ReturnPct >= 0 ? "text-[var(--brand)]" : "text-[var(--negative)]"}>
            <SimulationText ko={simulationReturnLabel(100 + execution.terminal.p50ReturnPct)} />
          </dd>
          <p>{execution.assumptions.horizon}<SimulationText ko={`단계 후 · ${execution.assumptions.pathCount.toLocaleString("ko-KR")}개 경로의 가운데 값`} en={` steps · Middle of ${execution.assumptions.pathCount.toLocaleString("en-US")} paths`} /></p>
        </div>
        <div>
          <dt><SimulationText ko="손실로 끝난 경로" en="Paths ending in loss" /></dt>
          <dd>{execution.terminal.lossProbabilityPct.toFixed(1)}%</dd>
          <p><SimulationText ko="마지막 값이 출발점보다 낮은 비율" en="Share ending below their starting value" /></p>
        </div>
        <div>
          <dt><SimulationText ko="중간 최대 하락 · MDD" en="Largest drop along the way" /></dt>
          <dd className="text-[var(--negative)]">{execution.terminal.maxDrawdownP90Pct.toFixed(1)}%</dd>
          <p><SimulationText ko="약 10% 경로는 이보다 더 하락" en="About 10% of paths had a larger drop" /></p>
        </div>
      </dl>
      <ResearchFanChart large execution={execution} />

    </div>
  );
}

function ExecutionAssumptions({ execution }: { execution: ReadyExecution }) {
  const terminalBand = execution.bands.at(-1);
  return <div className="mt-6">
      <div className={styles.boundaries}>
        <span><SimulationText ko={"하위 경계 P10"} /><strong><SimulationText ko={terminalBand ? simulationReturnLabel(terminalBand.p10) : "기록 없음"} /></strong></span>
        <span><SimulationText ko={"상위 경계 P90"} /><strong><SimulationText ko={terminalBand ? simulationReturnLabel(terminalBand.p90) : "기록 없음"} /></strong></span>
        <span><SimulationText ko={"계산 경로"} /><strong>{execution.assumptions.pathCount}<SimulationText ko={"개"} /></strong></span>
      </div>
      <dl className={styles.method}>
        <div><dt><SimulationText ko={"현재 구성에서 출발"} /></dt><dd><SimulationText ko={"현재 평가액의"} />{" "}{execution.coverage.modeledCurrentValuePct.toFixed(1)}<SimulationText ko={"%를 포함하며, 계산 종목의 비중을 100%로 환산합니다."} /></dd></div>
        <div><dt><SimulationText ko={"관측 데이터로 계산"} /></dt><dd><SimulationText ko={"최근 90개 공동 수익률을 재표본 추출합니다. 수수료·세금·현금수익률은 포함하지 않습니다."} /></dd></div>
        <div><dt><SimulationText ko={"범위로 읽는 결과"} /></dt><dd><SimulationText ko={"P10~P90은 모형 안의 분포입니다. 실제 미래의 보장 범위가 아니며 조회 시 계산한 연구 결과입니다."} /></dd></div>
      </dl>
  </div>;
}

function unavailableReasonLabel(
  reason: Exclude<
    SimulationOwnerResearchExecutionResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    owner_input_unavailable:
      "현재 평가액이나 종목 식별 입력을 먼저 확인해야 합니다.",
    invalid_end_service_date: "기준일 형식이 올바르지 않습니다.",
    end_service_date_unavailable:
      "공통으로 사용할 수 있는 저장 기준일이 없습니다.",
    invalid_horizon_selection:
      "연구 기간은 63단계 또는 126단계만 사용할 수 있습니다.",
    modeled_subset_empty: "과거 이력을 계산할 상장 종목이 없습니다.",
    historical_evidence_not_admitted:
      "조정주가의 출처·수집시각·종목 연결 증거가 확인된 과거 이력이 부족합니다.",
    weight_derivation_failed:
      "현재 평가액 비중을 계산 비중으로 변환하지 못했습니다.",
    input_matrix_unavailable:
      "선택한 기준일에 완전한 90개 수익률 입력이 없습니다.",
    input_matrix_shape_mismatch:
      "종목 구성과 저장된 수익률 행렬이 일치하지 않습니다.",
    research_vector_invalid: "연구용 현재 비중 구성을 검증하지 못했습니다.",
    draw_plan_blocked: "재표본 추출 계획을 만들지 못했습니다.",
    gross_growth_blocked: "재표본 경로의 누적 수익률을 계산하지 못했습니다.",
    normalized_nav_blocked: "정규화 경로를 계산하지 못했습니다.",
    summary_blocked:
      "경로는 계산했지만 분포·위험 요약 검증을 통과하지 못했습니다.",
  } as const;
  if (reason === "historical_evidence_not_admitted") return {
    ko: "종목별 과거 가격·환율의 출처와 날짜별 연결 근거가 부족합니다.",
    en: "Historical prices, exchange rates or their source and date alignment are incomplete.",
  };
  if (reason === "prepared_path_policy_mismatch") return {
    ko: "준비된 경로와 현재 계산 조건이 일치하지 않습니다. 계산을 다시 실행해 주세요.",
    en: "The prepared paths do not match the current calculation settings. Run the calculation again.",
  };
  return { ko: labels[reason] };
}

function endSourceLabel(
  source: SimulationOwnerResearchExecutionResult["endSelection"]["source"],
) {
  return source === "query" ? "주소에서 직접 선택" : "저장 이력의 최신 공통일";
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
