import type { SimulationWalkForwardMinimumVolatilityResult } from "@/lib/simulation-walk-forward-min-volatility";

import { SimulationPathComparisonChart } from "./simulation-path-comparison-chart";

type ReadyResult = Extract<
  SimulationWalkForwardMinimumVolatilityResult,
  { status: "ready" }
>;

export function WalkForwardMinimumVolatilitySection({
  result,
}: {
  result: SimulationWalkForwardMinimumVolatilityResult | null;
}) {
  if (!result) return null;

  return (
    <section
      aria-labelledby="walk-forward-min-volatility-title"
      className="border-b border-[#d7ddcf] py-5"
      data-walk-forward-min-volatility
      data-walk-forward-min-volatility-status={result.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            사후 검증 연구 · 계좌 및 목표비중과 무관
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="walk-forward-min-volatility-title"
          >
            워크포워드 최소변동성 연구
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            KODEX 200과 VOO의 공동 원화 수익률만 사용합니다. 직전 60개
            관측으로 비중을 계산하고 다음 10개 관측에만 적용하는 과정을 3번
            반복합니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          미래 예측·추천 아님
        </span>
      </div>

      {result.status === "ready" ? (
        <ReadyResearch result={result} />
      ) : (
        <div
          className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
          data-walk-forward-min-volatility-unavailable-reason={result.reason}
        >
          <p className="font-semibold">이 연구 경로만 계산할 수 없습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            {unavailableReasonLabel(result.reason)} 기존 단일 종목, 고정 비중,
            stationary bootstrap 및 시장 국면 결과는 그대로 유지합니다.
          </p>
        </div>
      )}
    </section>
  );
}

function ReadyResearch({ result }: { result: ReadyResult }) {
  const minimum = result.paths.minimumVolatility;
  const equalWeight = result.paths.equalWeight;
  return (
    <div className="mt-4" data-walk-forward-fold-count={result.folds.length}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail="마지막 30개 공동 관측"
          label="검증구간 수익률"
          value={formatSignedPercent(minimum.totalReturnPct)}
        />
        <Metric
          detail={`50:50 ${formatPct(equalWeight.annualizedVolatilityPct)}`}
          label="검증구간 연환산 변동성"
          value={formatPct(minimum.annualizedVolatilityPct)}
        />
        <Metric
          detail={`50:50 ${formatPct(equalWeight.maxDrawdownPct)}`}
          label="관측 기준 MDD"
          value={formatPct(minimum.maxDrawdownPct)}
        />
        <Metric
          detail="음수면 50:50보다 낮음"
          label="변동성 차이"
          value={formatSignedPctPoints(
            result.comparison.annualizedVolatilityDifferencePctPoints,
          )}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[#d7ddcf] bg-[#fbfcf7] p-4">
        <SimulationPathComparisonChart
          ariaLabel="워크포워드 최소변동성과 같은 주기 50대50의 검증구간 누적지수 비교"
          series={[
            {
              id: minimum.id,
              label: minimum.label,
              color: "#0f3d38",
              points: minimum.points,
            },
            {
              id: equalWeight.id,
              label: equalWeight.label,
              color: "#d95c48",
              points: equalWeight.points,
            },
          ]}
        />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
            <tr>
              <th className="px-3 py-3 font-semibold">구간</th>
              <th className="px-3 py-3 font-semibold">학습기간</th>
              <th className="px-3 py-3 font-semibold">검증기간</th>
              <th className="px-3 py-3 text-right font-semibold">
                KODEX 200
              </th>
              <th className="px-3 py-3 text-right font-semibold">VOO</th>
              <th className="px-3 py-3 text-right font-semibold">
                학습 추정 변동성
              </th>
            </tr>
          </thead>
          <tbody>
            {result.folds.map((fold) => (
              <tr
                className="border-b border-[#e1e5da]"
                data-walk-forward-fold={fold.foldIndex + 1}
                key={fold.foldIndex}
              >
                <td className="px-3 py-3 font-semibold">
                  {fold.foldIndex + 1}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatDate(fold.trainStartServiceDate)} ~ {formatDate(fold.trainEndServiceDate)}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatDate(fold.testStartServiceDate)} ~ {formatDate(fold.testEndServiceDate)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {formatBps(fold.weights[0].weightBps)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {formatBps(fold.weights[1].weightBps)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatPct(fold.estimatedAnnualizedVolatilityPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs leading-5 text-[#687064]">
        long-only·100% 투자, 10개 관측마다 비용 없이 재조정하고 구간 안에서는
        비중 변화를 그대로 둡니다. 표본 공분산은 10% 대각 축소를 적용합니다.
        거래비용·세금·환전비용은 0으로 가정하며 VOO의 원화 수익률에는 저장된
        일자별 환율 변동이 이미 포함됩니다.
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
    <dl className="rounded-lg border border-[#d7ddcf] bg-[#fbfcf7] px-4 py-3">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[#687064]">{detail}</dd>
    </dl>
  );
}

function unavailableReasonLabel(
  reason: Exclude<
    SimulationWalkForwardMinimumVolatilityResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    explicit_end_required: "기준일을 직접 선택한 경우에만 계산합니다.",
    input_matrix_unavailable:
      "두 종목의 같은 날짜축 90개 수익률이 모두 준비되지 않았습니다.",
    input_matrix_shape_mismatch:
      "입력 기간 또는 종목 구성이 069500·VOO 공동 연구 규격과 다릅니다.",
    invalid_return_value: "사용할 수 없는 공동 수익률이 포함되어 있습니다.",
    estimation_failed: "학습 공분산 또는 검증 경로를 안정적으로 계산하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedPctPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
}
