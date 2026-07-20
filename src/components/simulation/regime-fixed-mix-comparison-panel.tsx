import type { KodexVooFixedMixSelection } from "@/lib/kodex-voo-fixed-mix-selection";
import type { SimulationRegimeFixedMixComparisonResult } from "@/lib/simulation-regime-fixed-mix-comparison";

import { resolveResearchFanChartValueDomain } from "./research-fan-chart";
import { RegimeScenarioCard } from "./regime-scenario-card";

type ReadyComparison = Extract<
  SimulationRegimeFixedMixComparisonResult,
  { status: "ready" }
>;

export function RegimeFixedMixComparisonPanel({
  comparison,
  selection,
}: {
  comparison: SimulationRegimeFixedMixComparisonResult;
  selection: KodexVooFixedMixSelection;
}) {
  return (
    <section
      aria-labelledby="regime-fixed-mix-comparison-title"
      className="mt-5 border-t border-[#d7ddcf] pt-5"
      data-regime-fixed-mix-comparison
      data-regime-fixed-mix-comparison-status={comparison.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id="regime-fixed-mix-comparison-title"
            className="text-base font-semibold"
          >
            국면별 고정 비중 3안 공통 경로
          </h3>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
            25:75, 50:50, 75:25를 같은 시장 상태·과거 후보·500개 추출
            계획으로 계산합니다. 최초 배분 뒤에는 리밸런싱하지 않아 종목별
            등락에 따른 비중 변화를 그대로 둡니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          비중 순서 · 성과 순위·추천 아님
        </span>
      </div>

      {comparison.status === "ready" ? (
        <ReadyComparisonGrid comparison={comparison} selection={selection} />
      ) : (
        <div
          className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
          data-regime-fixed-mix-unavailable-reason={comparison.reason}
        >
          <p className="font-semibold">세 고정 비중을 함께 비교하지 않았습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            공통 국면 실행 근거를 검증하지 못했습니다. 단일 종목이나 직접
            입력한 비중의 독립 결과는 준비된 경우 그대로 유지합니다.
          </p>
        </div>
      )}
    </section>
  );
}

function ReadyComparisonGrid({
  comparison,
  selection,
}: {
  comparison: ReadyComparison;
  selection: KodexVooFixedMixSelection;
}) {
  const valueDomain = resolveResearchFanChartValueDomain(comparison.scenarios);

  return (
    <div
      className="mt-4"
      data-regime-fixed-mix-pairing={comparison.pairing.status}
      data-regime-fixed-mix-scenario-count={comparison.pairing.scenarioCount}
      data-regime-fixed-mix-path-count={comparison.pairing.pathCount}
      data-regime-fixed-mix-rebalancing="none"
    >
      <p className="border-y border-[#e1e5da] py-3 text-xs leading-5 text-[#687064]">
        세 그래프는 하나의 세로축을 사용합니다. 카드는 KODEX 200 비중이
        낮은 순서이며, 수익률이나 위험의 우열 순서가 아닙니다. stationary
        bootstrap 결과와 합산하거나 승패를 판정하지 않습니다.
      </p>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {comparison.scenarios.map((scenario) => (
          <RegimeScenarioCard
            eyebrow="국면 사후 연구 · KODEX 200 : VOO"
            group="fixed_mix_comparison"
            key={scenario.id}
            scenario={scenario}
            selected={
              selection.status !== "invalid" &&
              selection.kodexWeightPct === scenario.kodexWeightPct
            }
            valueDomain={valueDomain}
          />
        ))}
      </div>
    </div>
  );
}
