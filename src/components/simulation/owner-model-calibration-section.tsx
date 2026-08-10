import type { SimulationOwnerModelCalibrationResult } from "@/lib/simulation-owner-model-calibration";

type CalibrationRow =
  SimulationOwnerModelCalibrationResult["rows"][number];

export function OwnerModelCalibrationSection({
  result,
}: {
  result: SimulationOwnerModelCalibrationResult;
}) {
  return (
    <section
      aria-labelledby="owner-model-calibration-title"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-model-calibration
      data-owner-model-calibration-account={result.account}
      data-owner-model-calibration-effective-windows={
        result.summary.effectiveNonOverlappingWindowCount
      }
      data-owner-model-calibration-paired={result.summary.pairedEndpointCount}
      data-owner-model-calibration-selection="forbidden"
      data-owner-model-calibration-status={result.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            같은 과거 구간에서 실제 결과와 대조
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="owner-model-calibration-title"
          >
            과거 결과로 두 모형 점검
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            부트스트랩과 요인·잔차 모형이 예측한 범위를 이후 21거래일의
            실제 결과와 같은 조건에서 비교합니다. 숫자가 낮을수록 과거
            오차가 작았다는 뜻일 뿐, 우승 모형이나 투자 추천을 정하지
            않습니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          읽기 전용 · 모형 선택 금지
        </span>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Metric
          detail={`전체 ${result.summary.endpointCount}개 중 비교 가능한 구간`}
          label="비교 완료"
          value={`${result.summary.pairedEndpointCount}개`}
        />
        <Metric
          detail="서로 겹치지 않는 21거래일 구간 수"
          label="유효 독립 구간"
          value={`${result.summary.effectiveNonOverlappingWindowCount}개`}
        />
        <Metric
          detail="예상 중앙값과 실제 수익률 차이의 평균"
          label="중앙값 평균 오차"
          value={formatPair(
            result.summary.bootstrap.meanAbsoluteP50ErrorPctPoints,
            result.summary.factor.meanAbsoluteP50ErrorPctPoints,
            formatPctPoint,
          )}
        />
        <Metric
          detail="실제 결과가 각 모형의 P10~P90 안에 들어온 비율"
          label="예상 범위 적중률"
          value={formatPair(
            result.summary.bootstrap.bandCoveragePct,
            result.summary.factor.bandCoveragePct,
            formatPct,
          )}
        />
        <Metric
          detail="손실 확률의 Brier 오차, 0에 가까울수록 작음"
          label="손실 확률 오차"
          value={formatPair(
            result.summary.bootstrap.lossBrierScore,
            result.summary.factor.lossBrierScore,
            formatScore,
          )}
        />
        <Metric
          detail="예상 중앙 최대낙폭과 실제 최대낙폭 차이의 평균"
          label="최대낙폭 평균 오차"
          value={formatPair(
            result.summary.bootstrap.meanAbsoluteMddP50ErrorPctPoints,
            result.summary.factor.meanAbsoluteMddP50ErrorPctPoints,
            formatPctPoint,
          )}
        />
      </dl>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <th className="px-3 py-2 font-semibold">결과 기준일</th>
              <th className="px-3 py-2 text-right font-semibold">실제 수익률</th>
              <th className="px-3 py-2 text-right font-semibold">부트스트랩 중앙값</th>
              <th className="px-3 py-2 text-right font-semibold">부트스트랩 오차</th>
              <th className="px-3 py-2 text-right font-semibold">요인 모형 중앙값</th>
              <th className="px-3 py-2 text-right font-semibold">요인 모형 오차</th>
              <th className="px-3 py-2 font-semibold">상태</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <CalibrationTableRow key={row.outcomeEndServiceDate} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {result.summary.unavailableEndpointCount > 0 ? (
        <p
          className="mt-3 text-sm text-[#7a5117]"
          data-owner-model-calibration-partial
        >
          비교할 수 없는 구간 {result.summary.unavailableEndpointCount}개도
          숨기지 않고 표에 남겼습니다.
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        현재 계좌 구성과 비중을 과거 구간에 소급 적용한 진단입니다. 21거래일
        결과 구간은 서로 겹칠 수 있어 통계적 신뢰도나 모형 순위를 주장하지
        않습니다. 요인 데이터는 당시 공개일 기준으로만 사용하지만 데이터의
        과거 버전 기록은 보존되지 않아, 이후 정정된 값이 포함될 수 있습니다.
      </p>
    </section>
  );
}

function CalibrationTableRow({ row }: { row: CalibrationRow }) {
  if (row.status !== "ready") {
    return (
      <tr
        className="border-b border-[#e1e5da] text-[#7a6d4f]"
        data-owner-model-calibration-unavailable={row.reason}
      >
        <td className="px-3 py-3 tabular-nums">{row.outcomeEndServiceDate}</td>
        <td className="px-3 py-3 text-right" colSpan={5}>
          비교 자료 부족
        </td>
        <td className="px-3 py-3">{unavailableReason(row.reason)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-[#e1e5da] tabular-nums">
      <td className="px-3 py-3">{row.outcomeEndServiceDate}</td>
      <td className="px-3 py-3 text-right">{formatSignedPct(row.actual.returnPct)}</td>
      <td className="px-3 py-3 text-right">
        {formatSignedPct(row.bootstrap.predictedP50ReturnPct)}
      </td>
      <td className="px-3 py-3 text-right">
        {formatPctPoint(row.bootstrap.absoluteP50ErrorPctPoints)}
      </td>
      <td className="px-3 py-3 text-right">
        {formatSignedPct(row.factor.predictedP50ReturnPct)}
      </td>
      <td className="px-3 py-3 text-right">
        {formatPctPoint(row.factor.absoluteP50ErrorPctPoints)}
      </td>
      <td className="px-3 py-3">
        {row.bootstrap.inP10P90Band ? "부트스트랩 범위 적중" : "부트스트랩 범위 밖"}
        {" · "}
        {row.factor.inP10P90Band ? "요인 범위 적중" : "요인 범위 밖"}
      </td>
    </tr>
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
    <div className="border border-[#d7ddcf] bg-[#fbfcf7] px-3 py-3">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs leading-5 text-[#7a8175]">{detail}</dd>
    </div>
  );
}

function unavailableReason(reason: string) {
  const labels: Record<string, string> = {
    endpoint_identity_mismatch: "기준일 불일치",
    source_endpoint_unavailable: "원본 계산 미완료",
    window_identity_mismatch: "학습·결과 구간 불일치",
    observed_outcome_mismatch: "실제 결과 불일치",
  };
  return labels[reason] ?? "확인 필요";
}

function formatPair(
  bootstrap: number | null,
  factor: number | null,
  formatter: (value: number) => string,
) {
  if (bootstrap === null || factor === null) {
    return "-";
  }
  return `부트 ${formatter(bootstrap)} · 요인 ${formatter(factor)}`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPctPoint(value: number) {
  return `${value.toFixed(2)}%p`;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatScore(value: number) {
  return value.toFixed(3);
}
