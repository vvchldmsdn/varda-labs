import type { SimulationWalkForwardStabilityHistoryResult } from "@/lib/simulation-walk-forward-stability-history";

type StabilityRow = SimulationWalkForwardStabilityHistoryResult["rows"][number];

export function WalkForwardStabilityHistorySection({
  result,
}: {
  result: SimulationWalkForwardStabilityHistoryResult | null;
}) {
  if (!result) return null;

  return (
    <section
      aria-labelledby="walk-forward-stability-title"
      className="border-b border-[#d7ddcf] py-5"
      data-walk-forward-stability-history
      data-walk-forward-stability-status={result.status}
      data-walk-forward-stability-ready-count={
        result.summary.readyEndpointCount
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            같은 정책 반복 점검 · 겹치는 기간
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="walk-forward-stability-title"
          >
            워크포워드 기준일 안정성
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            선택 기준일과 직전 6개 날짜에 같은 60/10/3 정책을 독립적으로
            적용합니다. 날짜에 따라 결과가 크게 달라지는지 확인하는 진단이며,
            가장 좋은 날짜나 설정을 고르는 기능이 아닙니다.
          </p>
        </div>
        <div className="text-left text-xs text-[#687064] sm:text-right">
          <p className="font-semibold">
            {result.summary.readyEndpointCount}/
            {result.summary.endpointCount || result.policy.endpointCount}개 계산 가능
          </p>
          <p className="mt-1">누락 날짜만 사용 불가로 유지</p>
        </div>
      </div>

      {result.rows.length === 0 ? (
        <div className="mt-4 border-y border-[#e6d8ae] bg-[#fffdf6] px-4 py-4">
          <p className="font-semibold">안정성 이력을 계산하지 않았습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            {reasonLabel(result.reason)} 기존 단일 기준일 연구 결과는 그대로
            유지합니다.
          </p>
        </div>
      ) : (
        <StabilityTable rows={result.rows} />
      )}

      <p className="mt-4 text-xs leading-5 text-[#687064]">
        7개 검증창은 대부분의 학습·검증 수익률을 공유하므로 서로 독립된 7번의
        실험이 아닙니다. 이 표를 이용해 학습기간, 10% 대각 축소, 재조정 주기를
        다시 선택하거나 성과 순위를 만들지 않습니다.
      </p>
    </section>
  );
}

function StabilityTable({ rows }: { rows: readonly StabilityRow[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-left text-sm">
        <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
          <tr>
            <th className="px-3 py-3 font-semibold">기준일</th>
            <th className="px-3 py-3 font-semibold">상태</th>
            <th className="px-3 py-3 text-right font-semibold">검증 수익률</th>
            <th className="px-3 py-3 text-right font-semibold">연환산 변동성</th>
            <th className="px-3 py-3 text-right font-semibold">50:50 변동성</th>
            <th className="px-3 py-3 text-right font-semibold">변동성 차이</th>
            <th className="px-3 py-3 text-right font-semibold">관측 MDD</th>
            <th className="px-3 py-3 text-right font-semibold">
              KODEX 비중 3구간
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className="border-b border-[#e1e5da] align-top"
              data-walk-forward-stability-row={row.serviceDate}
              data-walk-forward-stability-row-status={row.status}
              key={row.serviceDate}
            >
              <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums">
                {formatDate(row.serviceDate)}
              </td>
              <td className="px-3 py-3">
                <p
                  className={
                    row.status === "ready"
                      ? "font-semibold text-[#226039]"
                      : "font-semibold text-[#7a5117]"
                  }
                >
                  {row.status === "ready" ? "계산 가능" : "사용 불가"}
                </p>
                {row.reason ? (
                  <p className="mt-1 max-w-[240px] text-xs leading-5 text-[#7a6b4e]">
                    {reasonLabel(row.reason)}
                  </p>
                ) : null}
              </td>
              <MetricCell value={formatSignedPct(row.outOfSampleReturnPct)} />
              <MetricCell value={formatPct(row.annualizedVolatilityPct)} />
              <MetricCell
                value={formatPct(row.equalWeightAnnualizedVolatilityPct)}
              />
              <MetricCell
                value={formatSignedPctPoints(
                  row.annualizedVolatilityDifferencePctPoints,
                )}
              />
              <MetricCell value={formatPct(row.maxDrawdownPct)} />
              <MetricCell value={formatFoldWeights(row.foldKodexWeightBps)} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCell({ value }: { value: string }) {
  return (
    <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">
      {value}
    </td>
  );
}

function reasonLabel(reason: string | null) {
  const labels: Record<string, string> = {
    explicit_end_required: "URL에서 하나의 기준일을 직접 선택해야 합니다.",
    endpoint_set_mismatch: "요청한 7개 기준일 구성이 정책과 다릅니다.",
    some_endpoints_unavailable: "일부 기준일의 공동 수익률이 부족합니다.",
    all_endpoints_unavailable: "모든 기준일의 공동 수익률이 부족합니다.",
    input_matrix_unavailable: "이 날짜의 공동 수익률 행렬이 완전하지 않습니다.",
    input_matrix_shape_mismatch: "이 날짜의 행렬 규격이 정책과 다릅니다.",
    invalid_return_value: "이 날짜에 사용할 수 없는 수익률이 있습니다.",
    estimation_failed: "이 날짜의 비중 또는 검증 경로를 계산하지 못했습니다.",
  };
  return reason ? (labels[reason] ?? "확인되지 않은 결손이 있습니다.") : "";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatPct(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}

function formatSignedPct(value: number | null) {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatSignedPctPoints(value: number | null) {
  return value === null
    ? "-"
    : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
}

function formatFoldWeights(values: readonly number[]) {
  return values.length === 0
    ? "-"
    : values.map((value) => `${(value / 100).toFixed(1)}%`).join(" / ");
}
