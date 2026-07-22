import {
  formatHistoricalValidationDate,
  formatHistoricalValidationPct,
  formatNullableHistoricalValidationPct,
  formatNullableHistoricalValidationPctPoint,
  HistoricalValidationSummaryCard,
  historicalValidationReasonLabel,
} from "@/components/simulation/historical-validation-ui";
import type { SimulationHistoricalOutcomeValidationResult } from "@/lib/simulation-historical-outcome-validation";

export function DownsideOutcomeValidationSection({
  result,
}: {
  result: SimulationHistoricalOutcomeValidationResult;
}) {
  const summary = result.downsideSummary;

  return (
    <section
      aria-labelledby="downside-outcome-validation-title"
      className="border-b border-[#d7ddcf] py-5"
      data-downside-outcome-validation
      data-downside-outcome-validation-horizon={result.horizon ?? "invalid"}
      data-downside-outcome-validation-status={result.status}
      data-downside-outcome-validation-ready-count={summary.readyEndpointCount}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            Stationary bootstrap · 하락위험 과거 관측 검증
          </p>
          <h2
            id="downside-outcome-validation-title"
            className="mt-1 text-lg font-semibold"
          >
            종료 손실확률·최대낙폭 검증
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            확률밴드와 동일한 90개 학습 구간과 500개 완전 경로를 사용합니다.
            예측 종료 손실확률과 MDD P50·P90을, 바로 이어진 실제{" "}
            {result.horizon ?? "선택"}개 관측값의 종료 손실 여부와 MDD에
            대조합니다.
          </p>
        </div>
        <span className="text-xs text-[#687064]">
          합격 판정·모델 선택 아님
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HistoricalValidationSummaryCard
          label="계산 가능"
          value={`${summary.readyEndpointCount}/${result.summary.endpointCount}`}
          detail={`${summary.unavailableEndpointCount}개 행 계산 불가`}
        />
        <HistoricalValidationSummaryCard
          label="평균 예측 종료 손실확률"
          value={formatNullableHistoricalValidationPct(
            summary.meanPredictedLossProbabilityPct,
          )}
          detail={`실제 종료 손실 ${summary.actualLossEndpointCount}/${summary.readyEndpointCount}개`}
        />
        <HistoricalValidationSummaryCard
          label="실제 MDD가 예측 P90 이내"
          value={`${summary.actualWithinPredictedMddP90Count}/${summary.readyEndpointCount}`}
          detail="겹치는 구간의 기술 통계"
        />
        <HistoricalValidationSummaryCard
          label="평균 MDD P50 절대오차"
          value={formatNullableHistoricalValidationPctPoint(
            summary.meanAbsoluteMddP50ErrorPctPoints,
          )}
          detail="실제 MDD와 예측 중앙값 차이"
        />
      </div>

      {result.rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#62542c]">
          {result.reason === "invalid_horizon_selection" ? (
            <>
              연구 기간은 <code>63</code> 또는 <code>126</code>만 선택할 수
              있습니다.
            </>
          ) : (
            <>
              URL에서 검증 종료 기준일을 하나의 <code>YYYY-MM-DD</code> 값으로
              선택해야 계산합니다. 최근 날짜로 자동 대체하지 않습니다.
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="border-b border-[#dfe3d5] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">실제 관측 종료일</th>
                <th className="px-3 py-2 text-right font-semibold">
                  예측 종료 손실확률
                </th>
                <th className="px-3 py-2 text-right font-semibold">
                  실제 종료
                </th>
                <th className="px-3 py-2 text-right font-semibold">MDD P50</th>
                <th className="px-3 py-2 text-right font-semibold">MDD P90</th>
                <th className="px-3 py-2 text-right font-semibold">실제 MDD</th>
                <th className="px-3 py-2 text-right font-semibold">
                  P90 대조
                </th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  className="border-b border-[#e7eadf] last:border-b-0"
                  data-downside-outcome-validation-row={
                    row.outcomeEndServiceDate
                  }
                  data-downside-outcome-validation-row-status={row.status}
                  key={row.outcomeEndServiceDate}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatHistoricalValidationDate(
                      row.outcomeEndServiceDate,
                    )}
                  </td>
                  {row.status === "ready" ? (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPct(
                          row.predictedLossProbabilityPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {row.actualTerminalLoss ? "손실" : "비손실"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPct(
                          row.predictedMaxDrawdownP50Pct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPct(
                          row.predictedMaxDrawdownP90Pct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatHistoricalValidationPct(
                          row.actualMaxDrawdownPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {row.actualWithinPredictedMddP90
                          ? "P90 이내"
                          : "P90 초과"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-[#7a5117]" colSpan={6}>
                      계산 불가 · {historicalValidationReasonLabel(row.reason)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        실제 종료 손실 횟수와 P90 대조는 겹치는 7개 관측 구간의 기술
        통계입니다. 독립 시행의 적중률이나 모델 합격·불합격으로 해석하지
        않으며, 날짜 선택·파라미터 조정·추천에는 사용하지 않습니다. 데이터가
        부족한 행만 계산하지 않고 나머지 행은 유지합니다.
      </p>
    </section>
  );
}
