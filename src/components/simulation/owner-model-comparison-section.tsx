import type { SimulationOwnerModelComparisonResult } from "@/lib/simulation-owner-model-comparison";

import {
  ResearchFanChart,
  resolveResearchFanChartValueDomain,
} from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyComparison = Extract<
  SimulationOwnerModelComparisonResult,
  { status: "ready" }
>;

export function OwnerModelComparisonSection({
  result,
}: {
  result: SimulationOwnerModelComparisonResult;
}) {
  return (
    <section
      aria-labelledby="owner-model-comparison-title"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-model-comparison
      data-owner-model-comparison-account={result.account}
      data-owner-model-comparison-combination="forbidden"
      data-owner-model-comparison-status={result.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            같은 보유 비중 · 다른 확률 가정
          </p>
          <h2 className="mt-1 text-lg font-semibold" id="owner-model-comparison-title">
            두 확률모형 비교
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            과거 수익률 구간을 다시 뽑는 모형과 환율·금리 관계를 추정하는
            모형을 같은 계정·기준일·기간에서 나란히 봅니다. 어느 한쪽을
            정답으로 고르거나 두 확률을 평균내지 않습니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          조회 시 계산 · 저장 안 함
        </span>
      </div>

      {result.status === "ready" ? (
        <ReadyModelComparison result={result} />
      ) : (
        <UnavailableComparison result={result} />
      )}
    </section>
  );
}

function ReadyModelComparison({ result }: { result: ReadyComparison }) {
  const models = [result.models.bootstrap, result.models.factor] as const;
  const valueDomain = resolveResearchFanChartValueDomain(models);

  return (
    <div
      className="mt-4"
      data-owner-model-comparison-agreement={result.agreement.code}
      data-owner-model-comparison-end={result.pairing.endServiceDate}
      data-owner-model-comparison-factor-observations={
        result.pairing.factorAlignedObservationCount
      }
      data-owner-model-comparison-horizon={result.pairing.horizon}
      data-owner-model-comparison-overlap={
        result.agreement.terminalP10P90Overlaps
      }
      data-owner-model-comparison-path-count={result.pairing.pathCount}
    >
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          detail="요인모형 - 재표본모형"
          label="중앙 수익률 차이"
          value={formatSignedPctPoint(
            result.deltas.factorMinusBootstrapP50ReturnPctPoints,
          )}
        />
        <Metric
          detail="요인모형 - 재표본모형"
          label="P5 수익률 차이"
          value={formatSignedPctPoint(
            result.deltas.factorMinusBootstrapP5ReturnPctPoints,
          )}
        />
        <Metric
          detail="요인모형 - 재표본모형"
          label="손실확률 차이"
          value={formatSignedPctPoint(
            result.deltas.factorMinusBootstrapLossProbabilityPctPoints,
          )}
        />
        <Metric
          detail="종료 P10~P90 교집합 / 합집합"
          label="예상 범위 겹침"
          value={formatPct(result.agreement.terminalP10P90OverlapPct)}
        />
        <Metric
          detail={`${result.pairing.bootstrapObservationCount}개 중 ${result.pairing.factorAlignedObservationCount}개`}
          label="요인 결합 관측"
          value={formatPct(result.pairing.factorObservationCoveragePct)}
        />
      </dl>

      <div className="mt-4 rounded-md border border-[#d7ddcf] bg-[#f6f8f2] px-4 py-3">
        <p className="font-semibold">{agreementTitle(result.agreement.code)}</p>
        <p className="mt-1 text-sm leading-6 text-[#596158]">
          {agreementDetail(result.agreement.code)} 예상 범위 겹침은 확률의
          정확도를 뜻하지 않고, 서로 다른 가정에서 나온 분포가 얼마나
          비슷한 영역을 가리키는지만 보여줍니다.
        </p>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {models.map((model) => (
          <article
            className="overflow-hidden rounded-md border border-[#d7ddcf] bg-[#fbfcf7]"
            key={model.id}
          >
            <h3 className="border-b border-[#e1e5da] px-4 py-3 font-semibold">
              {model.name}
            </h3>
            <SimulationTerminalRiskMetrics compact terminal={model.terminal} />
            <ResearchFanChart execution={model} valueDomain={valueDomain} />
          </article>
        ))}
      </div>

      <p className="mt-3 text-xs leading-5 text-[#687064]">
        재표본모형은 저장된 공동 수익률 {result.pairing.bootstrapObservationCount}개를
        사용하고, 요인모형은 그중 환율·금리 자료가 맞물린 {" "}
        {result.pairing.factorAlignedObservationCount}개만 사용했습니다. 두 결과의
        차이는 오류가 아니라 표본과 가정에 대한 민감도일 수 있습니다. 정확한
        경제지표 공개 시각·개정 이력이 없으므로 요인모형은 회고적 연구입니다.
      </p>
    </div>
  );
}

function UnavailableComparison({
  result,
}: {
  result: Exclude<SimulationOwnerModelComparisonResult, { status: "ready" }>;
}) {
  return (
    <div
      className="mt-4 rounded-md border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
      data-owner-model-comparison-unavailable-reason={result.reason}
    >
      <p className="font-semibold">두 모형의 직접 비교만 보류했습니다.</p>
      <p className="mt-1 text-sm leading-6 text-[#6b6044]">
        {unavailableReasonLabel(result.reason)} 준비된 개별 모형 결과와 입력
        진단은 위 영역에서 계속 확인할 수 있습니다.
      </p>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <Status label="과거 구간 재표본" status={result.modelStatuses.bootstrap.status} />
        <Status label="환율·금리 요인" status={result.modelStatuses.factor.status} />
      </dl>
    </div>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d7ddcf] bg-[#fbfcf7] px-3 py-3">
      <dt className="text-xs text-[#687064]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs leading-5 text-[#7a8175]">{detail}</dd>
    </div>
  );
}

function Status({ label, status }: { label: string; status: "ready" | "unavailable" }) {
  return (
    <div className="rounded-md border border-[#e6d8ae] bg-white px-3 py-3">
      <dt className="text-xs text-[#7a6d4f]">{label}</dt>
      <dd className="mt-1 font-semibold">{status === "ready" ? "계산 완료" : "준비 안 됨"}</dd>
    </div>
  );
}

function agreementTitle(code: ReadyComparison["agreement"]["code"]) {
  const labels = {
    direction_agrees_and_ranges_overlap: "방향과 예상 범위가 대체로 겹칩니다.",
    direction_agrees_ranges_disjoint: "방향은 같지만 예상 크기가 크게 다릅니다.",
    direction_differs_ranges_overlap: "중앙 방향이 모형 가정에 따라 달라집니다.",
    direction_differs_ranges_disjoint: "두 모형이 방향과 범위 모두 다르게 봅니다.",
  } as const;
  return labels[code];
}

function agreementDetail(code: ReadyComparison["agreement"]["code"]) {
  const labels = {
    direction_agrees_and_ranges_overlap:
      "두 모형이 같은 수익 방향을 가리키고 P10~P90 구간도 겹칩니다.",
    direction_agrees_ranges_disjoint:
      "두 모형의 중앙값 부호는 같지만 P10~P90 구간은 겹치지 않습니다.",
    direction_differs_ranges_overlap:
      "중앙값 부호는 다르지만 P10~P90 구간에는 공통 영역이 있습니다.",
    direction_differs_ranges_disjoint:
      "중앙값 부호가 다르고 P10~P90 구간에도 공통 영역이 없습니다.",
  } as const;
  return labels[code];
}

function unavailableReasonLabel(
  reason: Exclude<SimulationOwnerModelComparisonResult, { status: "ready" }>["reason"],
) {
  const labels = {
    bootstrap_unavailable: "과거 구간 재표본 결과가 먼저 준비되어야 합니다.",
    factor_model_unavailable: "환율·금리 요인 결과가 먼저 준비되어야 합니다.",
    account_mismatch: "두 결과의 계정 범위가 일치하지 않습니다.",
    weight_identity_mismatch: "두 결과의 종목별 보유 비중이 일치하지 않습니다.",
    horizon_mismatch: "두 결과의 투자기간이 일치하지 않습니다.",
    path_count_mismatch: "두 결과의 경로 수가 일치하지 않습니다.",
    end_date_mismatch: "두 결과의 기준일이 일치하지 않습니다.",
    band_shape_mismatch: "두 결과의 경로 단계가 일치하지 않습니다.",
    nonfinite_summary: "비교할 위험 요약에 유효하지 않은 숫자가 있습니다.",
  } as const;
  return labels[reason];
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPctPoint(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`;
}
