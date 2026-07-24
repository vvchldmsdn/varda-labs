import {
  formatHistoricalValidationDate,
  formatHistoricalValidationPctPoint,
  formatHistoricalValidationSignedPct,
  formatNullableHistoricalValidationPct,
  formatNullableHistoricalValidationPctPoint,
  HistoricalValidationSummaryCard,
  historicalValidationReasonLabel,
} from "@/components/simulation/historical-validation-ui";
import type { SimulationHistoricalOutcomeValidationResult } from "@/lib/simulation-historical-outcome-validation";

export function FanBandValidationSection({
  result,
}: {
  result: SimulationHistoricalOutcomeValidationResult;
}) {
  return (
    <section
      aria-labelledby="fan-band-validation-title"
      className="border-b border-[#d7ddcf] py-5"
      data-fan-band-validation
      data-fan-band-validation-horizon={result.horizon ?? "invalid"}
      data-fan-band-validation-status={result.status}
      data-fan-band-validation-ready-count={
        result.summary.readyEndpointCount
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            Stationary bootstrap · 과거 관측 검증
          </p>
          <h2
            id="fan-band-validation-title"
            className="mt-1 text-lg font-semibold"
          >
            종료수익률 P10~P90 확률밴드 검증
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            KODEX 200 50%와 VOO 50%를 처음 한 번 배분하고 리밸런싱하지
            않은 연구 포트폴리오입니다. 각 행은 앞선 90개 공동 KRW 수익률로
            500개 경로를 만들고, 이어진 실제 {result.horizon ?? "선택"}개
            관측값과 비교합니다.
          </p>
        </div>
        <span className="text-xs text-[#687064]">
          예측·추천·계정 결과 아님
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <HistoricalValidationSummaryCard
          label="계산 가능"
          value={`${result.summary.readyEndpointCount}/${result.summary.endpointCount}`}
          detail={`${result.summary.unavailableEndpointCount}개 행 계산 불가`}
        />
        <HistoricalValidationSummaryCard
          label="P10~P90 포함률"
          value={formatNullableHistoricalValidationPct(
            result.summary.bandCoveragePct,
          )}
          detail={
            result.summary.readyEndpointCount > 0
              ? `${result.summary.bandHitCount}/${result.summary.readyEndpointCount}개 실제 결과 포함`
              : "비교 가능한 행 없음"
          }
        />
        <HistoricalValidationSummaryCard
          label="평균 P50 절대오차"
          value={formatNullableHistoricalValidationPctPoint(
            result.summary.meanAbsoluteP50ErrorPctPoints,
          )}
          detail="실제 종료수익률과 중앙값 차이"
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
          <table className="min-w-[900px] w-full text-left text-sm">
            <thead className="border-b border-[#dfe3d5] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-2 font-semibold">실제 관측 종료일</th>
                <th className="px-3 py-2 font-semibold">학습 종료일</th>
                <th className="px-3 py-2 text-right font-semibold">P10</th>
                <th className="px-3 py-2 text-right font-semibold">P50</th>
                <th className="px-3 py-2 text-right font-semibold">P90</th>
                <th className="px-3 py-2 text-right font-semibold">실제</th>
                <th className="px-3 py-2 text-right font-semibold">P50 오차</th>
                <th className="px-3 py-2 text-right font-semibold">포함</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  className="border-b border-[#e7eadf] last:border-b-0"
                  data-fan-band-validation-row={row.outcomeEndServiceDate}
                  data-fan-band-validation-row-status={row.status}
                  key={row.outcomeEndServiceDate}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatHistoricalValidationDate(
                      row.outcomeEndServiceDate,
                    )}
                  </td>
                  {row.status === "ready" ? (
                    <>
                      <td className="px-3 py-2">
                        {formatHistoricalValidationDate(
                          row.trainingEndServiceDate,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationSignedPct(
                          row.predictedP10ReturnPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationSignedPct(
                          row.predictedP50ReturnPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationSignedPct(
                          row.predictedP90ReturnPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatHistoricalValidationSignedPct(
                          row.actualReturnPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPctPoint(
                          row.absoluteP50ErrorPctPoints,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {row.inP10P90Band ? "포함" : "이탈"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-[#7a5117]" colSpan={7}>
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
        최근 7개 종료일의 구간은 서로 크게 겹치므로 독립된 7번의 실험이
        아닙니다. 포함률은 기술 진단값이며 합격 판정, 최적 날짜 선정,
        파라미터 조정에 사용하지 않습니다. 데이터가 부족한 행만 계산하지
        않고 나머지 행은 유지합니다.
      </p>
    </section>
  );
}
