import type { SimulationRegimeHistoricalOutcomeValidationResult } from "@/lib/simulation-regime-historical-outcome-validation";

export function RegimeHistoricalOutcomeValidationSection({
  result,
}: {
  result: SimulationRegimeHistoricalOutcomeValidationResult;
}) {
  return (
    <section
      aria-labelledby="regime-historical-outcome-title"
      className="border-b border-[#d7ddcf] py-5"
      data-regime-historical-outcome-validation
      data-regime-historical-outcome-validation-status={result.status}
      data-regime-historical-outcome-ready-count={
        result.summary.readyEndpointCount
      }
      data-regime-historical-outcome-point-in-time={
        result.pointInTimeStatus
      }
      data-regime-historical-outcome-scenario="kodex200-50-voo-50-buy-and-hold"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            className="text-lg font-semibold"
            id="regime-historical-outcome-title"
          >
            시장 국면 모델 과거 결과 대조
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
            과거 각 기준일에서 이전 120개 수익률과 당시까지 공개된
            시장 요인만 사용해 분포를 만든 뒤, 실제 다음 63개 서비스
            기준일 결과와 비교합니다.
          </p>
          <p className="mt-1 text-sm font-medium text-[#3f473d]">
            고정 연구 시나리오: KODEX 200 50% + VOO 50%, 최초 배분 후
            리밸런싱 없음
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-[#52566f]">
            사후 연구
          </span>
          <span className="rounded-md border border-[#e6d8ae] bg-[#fffdf6] px-3 py-1.5 text-[#6b6044]">
            시점 증거 미확립
          </span>
        </div>
      </div>

      <div className="mt-4 grid border-y border-[#e1e5da] sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem
          detail={`전체 ${result.summary.endpointCount}개 기준일`}
          label="계산 가능한 기준일"
          value={`${result.summary.readyEndpointCount}개`}
        />
        <SummaryItem
          detail="겹치는 구간이므로 독립 표본 아님"
          label="P10-P90 포함"
          value={formatCountRatio(
            result.summary.bandHitCount,
            result.summary.readyEndpointCount,
          )}
        />
        <SummaryItem
          detail="예측 중앙값과 실제 종료 수익률 차이"
          label="평균 절대 오차"
          value={formatPct(
            result.summary.meanAbsoluteP50ErrorPctPoints,
          )}
        />
        <SummaryItem
          detail="각 기준일의 경로 중 종료 손실 비율 평균"
          label="예측 손실 확률"
          value={formatPct(
            result.downsideSummary
              .meanPredictedLossProbabilityPct,
          )}
        />
      </div>

      {result.rows.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-3 font-semibold">결과 기준일</th>
                <th className="px-3 py-3 font-semibold">연구 기준일</th>
                <th className="px-3 py-3 text-right font-semibold">
                  예측 P10-P90
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  예측 P50
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  실제 수익률
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  실제 MDD / 예측 P90
                </th>
                <th className="px-3 py-3 font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  className="border-b border-[#e1e5da]"
                  data-regime-historical-outcome-row={
                    row.outcomeEndServiceDate
                  }
                  data-regime-historical-outcome-row-status={
                    row.status
                  }
                  key={row.outcomeEndServiceDate}
                >
                  <td className="px-3 py-3 tabular-nums">
                    {formatDate(row.outcomeEndServiceDate)}
                  </td>
                  {row.status === "ready" ? (
                    <>
                      <td className="px-3 py-3 tabular-nums">
                        {formatDate(row.trainingEndServiceDate)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatRange(
                          row.predictedP10ReturnPct,
                          row.predictedP90ReturnPct,
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPct(row.predictedP50ReturnPct)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPct(row.actualReturnPct)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatPct(row.actualMaxDrawdownPct)}
                        {" / "}
                        {formatPct(row.predictedMaxDrawdownP90Pct)}
                      </td>
                      <td className="px-3 py-3">
                        {row.inP10P90Band
                          ? "예측 구간 안"
                          : "예측 구간 밖"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-3" colSpan={5}>
                        {reasonLabel(row.reason)}
                      </td>
                      <td className="px-3 py-3 text-[#8a6a21]">
                        계산 불가
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 border-y border-[#e6d8ae] bg-[#fffdf6] px-4 py-4 text-sm text-[#6b6044]">
          검증할 명시적 기준일과 입력 행이 아직 준비되지 않았습니다.
        </p>
      )}

      <p className="mt-4 text-xs leading-5 text-[#687064]">
        공개 시각과 과거 데이터 revision 이력이 현재 DB에 보존되지
        않아 이 결과는 엄격한 과거 시점 재현이 아닙니다. 서로 겹치는
        7개 구간은 독립 표본으로 세지 않으며, 합격 판정이나 모델
        순위, 현재 보유 종목 추천에 사용하지 않습니다. 한 기준일의
        입력이 비어 있으면 그 행만 계산 불가로 남기고 다른 결과는
        유지합니다.
      </p>
    </section>
  );
}

function SummaryItem({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-r border-[#e1e5da] px-4 py-3 last:border-r-0 xl:border-b-0">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#7a8175]">{detail}</p>
    </div>
  );
}

function formatCountRatio(value: number, total: number) {
  return total > 0 ? `${value}/${total}` : "-";
}

function formatRange(lower: number, upper: number) {
  return `${formatPct(lower)} ~ ${formatPct(upper)}`;
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    input_matrix_unavailable: "가격·환율 수익률 행이 부족합니다.",
    input_matrix_shape_mismatch: "입력 행의 날짜 또는 종목 구성이 다릅니다.",
    factor_rows_invalid: "시장 요인 행 형식이 올바르지 않습니다.",
    current_factor_state_incomplete:
      "연구 기준일의 시장 요인 상태가 불완전합니다.",
    current_factor_state_stale:
      "연구 기준일의 시장 요인이 허용 기간보다 오래됐습니다.",
    insufficient_aligned_regime_rows:
      "수익률과 시장 요인이 함께 있는 과거 행이 부족합니다.",
    insufficient_candidate_rows: "비슷한 과거 국면 후보가 부족합니다.",
    factor_state_degenerate:
      "시장 국면을 구분할 수 있는 요인 변화가 부족합니다.",
    invalid_return_matrix_values: "수익률 행에 유효하지 않은 값이 있습니다.",
    draw_plan_blocked: "국면 조건부 추출 계획을 만들지 못했습니다.",
    scenario_execution_blocked: "분포 계산을 완료하지 못했습니다.",
    observed_path_unavailable: "이후 실제 결과 경로를 계산할 수 없습니다.",
  };
  return labels[reason] ?? "필요한 검증 근거가 부족합니다.";
}
