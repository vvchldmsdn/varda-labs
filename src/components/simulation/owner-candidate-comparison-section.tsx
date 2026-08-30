import type { SimulationOwnerCandidateComparisonResult } from "@/lib/simulation-owner-candidate-comparison";

import { OwnerOutcomeCandidateExplorer } from "./owner-outcome-candidate-explorer";
import {
  ResearchFanChart,
  resolveResearchFanChartValueDomain,
} from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyComparison = Extract<
  SimulationOwnerCandidateComparisonResult,
  { status: "ready" }
>;

export function OwnerCandidateComparisonSection({
  comparison,
  instruments = [],
}: {
  comparison: SimulationOwnerCandidateComparisonResult;
  instruments?: readonly { instrumentKey: string; name: string }[];
}) {

  return (
    <section
      aria-labelledby="owner-candidate-comparison-title"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-candidate-comparison
      data-owner-candidate-comparison-account={comparison.account}
      data-owner-candidate-comparison-status={comparison.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            현재안과 같은 500개 경로
          </p>
          <h2 className="mt-1 text-lg font-semibold" id="owner-candidate-comparison-title">
            변동성 완화 후보 비교
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            최근 90개 공동 수익률에서 변동성이 낮았던 비중을 찾고, 현재
            비중과 동일한 날짜 추출·무작위 경로로 나란히 계산합니다. 회전율과
            외화 비중 변화를 제한한 연구 후보이며 투자 추천이 아닙니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          조회 시 계산 · 저장 안 함
        </span>
      </div>

      {comparison.status === "ready" ? (
        <ReadyCandidateComparison comparison={comparison} instruments={instruments} />
      ) : (
        <div
          className="mt-4 rounded-md border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
          data-owner-candidate-comparison-unavailable-reason={comparison.reason}
        >
          <p className="font-semibold">후보 비중 비교를 만들지 않았습니다.</p>
          <p className="mt-1 text-sm leading-6 text-[#6b6044]">
            {unavailableReasonLabel(comparison.reason)} 현재 포트폴리오 확률
            경로는 그대로 유지됩니다.
          </p>
        </div>
      )}
    </section>
  );
}

function ReadyCandidateComparison({
  comparison,
  instruments,
}: {
  comparison: ReadyComparison;
  instruments: readonly { instrumentKey: string; name: string }[];
}) {
  const current = {
    ...comparison.currentExecution,
    id: `owner-current-comparison-${comparison.account}`,
    name: "현재 비중",
  };
  const candidate = {
    ...comparison.candidateExecution,
    id: `owner-minimum-volatility-comparison-${comparison.account}`,
    name: "변동성 완화 후보",
  };
  const valueDomain = resolveResearchFanChartValueDomain([current, candidate]);

  return (
    <div
      className="mt-4"
      data-owner-candidate-common-random-numbers={
        comparison.policy.commonRandomNumbers
      }
      data-owner-candidate-horizon={comparison.pairing.horizon}
      data-owner-candidate-path-count={comparison.pairing.pathCount}
      data-owner-candidate-turnover-bps={
        comparison.constraints.oneWayTurnoverBps
      }
    >
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail="최근 90개 수익률 기준"
          label="연환산 변동성"
          value={`${formatPct(comparison.training.currentAnnualizedVolatilityPct)} → ${formatPct(comparison.training.candidateAnnualizedVolatilityPct)}`}
        />
        <Metric
          detail={`상한 ${formatWeight(comparison.constraints.maximumOneWayTurnoverBps)}`}
          label="필요한 비중 이동"
          value={formatWeight(comparison.constraints.oneWayTurnoverBps)}
        />
        <Metric
          detail={`상한 ${formatWeight(comparison.constraints.maximumFxExposureChangeBps)}`}
          label="외화 비중 변화"
          value={formatSignedWeight(
            comparison.constraints.candidateFxExposureBps -
              comparison.constraints.currentFxExposureBps,
          )}
        />
        <Metric
          detail="후보 - 현재"
          label="중앙 경로 수익률 차이"
          value={formatSignedPct(comparison.deltas.p50ReturnPctPoints)}
        />
      </dl>

      <p className="mt-4 border-y border-[#e1e5da] py-3 text-xs leading-5 text-[#687064]">
        두 그래프는 동일한 세로축과 동일한 bootstrap 추출 경로를 사용합니다.
        후보는 종목당 최대 {formatWeight(comparison.constraints.maximumInstrumentWeightBps)},
        한 방향 회전율 최대 {formatWeight(comparison.constraints.maximumOneWayTurnoverBps)},
        외화 비중 변화 최대 {formatWeight(comparison.constraints.maximumFxExposureChangeBps)}로
        제한했습니다.
      </p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ComparisonCard
          execution={current}
          label="현재 비중"
          valueDomain={valueDomain}
        />
        <ComparisonCard
          execution={candidate}
          label="변동성 완화 후보"
          valueDomain={valueDomain}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-[#d7ddcf] bg-[#fbfcf7]">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead className="text-xs text-[#687064]">
            <tr>
              <th className="px-4 py-3 font-semibold">종목</th>
              <th className="px-4 py-3 text-right font-semibold">현재</th>
              <th className="px-4 py-3 text-right font-semibold">후보</th>
              <th className="px-4 py-3 text-right font-semibold">변화</th>
            </tr>
          </thead>
          <tbody>
            {[...comparison.weights]
              .sort(
                (left, right) =>
                  Math.abs(right.changeBps) - Math.abs(left.changeBps) ||
                  asciiCompare(left.instrumentKey, right.instrumentKey),
              )
              .map((row) => (
                <tr
                  className="border-t border-[#e1e5da]"
                  data-owner-candidate-weight-row={row.instrumentKey}
                  key={row.instrumentKey}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold">{instruments.find((item) => item.instrumentKey === row.instrumentKey)?.name ?? row.ticker}</p>
                    <p className="mt-1 text-xs text-[#687064]">
                      {row.market} · {row.currency}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatWeight(row.currentWeightBps)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatWeight(row.candidateWeightBps)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatSignedWeight(row.changeBps)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <OwnerOutcomeCandidateExplorer
        account={comparison.account}
        candidates={comparison.outcomeCandidates}
        currentExecution={comparison.currentExecution}
        reason={comparison.outcomeCandidateReason}
        status={comparison.outcomeCandidateStatus}
      />

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        이 후보는 같은 90개 과거 행으로 비중을 추정하고 미래 경로도 만들기
        때문에 아직 표본 내 연구 결과입니다. 수수료·세금은 0으로 가정했으며,
        별도의 시점별 검증을 통과하기 전에는 추천·주문 비중으로 사용할 수
        없습니다.
      </p>
    </div>
  );
}

function ComparisonCard({
  execution,
  label,
  valueDomain,
}: {
  execution: ReadyComparison["currentExecution"] & {
    id: string;
    name: string;
  };
  label: string;
  valueDomain: ReturnType<typeof resolveResearchFanChartValueDomain>;
}) {
  return (
    <article className="overflow-hidden rounded-md border border-[#d7ddcf] bg-[#fbfcf7]">
      <h3 className="border-b border-[#e1e5da] px-4 py-3 font-semibold">
        {label}
      </h3>
      <SimulationTerminalRiskMetrics compact terminal={execution.terminal} />
      <ResearchFanChart execution={execution} valueDomain={valueDomain} />
    </article>
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
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[#7a8175]">{detail}</dd>
    </div>
  );
}

function unavailableReasonLabel(
  reason: Exclude<
    SimulationOwnerCandidateComparisonResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    current_execution_unavailable: "현재 포트폴리오 경로가 먼저 준비되어야 합니다.",
    candidate_requires_two_instruments:
      "계산 가능한 상장 종목이 하나뿐이면 비중 대안을 만들 수 없습니다.",
    input_shape_mismatch: "현재 비중과 수익률 행렬의 종목 순서가 일치하지 않습니다.",
    candidate_estimation_failed: "제약 안에서 저변동 비중을 계산하지 못했습니다.",
    candidate_not_lower_volatility:
      "제약을 적용한 후보가 현재 비중보다 변동성을 낮추지 못했습니다.",
    candidate_constraint_failed: "회전율·외화·집중도 제약을 모두 만족하지 못했습니다.",
    research_vector_invalid: "후보 비중 합계와 종목 식별을 검증하지 못했습니다.",
    draw_plan_blocked: "공통 재표본 추출 계획을 확인하지 못했습니다.",
    gross_growth_blocked: "공통 종목 성장 경로를 확인하지 못했습니다.",
    normalized_nav_blocked: "후보 비중의 정규화 경로를 계산하지 못했습니다.",
    summary_blocked: "후보 경로의 분포·위험 요약을 검증하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}

function formatSignedWeight(weightBps: number) {
  const value = weightBps / 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function asciiCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
