import { SimulationText } from "@/components/simulation/simulation-text";
import { simulationEnglish } from "@/components/simulation/simulation-copy";
import type { SimulationOwnerResearchExecutionResult } from "@/lib/simulation-owner-research-execution";
import { InvestmentLabDialog as SimulationDialog } from "@/components/investment-lab/investment-lab-dialog";
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
}: {
  execution: SimulationOwnerResearchExecutionResult;
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
        <SimulationDialog
          label="결과 해석·계산 근거" labelEn={simulationEnglish("결과 해석·계산 근거")}
          title="확률 경로를 읽는 방법" titleEn={simulationEnglish("확률 경로를 읽는 방법")}
          size="wide"
          compactLabel
        >
          <div className="grid gap-6 text-sm leading-7 text-[var(--muted)] sm:grid-cols-2">
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
                <SimulationText ko={"500개 경로 · 12개 표본"} />{" "}</h3>
              <p>
                <SimulationText ko={"최근 90개 공동 수익률을 평균 5단계 블록으로 재표본 추출합니다. 최초 배분 후 리밸런싱 없이 500개 경로를 계산하며, 차트에는 분포 또는 대표 표본 12개를 표시합니다. 표본만으로 전체 손실 확률을 판단하지 않습니다."} />{" "}</p>
            </div>
            <div>
              <h3 className="mb-2 font-medium text-[var(--ink)]">
                <SimulationText ko={"포함 범위와 가정"} />{" "}</h3>
              <p>
                <SimulationText ko={"현재 평가액의"} />{" "}
                {execution.coverage.modeledCurrentValuePct.toFixed(2)}<SimulationText ko={"%가 계산 대상입니다. 제외한 비중은 이력을 꾸며내지 않고 남겨 두며, 포함 종목만 100%로 다시 환산합니다. 수수료·세금·현금수익률 미포함, 조회 시 계산 · 저장 안 함."} />{" "}</p>
            </div>
          </div>
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
            <SimulationText ko={"계산에 필요한 근거를 확인하고 있습니다."} />{" "}</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
            <SimulationText ko={unavailableReasonLabel(execution.reason)} />
          </p>
          <p className="mt-2 text-xs leading-6 text-[var(--warning)]">
            <SimulationText ko={"모형·데이터에서 종목별 누락과 출처를 확인할 수 있습니다. 부족한 값을 0이나 예시 경로로 대체하지 않습니다."} />{" "}</p>
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
          <dt>{execution.assumptions.horizon}<SimulationText ko={"단계 후 중앙 수익률"} /></dt>
          <dd className={execution.terminal.p50ReturnPct >= 0 ? "text-[var(--brand)]" : "text-[var(--negative)]"}>
            <SimulationText ko={simulationReturnLabel(100 + execution.terminal.p50ReturnPct)} />
          </dd>
          <p><SimulationText ko={"전체 계산 경로의 중앙값 P50"} /></p>
        </div>
        <div>
          <dt><SimulationText ko={"손실로 끝날 확률"} /></dt>
          <dd>{execution.terminal.lossProbabilityPct.toFixed(1)}%</dd>
          <p><SimulationText ko={"종료값이 시작값보다 낮은 경로 비율"} /></p>
        </div>
        <div>
          <dt><SimulationText ko={"큰 하락폭 · MDD P90"} /></dt>
          <dd className="text-[var(--negative)]">{execution.terminal.maxDrawdownP90Pct.toFixed(1)}%</dd>
          <p><SimulationText ko={"경로 내 최대 낙폭의 더 큰 손실 쪽 경계"} /></p>
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
  return labels[reason];
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
