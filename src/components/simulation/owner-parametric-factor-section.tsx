import type { SimulationOwnerParametricFactorResult } from "@/lib/simulation-owner-parametric-factor";

import { ResearchFanChart } from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyResult = Extract<
  SimulationOwnerParametricFactorResult,
  { status: "ready" }
>;

export function OwnerParametricFactorSection({
  result,
}: {
  result: SimulationOwnerParametricFactorResult;
}) {
  return (
    <section
      aria-labelledby="owner-parametric-factor-title"
      className="border-b border-[var(--line)] py-5"
      data-owner-parametric-factor
      data-owner-parametric-factor-account={result.account}
      data-owner-parametric-factor-status={result.status}
      data-owner-parametric-factor-fallback="forbidden"
      data-owner-parametric-factor-aligned-count={
        result.source.alignedObservationCount
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            별도 모형 · 부트스트랩과 합산하지 않음
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="owner-parametric-factor-title"
          >
            환율·금리 요인 확률모형
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            같은 날짜의 종목 수익률과 USD/KRW·미국 10년물 금리·장단기
            금리차 변화를 맞춰 통계 관계를 추정한 뒤 500개 경로를 계산합니다.
            기존 재표본 추출과 다른 가정의 결과이므로 두 모형의 차이 자체를
            불확실성으로 봐야 합니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)]">
          조회 시 계산 · 저장 안 함
        </span>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail={`전체 ${result.source.matrixRowCount}개 중`}
          label="요인 결합 수익률"
          value={`${result.source.alignedObservationCount}개`}
        />
        <Metric
          detail="USD/KRW · 10년물 · 장단기차"
          label="시장 요인"
          value="3개"
        />
        <Metric
          detail="최근 데이터에 더 큰 가중치"
          label="공분산"
          value="EWMA 0.97"
        />
        <Metric
          detail="두꺼운 꼬리 충격"
          label="분포"
          value="Student-t 7"
        />
      </dl>

      <p className="mt-3 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--warning)]">
        현재 저장 자료에는 각 지표의 정확한 공개 시각과 개정 이력이 없습니다.
        같은 날 발표값은 다음 서비스 날짜부터 사용했지만 완전한 시점별 예측
        검증은 아직 성립하지 않습니다. 이 결과는 회고적 연구이며 예측·추천·주문
        근거가 아닙니다.
      </p>

      {result.status === "ready" ? (
        <ReadyFactorResult result={result} />
      ) : (
        <div
          className="mt-4 rounded-lg border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-4"
          data-owner-parametric-factor-unavailable-reason={result.reason}
        >
          <p className="font-semibold">이 모형만 아직 계산할 수 없습니다.</p>
          <p className="mt-1 text-sm leading-6 text-[var(--warning)]">
            {unavailableReasonLabel(result.reason)} 기존 보유 비중 부트스트랩과 다른
            검증 결과는 그대로 유지됩니다.
          </p>
          {result.remediation ? (
            <dl className="mt-4 grid gap-3 border-t border-[var(--warning-soft)] pt-4 sm:grid-cols-3">
              <Metric
                detail="같은 날짜의 수익률·환율·금리"
                label="현재 결합 관측"
                value={`${result.remediation.alignedObservationCount}개`}
              />
              <Metric
                detail={`부족 ${result.remediation.observationShortfall}개`}
                label="최소 필요"
                value={`${result.remediation.requiredAlignedObservationCount}개`}
              />
              <Metric
                detail="일일 작업에서 별도로 재시도"
                label="해결 경로"
                value="팩터 자동 동기화"
              />
            </dl>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ReadyFactorResult({ result }: { result: ReadyResult }) {
  return (
    <article
      className="mt-4 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
      data-owner-parametric-factor-horizon={result.assumptions.horizon}
      data-owner-parametric-factor-path-count={result.assumptions.pathCount}
    >
      <header className="flex flex-col gap-2 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            현재 비중 · 최초 배분 후 리밸런싱 없음
          </p>
          <h3 className="mt-1 text-lg font-semibold">
            요인·잔차 모형 · {result.assumptions.horizon}단계
          </h3>
        </div>
        <span className="w-fit rounded-md bg-[var(--wash)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]">
          계산 완료
        </span>
      </header>

      <SimulationTerminalRiskMetrics terminal={result.terminal} />
      <ResearchFanChart execution={result} />

      <div className="overflow-x-auto border-t border-[var(--line)]">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="text-xs text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">종목</th>
              <th className="px-4 py-3 text-right font-semibold">USD/KRW</th>
              <th className="px-4 py-3 text-right font-semibold">미 10년물</th>
              <th className="px-4 py-3 text-right font-semibold">장단기차</th>
              <th className="px-4 py-3 text-right font-semibold">설명력 R²</th>
            </tr>
          </thead>
          <tbody>
            {result.exposures.map((row) => (
              <tr className="border-t border-[var(--line)]" key={row.instrumentKey}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.ticker}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {row.market} · {row.currency}
                  </p>
                </td>
                {row.standardizedBetas.map((value, index) => (
                  <td
                    className="px-4 py-3 text-right tabular-nums"
                    key={`${row.instrumentKey}-${index}`}
                  >
                    {formatSigned(value)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatPct(row.rSquared * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[var(--line)] px-4 py-3 text-xs leading-5 text-[var(--muted)]">
        결합 구간 {formatDate(result.source.firstAlignedServiceDate)}~
        {formatDate(result.source.lastAlignedServiceDate)} · 제외된 요인 공백
        {" "}{result.source.factorGapRowCount}개 · 요인 공분산 축소 15% · 잔차
        공분산 축소 25% · 자동 대체값 없음
      </p>
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
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
      <dd className="mt-1 text-xs text-[var(--muted)]">{detail}</dd>
    </div>
  );
}

function unavailableReasonLabel(
  reason: Exclude<
    SimulationOwnerParametricFactorResult,
    { status: "ready" }
  >["reason"],
) {
  const labels = {
    owner_research_unavailable:
      "현재 보유종목 수익률 입력이 먼저 준비되어야 합니다.",
    weight_identity_mismatch:
      "보유종목 식별자와 계산 비중의 순서가 일치하지 않습니다.",
    invalid_factor_evidence: "시장 요인 원자료의 날짜나 값이 유효하지 않습니다.",
    insufficient_factor_overlap:
      "종목 수익률과 시장 요인이 함께 존재하는 날짜가 45개보다 적습니다.",
    invalid_input: "요인 모형 입력의 크기나 숫자 범위가 유효하지 않습니다.",
    insufficient_observations: "요인 모형을 추정할 관측치가 부족합니다.",
    factor_covariance_not_positive_definite:
      "요인 공분산 행렬을 안정적으로 분해하지 못했습니다.",
    residual_covariance_not_positive_definite:
      "종목별 잔차 공분산 행렬을 안정적으로 분해하지 못했습니다.",
    simulation_nonfinite: "생성 경로에 유효하지 않은 숫자가 발생했습니다.",
    path_summary_unavailable: "생성 경로의 분포 요약을 검증하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "확인 필요";
}
