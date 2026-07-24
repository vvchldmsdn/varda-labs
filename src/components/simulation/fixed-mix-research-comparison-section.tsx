import type { FixedMixResearchComparisonResult } from "@/lib/simulation-fixed-mix-research-comparison";

import {
  ResearchFanChart,
  resolveResearchFanChartValueDomain,
} from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyComparison = Extract<
  FixedMixResearchComparisonResult,
  { status: "ready" }
>;

export function FixedMixResearchComparisonSection({
  comparison,
  selectedKodexWeightPct,
}: {
  comparison: FixedMixResearchComparisonResult | null;
  selectedKodexWeightPct: number | null;
}) {
  if (!comparison) return null;

  return (
    <section
      aria-labelledby="fixed-mix-comparison-title"
      className="border-b border-[#d7ddcf] py-5"
      data-fixed-mix-research-comparison
      data-fixed-mix-research-comparison-status={comparison.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="fixed-mix-comparison-title" className="text-lg font-semibold">
            고정 비중 3안 공통 경로 비교
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            25:75, 50:50, 75:25가 같은 path별 날짜 행과 블록 순서를
            사용합니다. 최초 비중만 다르고 입력 행렬과 무작위 표본은 같아,
            비중 차이만 비교할 수 있습니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          성과 순위·추천 아님
        </span>
      </div>

      {comparison.status === "ready" ? (
        <ReadyComparisonGrid
          comparison={comparison}
          selectedKodexWeightPct={selectedKodexWeightPct}
        />
      ) : (
        <div
          className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
          data-fixed-mix-comparison-unavailable-reason={comparison.reason}
        >
          <p className="font-semibold">세 비중의 공통 경로를 계산하지 않았습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            {unavailableReasonLabel(comparison.reason)} 준비된 단일 종목 결과와
            사용자가 선택한 비중 결과는 그대로 유지됩니다.
          </p>
        </div>
      )}
    </section>
  );
}

function ReadyComparisonGrid({
  comparison,
  selectedKodexWeightPct,
}: {
  comparison: ReadyComparison;
  selectedKodexWeightPct: number | null;
}) {
  const chartExecutions = comparison.scenarios.map((scenario) => ({
    ...scenario.execution,
    id: scenario.id,
  }));
  const valueDomain = resolveResearchFanChartValueDomain(chartExecutions);

  return (
    <div
      className="mt-4"
      data-fixed-mix-comparison-pairing={comparison.policy.sharedSampling}
      data-fixed-mix-comparison-scenario-count={comparison.pairing.scenarioCount}
      data-fixed-mix-comparison-path-count={comparison.pairing.pathCount}
    >
      <p className="border-y border-[#e1e5da] py-3 text-xs leading-5 text-[#687064]">
        세 그래프는 같은 세로축을 사용합니다. 각 카드의 위치는 KODEX 200
        비중 오름차순이며 성과 순위가 아닙니다. 경로 500개 ·{" "}
        서비스 기준일 수익률 {comparison.pairing.horizon}단계 · 리밸런싱 없음.
      </p>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {comparison.scenarios.map((scenario, index) => {
          const execution = chartExecutions[index];
          if (!execution) return null;
          const selected = selectedKodexWeightPct === scenario.kodexWeightPct;

          return (
            <article
              className="overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
              data-fixed-mix-comparison-scenario={`${scenario.kodexWeightPct}-${scenario.vooWeightPct}`}
              data-fixed-mix-comparison-selected={selected ? "true" : "false"}
              key={scenario.id}
            >
              <header className="flex items-start justify-between gap-3 border-b border-[#e1e5da] px-4 py-4">
                <div>
                  <p className="text-xs font-semibold text-[#687064]">
                    KODEX 200 : VOO
                  </p>
                  <h3 className="mt-1 text-lg font-semibold tabular-nums">
                    {scenario.kodexWeightPct}:{scenario.vooWeightPct}
                  </h3>
                </div>
                {selected ? (
                  <span className="rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]">
                    현재 선택
                  </span>
                ) : null}
              </header>

              <SimulationTerminalRiskMetrics
                compact
                terminal={execution.terminal}
              />

              <ResearchFanChart
                execution={execution}
                valueDomain={valueDomain}
              />
            </article>
          );
        })}
      </div>
    </div>
  );
}

function unavailableReasonLabel(
  reason: Exclude<
    FixedMixResearchComparisonResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    invalid_weight_selection: "비교용 고정 비중을 검증하지 못했습니다.",
    invalid_horizon_selection:
      "연구 기간은 서비스 기준일 수익률 63단계 또는 126단계만 선택할 수 있습니다.",
    explicit_end_required: "기준일을 직접 선택한 뒤에만 비교를 시작합니다.",
    input_matrix_unavailable:
      "두 종목 모두에 대해 같은 날짜축의 완전한 90개 수익률 쌍이 없습니다.",
    input_matrix_shape_mismatch:
      "입력 기간 또는 종목 구성이 069500·VOO 공동 연구 규격과 일치하지 않습니다.",
    research_vector_invalid: "비교용 명시 비중 연구 가정을 검증하지 못했습니다.",
    draw_plan_blocked: "공통 재표본 추출 계획을 만들지 못했습니다.",
    gross_growth_blocked: "공통 종목 성장 경로를 만들지 못했습니다.",
    normalized_nav_blocked: "비중별 정규화 경로를 계산하지 못했습니다.",
    summary_blocked: "경로는 계산했지만 분포·위험 요약 검증을 통과하지 못했습니다.",
  } as const;
  return labels[reason];
}
