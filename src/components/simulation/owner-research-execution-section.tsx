import type { SimulationOwnerResearchExecutionResult } from "@/lib/simulation-owner-research-execution";

import { ResearchFanChart } from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

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
      className="border-b border-[#d7ddcf] py-5"
      data-owner-research-execution
      data-owner-research-account={execution.account}
      data-owner-research-status={execution.status}
      data-owner-research-end-source={execution.endSelection.source}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            현재 보유 비중 · 저장된 조정주가
          </p>
          <h2 className="mt-1 text-lg font-semibold" id="owner-research-execution-title">
            내 포트폴리오 확률 경로
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            현재 평가액 비중을 시작 구성으로 삼고, 저장된 최근 90개 수익률을
            블록 단위로 다시 뽑아 500개 경로를 계산합니다. 보유 수량의 과거
            기록을 재현하는 화면이 아니며 미래 예측이나 추천도 아닙니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          조회 시 계산 · 저장 안 함
        </span>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail={`${execution.coverage.candidateInstrumentCount}개 후보 중`}
          label="계산 종목"
          value={`${execution.coverage.modeledInstrumentCount}개`}
        />
        <Metric
          detail="현재 평가액 기준"
          label="계산 포함 범위"
          value={`${execution.coverage.modeledCurrentValuePct.toFixed(2)}%`}
        />
        <Metric
          detail={endSourceLabel(execution.endSelection.source)}
          label="기준일"
          value={
            execution.endSelection.endServiceDate
              ? formatDate(execution.endSelection.endServiceDate)
              : "확인 필요"
          }
        />
        <Metric
          detail="stationary bootstrap"
          label="결과 상태"
          value={execution.status === "ready" ? "계산 완료" : "부분 진단"}
        />
      </dl>

      {execution.coverage.omittedWeightBps > 0 ? (
        <div
          className="mt-3 rounded-md border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm leading-6 text-[#62542c]"
          data-owner-research-partial-coverage
        >
          전체 현재 비중 중 {formatWeight(execution.coverage.omittedWeightBps)}는
          과거 이력을 꾸며내지 않고 제외했습니다. 계산 가능한 상장 종목 비중만
          연구 경로 안에서 100%로 다시 환산했으며, 전체 포트폴리오를 완전히
          대표하는 결과로 해석하면 안 됩니다.
        </div>
      ) : null}

      {execution.status === "ready" ? (
        <ReadyOwnerExecution execution={execution} />
      ) : (
        <UnavailableOwnerExecution execution={execution} />
      )}
    </section>
  );
}

function ReadyOwnerExecution({ execution }: { execution: ReadyExecution }) {
  const instrumentByKey = new Map(
    execution.instruments.map((row) => [row.instrumentKey, row]),
  );

  return (
    <article
      className="mt-4 overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
      data-owner-research-horizon={execution.assumptions.horizon}
      data-owner-research-path-count={execution.assumptions.pathCount}
    >
      <header className="flex flex-col gap-2 border-b border-[#e1e5da] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            최초 배분 후 리밸런싱 없음
          </p>
          <h3 className="mt-1 text-lg font-semibold">
            현재 구성 · {execution.assumptions.horizon}단계
          </h3>
        </div>
        <span className="w-fit rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]">
          계산 완료
        </span>
      </header>

      <SimulationTerminalRiskMetrics terminal={execution.terminal} />
      <ResearchFanChart execution={execution} />

      <div className="overflow-x-auto border-t border-[#e1e5da]">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead className="text-xs text-[#687064]">
            <tr>
              <th className="px-4 py-3 font-semibold">종목</th>
              <th className="px-4 py-3 text-right font-semibold">현재 비중</th>
              <th className="px-4 py-3 text-right font-semibold">계산 비중</th>
            </tr>
          </thead>
          <tbody>
            {execution.executionWeights.map((weight) => {
              const instrument = instrumentByKey.get(weight.instrumentKey);
              return (
                <tr className="border-t border-[#e1e5da]" key={weight.instrumentKey}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{instrument?.name ?? weight.ticker}</p>
                    <p className="mt-1 text-xs text-[#687064]">{weight.ticker}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatWeight(instrument?.originalWeightBps ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatWeight(weight.weightBps)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[#e1e5da] px-4 py-3 text-xs leading-5 text-[#687064]">
        기준일 {formatDate(execution.source.endServiceDate)} · 입력 수익률 {execution.source.returnStepCount}개 ·
        평균 블록 5단계 · 수수료·세금·현금수익률 미포함
      </p>
    </article>
  );
}

function UnavailableOwnerExecution({
  execution,
}: {
  execution: Exclude<
    SimulationOwnerResearchExecutionResult,
    { status: "ready" }
  >;
}) {
  return (
    <div
      className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
      data-owner-research-unavailable-reason={execution.reason}
    >
      <p className="font-semibold">아직 확률 경로를 계산하지 않았습니다.</p>
      <p className="mt-1 text-sm leading-6 text-[#6b6044]">
        {unavailableReasonLabel(execution.reason)} 확인 가능한 보유종목과 이력 상태는
        위 입력 표에 그대로 남겨 둡니다.
      </p>
    </div>
  );
}

function Metric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[#d7ddcf] bg-[#fbfcf7] px-3 py-3">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
      <dd className="mt-1 text-xs text-[#7a8175]">{detail}</dd>
    </div>
  );
}

function unavailableReasonLabel(
  reason: Exclude<
    SimulationOwnerResearchExecutionResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    owner_input_unavailable: "현재 평가액이나 종목 식별 입력을 먼저 확인해야 합니다.",
    invalid_end_service_date: "기준일 형식이 올바르지 않습니다.",
    end_service_date_unavailable: "공통으로 사용할 수 있는 저장 기준일이 없습니다.",
    invalid_horizon_selection: "연구 기간은 63단계 또는 126단계만 사용할 수 있습니다.",
    modeled_subset_empty: "과거 이력을 계산할 상장 종목이 없습니다.",
    historical_evidence_not_admitted:
      "조정주가의 출처·수집시각·종목 연결 증거가 확인된 과거 이력이 부족합니다.",
    weight_derivation_failed: "현재 평가액 비중을 계산 비중으로 변환하지 못했습니다.",
    input_matrix_unavailable: "선택한 기준일에 완전한 90개 수익률 입력이 없습니다.",
    input_matrix_shape_mismatch: "종목 구성과 저장된 수익률 행렬이 일치하지 않습니다.",
    research_vector_invalid: "연구용 현재 비중 구성을 검증하지 못했습니다.",
    draw_plan_blocked: "재표본 추출 계획을 만들지 못했습니다.",
    gross_growth_blocked: "재표본 경로의 누적 수익률을 계산하지 못했습니다.",
    normalized_nav_blocked: "정규화 경로를 계산하지 못했습니다.",
    summary_blocked: "경로는 계산했지만 분포·위험 요약 검증을 통과하지 못했습니다.",
  } as const;
  return labels[reason];
}

function endSourceLabel(source: SimulationOwnerResearchExecutionResult["endSelection"]["source"]) {
  return source === "query" ? "주소에서 직접 선택" : "저장 이력의 최신 공통일";
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
