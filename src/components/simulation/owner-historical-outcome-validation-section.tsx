import {
  formatHistoricalValidationDate,
  formatHistoricalValidationPct,
  formatHistoricalValidationPctPoint,
  formatHistoricalValidationSignedPct,
  formatNullableHistoricalValidationPct,
  formatNullableHistoricalValidationPctPoint,
  HistoricalValidationSummaryCard,
  historicalValidationReasonLabel,
} from "@/components/simulation/historical-validation-ui";
import type { SimulationOwnerHistoricalOutcomeValidationResult } from "@/lib/simulation-owner-historical-outcome-validation";

export function OwnerHistoricalOutcomeValidationSection({
  result,
}: {
  result: SimulationOwnerHistoricalOutcomeValidationResult;
}) {
  return (
    <section
      aria-labelledby="owner-historical-validation-title"
      className="border-b border-[var(--line)] py-5"
      data-owner-historical-validation
      data-owner-historical-validation-account={result.account}
      data-owner-historical-validation-status={result.status}
      data-owner-historical-validation-ready-count={
        result.summary.readyEndpointCount
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            현재 구성 고정 · 과거 약 1개월 관측 점검
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="owner-historical-validation-title"
          >
            내 포트폴리오 예측 범위와 실제 결과
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            현재 상장종목 비중을 과거에도 그대로 보유했다고 가정합니다. 각
            종료일 직전 90개 수익률로 500개 경로를 만든 뒤, 바로 이어진
            21개 수익률 구간의 실제 결과와 비교합니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)]">
          읽기 전용 · 추천 아님
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HistoricalValidationSummaryCard
          detail={`${result.summary.unavailableEndpointCount}개 행 계산 불가`}
          label="계산 가능 구간"
          value={`${result.summary.readyEndpointCount}/${result.summary.endpointCount}`}
        />
        <HistoricalValidationSummaryCard
          detail="P10~P90 안에 실제 결과가 있었던 구간"
          label="예측 범위 포함"
          value={
            result.summary.readyEndpointCount > 0
              ? `${result.summary.bandHitCount}/${result.summary.readyEndpointCount}`
              : "-"
          }
        />
        <HistoricalValidationSummaryCard
          detail="실제 결과와 예측 중앙값 차이"
          label="평균 중앙값 오차"
          value={formatNullableHistoricalValidationPctPoint(
            result.summary.meanAbsoluteP50ErrorPctPoints,
          )}
        />
        <HistoricalValidationSummaryCard
          detail={`실제 손실 종료 ${result.downsideSummary.actualLossEndpointCount}/${result.downsideSummary.readyEndpointCount}개`}
          label="평균 예측 손실확률"
          value={formatNullableHistoricalValidationPct(
            result.downsideSummary.meanPredictedLossProbabilityPct,
          )}
        />
      </div>

      {result.rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--warning)]">
          현재 구성의 확률 경로가 먼저 계산되어야 과거 결과를 대조할 수
          있습니다. 입력 점검에 표시된 종목과 이력 상태는 그대로 유지합니다.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold">실제 종료일</th>
                <th className="px-3 py-2 text-right font-semibold">P10</th>
                <th className="px-3 py-2 text-right font-semibold">P50</th>
                <th className="px-3 py-2 text-right font-semibold">P90</th>
                <th className="px-3 py-2 text-right font-semibold">실제</th>
                <th className="px-3 py-2 text-right font-semibold">P50 오차</th>
                <th className="px-3 py-2 text-right font-semibold">예측 손실</th>
                <th className="px-3 py-2 text-right font-semibold">실제 MDD</th>
                <th className="px-3 py-2 text-right font-semibold">범위</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr
                  className="border-b border-[var(--wash)] last:border-b-0"
                  data-owner-historical-validation-row={
                    row.outcomeEndServiceDate
                  }
                  data-owner-historical-validation-row-status={row.status}
                  key={row.outcomeEndServiceDate}
                >
                  <td className="px-3 py-2 font-medium">
                    {formatHistoricalValidationDate(row.outcomeEndServiceDate)}
                  </td>
                  {row.status === "ready" ? (
                    <>
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
                        {formatHistoricalValidationSignedPct(row.actualReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPctPoint(
                          row.absoluteP50ErrorPctPoints,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPct(
                          row.predictedLossProbabilityPct,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHistoricalValidationPct(row.actualMaxDrawdownPct)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {row.inP10P90Band ? "포함" : "이탈"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-[var(--warning)]" colSpan={8}>
                      계산 불가 · {historicalValidationReasonLabel(row.reason)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 space-y-1 text-xs leading-5 text-[var(--muted)]">
        <p>
          이 결과는 현재 구성을 과거에 고정 적용한 사후 점검입니다. 당시 실제
          보유량·매매 내역을 재현한 성과가 아니며, 비중 최적화나 주문 근거로
          사용하지 않습니다.
        </p>
        <p>
          저장된 KIS 미조정 종가와 날짜별 환율을 사용하므로 배당·액면분할·병합을
          반영한 총수익률과 다를 수 있습니다. 데이터가 부족한 행만 제외하고
          계산 가능한 행은 유지합니다.
        </p>
      </div>
    </section>
  );
}
