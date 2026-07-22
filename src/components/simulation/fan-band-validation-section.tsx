import type { SimulationFanBandValidationHistoryResult } from "@/lib/simulation-fan-band-validation";

export function FanBandValidationSection({
  result,
}: {
  result: SimulationFanBandValidationHistoryResult;
}) {
  return (
    <section
      aria-labelledby="fan-band-validation-title"
      className="border-b border-[#d7ddcf] py-5"
      data-fan-band-validation
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
            P10~P90 확률밴드 검증
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#596158]">
            KODEX 200 50%와 VOO 50%를 처음 한 번 배분하고 리밸런싱하지
            않은 연구 포트폴리오입니다. 각 행은 앞선 90개 공동 KRW 수익률로
            500개 경로를 만들고, 이어진 실제 63개 관측값과 비교합니다.
          </p>
        </div>
        <span className="text-xs text-[#687064]">
          예측·추천·계정 결과 아님
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="계산 가능"
          value={`${result.summary.readyEndpointCount}/${result.summary.endpointCount}`}
          detail={`${result.summary.unavailableEndpointCount}개 행 계산 불가`}
        />
        <SummaryCard
          label="P10~P90 포함률"
          value={formatNullablePct(result.summary.bandCoveragePct)}
          detail={
            result.summary.readyEndpointCount > 0
              ? `${result.summary.bandHitCount}/${result.summary.readyEndpointCount}개 실제 결과 포함`
              : "비교 가능한 행 없음"
          }
        />
        <SummaryCard
          label="평균 P50 절대오차"
          value={formatNullablePctPoint(
            result.summary.meanAbsoluteP50ErrorPctPoints,
          )}
          detail="실제 종료수익률과 중앙값 차이"
        />
      </div>

      {result.rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#62542c]">
          URL에서 검증 종료 기준일을 하나의 <code>YYYY-MM-DD</code> 값으로
          선택해야 계산합니다. 최근 날짜로 자동 대체하지 않습니다.
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
                    {formatDate(row.outcomeEndServiceDate)}
                  </td>
                  {row.status === "ready" ? (
                    <>
                      <td className="px-3 py-2">
                        {formatDate(row.trainingEndServiceDate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatSignedPct(row.predictedP10ReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatSignedPct(row.predictedP50ReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatSignedPct(row.predictedP90ReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatSignedPct(row.actualReturnPct)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatPctPoint(row.absoluteP50ErrorPctPoints)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {row.inP10P90Band ? "포함" : "이탈"}
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-[#7a5117]" colSpan={7}>
                      계산 불가 · {reasonLabel(row.reason)}
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

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatSignedPct(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatPctPoint(value: number) {
  return `${value.toFixed(2)}%p`;
}

function formatNullablePct(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function formatNullablePctPoint(value: number | null) {
  return value === null ? "-" : formatPctPoint(value);
}

function reasonLabel(reason: string) {
  if (reason === "input_matrix_unavailable") return "필요한 관측값 부족";
  if (reason === "input_matrix_shape_mismatch") return "관측 구간 불일치";
  if (reason === "simulation_unavailable") return "경로 계산 불가";
  if (reason === "observed_path_unavailable") return "실제 경로 계산 불가";
  return "입력 확인 필요";
}
