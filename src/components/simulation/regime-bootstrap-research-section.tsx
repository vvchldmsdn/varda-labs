import type { SimulationRegimeResearchResult } from "@/lib/simulation-regime-research-execution";

import {
  ResearchFanChart,
  resolveResearchFanChartValueDomain,
} from "./research-fan-chart";

type ReadyModel = Extract<SimulationRegimeResearchResult, { status: "ready" }>;
type ReadyScenario = Extract<
  ReadyModel["scenarios"][number],
  { status: "ready" }
>;

export function RegimeBootstrapResearchSection({
  model,
}: {
  model: SimulationRegimeResearchResult;
}) {
  const readyScenarios =
    model.status === "ready"
      ? model.scenarios.filter(isReadyScenario)
      : Object.freeze([] as ReadyScenario[]);
  const sharedValueDomain =
    readyScenarios.length > 0
      ? resolveResearchFanChartValueDomain(readyScenarios)
      : null;

  return (
    <section
      aria-labelledby="regime-bootstrap-research-title"
      className="border-b border-[#d7ddcf] py-5"
      data-regime-bootstrap-engine={model.policy.version}
      data-regime-bootstrap-research
      data-regime-bootstrap-status={model.status}
      data-regime-bootstrap-unavailable-reason={model.reason ?? ""}
      data-regime-fallback="forbidden"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="regime-bootstrap-research-title" className="text-lg font-semibold">
            시장 국면 조건부 연구
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
            선택 기준일의 환율·미국 금리·장단기 금리차와 유사했던 과거
            구간에서 교차시장 수익률 블록을 뽑습니다. 기존 stationary
            bootstrap과 별개이며, 한 모델의 결손을 다른 모델 결과로 대체하지
            않습니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          연구용 · 저장 안 함 · 추천 아님
        </span>
      </div>

      <div className="mt-4 grid border-y border-[#e1e5da] sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem
          label="교차시장 수익률"
          value={
            model.source
              ? `${model.source.returnStepCount}/${model.policy.sourceReturnStepCount}`
              : `0/${model.policy.sourceReturnStepCount}`
          }
          detail="KODEX 200 + VOO 같은 행"
        />
        <SummaryItem
          label="국면 정렬 행"
          value={
            model.readiness
              ? `${model.readiness.alignedRowCount}/${model.readiness.requiredAlignedRowCount}`
              : `0/${model.policy.minimumAlignedRegimeRows}`
          }
          detail={`공개일 기준 · 최대 ${model.policy.factorMaxCarryDays}일`}
        />
        <SummaryItem
          label="유사 국면 후보"
          value={
            model.readiness
              ? `${model.readiness.selectedNeighborCount}/${model.readiness.eligibleCandidateRowCount}`
              : "-"
          }
          detail="선택 이웃 / 사용 가능 시작점"
        />
        <SummaryItem
          label="실행 상태"
          value={
            model.status === "ready"
              ? `${model.summary.readyScenarioCount}/${model.summary.scenarioCount} 계산 완료`
              : "사용 불가"
          }
          detail="자동 fallback 없음"
        />
      </div>

      {model.status === "unavailable" ? (
        <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4">
          <p className="font-semibold">국면 조건부 경로를 계산하지 않았습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            {unavailableReasonLabel(model.reason)} 기존의 정적 부트스트랩 결과는
            이 상태와 독립적으로 유지됩니다.
          </p>
        </div>
      ) : null}

      {model.readiness ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-3 font-semibold">요인</th>
                <th className="px-3 py-3 font-semibold">최신 공개일</th>
                <th className="px-3 py-3 font-semibold">선택일 적용 공개일</th>
                <th className="px-3 py-3 text-right font-semibold">정렬 커버리지</th>
              </tr>
            </thead>
            <tbody>
              {model.readiness.factors.map((factor) => (
                <tr
                  className="border-b border-[#e1e5da]"
                  data-regime-factor-key={factor.factorKey}
                  data-regime-factor-carry-days={factor.currentCarryDays ?? ""}
                  key={factor.factorKey}
                >
                  <td className="px-3 py-3 font-semibold">{factor.label}</td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatDate(factor.latestReleaseDate)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatCurrentRelease(factor.currentReleaseDate, factor.currentCarryDays)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {factor.alignedStateCount}/{model.policy.sourceReturnStepCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {model.status === "ready" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {model.scenarios.map((scenario) =>
            scenario.status === "ready" ? (
              <RegimeScenarioPanel
                key={scenario.id}
                scenario={scenario}
                valueDomain={sharedValueDomain!}
              />
            ) : (
              <div
                className="rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
                data-regime-scenario={scenario.id}
                data-regime-scenario-status="unavailable"
                key={scenario.id}
              >
                <p className="font-semibold">{scenario.name}</p>
                <p className="mt-2 text-sm text-[#6b6044]">
                  명시 비중 입력이 유효하지 않아 이 시나리오만 제외했습니다.
                </p>
              </div>
            ),
          )}
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-[#687064]">
        방법: 공개일이 선택일 이전인 3개 일별 요인의 수준·20일 변동성을
        robust scaling한 뒤 가까운 과거 국면을 선택합니다. 120개 완전 수익률
        행, 5~20거래일 연속 블록, 63거래일, 500경로를 사용합니다. DB 적재시각은
        과거 공개시점으로 간주하지 않습니다. 현재 보유, 계좌, Fount, 금현물,
        승인 벡터, 주문 가능성은 입력에 포함하지 않습니다.
      </p>
    </section>
  );
}

function RegimeScenarioPanel({
  scenario,
  valueDomain,
}: {
  scenario: ReadyScenario;
  valueDomain: ReturnType<typeof resolveResearchFanChartValueDomain>;
}) {
  return (
    <article
      className="overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
      data-regime-scenario={scenario.id}
      data-regime-scenario-status="ready"
      data-regime-scenario-kodex-weight-bps={scenario.weightsBps[0]}
      data-regime-scenario-voo-weight-bps={scenario.weightsBps[1]}
    >
      <header className="border-b border-[#e1e5da] px-4 py-4">
        <p className="text-xs font-semibold text-[#687064]">국면 조건부 경로</p>
        <h3 className="mt-1 text-lg font-semibold">{scenario.name}</h3>
        <p className="mt-1 text-xs text-[#687064]">
          069500 {formatBps(scenario.weightsBps[0])} · VOO {formatBps(scenario.weightsBps[1])}
          {" · "}최초 배분 후 리밸런싱 없음
        </p>
      </header>
      <div className="grid grid-cols-2 border-b border-[#e1e5da]">
        <Metric label="중앙 경로 수익률" value={formatSignedPct(scenario.terminal.p50ReturnPct)} />
        <Metric label="손실 종료 확률" value={formatPct(scenario.terminal.lossProbabilityPct)} />
        <Metric label="MDD 중앙값" value={formatPct(scenario.terminal.maxDrawdownP50Pct)} />
        <Metric label="MDD P90" value={formatPct(scenario.terminal.maxDrawdownP90Pct)} />
      </div>
      <ResearchFanChart execution={scenario} valueDomain={valueDomain} />
    </article>
  );
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-b border-r border-[#e1e5da] px-4 py-3 last:border-r-0 xl:border-b-0">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#7a8175]">{detail}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-[#e1e5da] px-3 py-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function isReadyScenario(
  scenario: ReadyModel["scenarios"][number],
): scenario is ReadyScenario {
  return scenario.status === "ready";
}

function unavailableReasonLabel(
  reason: Exclude<SimulationRegimeResearchResult, { status: "ready" }>[
    "reason"
  ],
) {
  const labels = {
    explicit_end_required: "기준일을 직접 선택한 뒤에만 실행합니다.",
    input_matrix_unavailable: "두 종목의 공통 수익률 입력이 완전하지 않습니다.",
    input_matrix_shape_mismatch: "공통 수익률 입력이 고정 120행 규격과 다릅니다.",
    factor_rows_invalid: "시장 요인 행의 날짜 또는 값 규격이 유효하지 않습니다.",
    current_factor_state_incomplete: "선택 기준일의 시장 요인 상태가 완전하지 않습니다.",
    current_factor_state_stale: "선택 기준일에 적용할 시장 요인이 7일보다 오래되었습니다.",
    insufficient_aligned_regime_rows: "수익률과 시점 기준 요인이 함께 완전한 행이 120개 미만입니다.",
    insufficient_candidate_rows: "연속 블록을 시작할 유사 국면 후보가 20개 미만입니다.",
    factor_state_degenerate: "국면 거리를 계산할 유효한 변동 요인이 부족합니다.",
    invalid_return_matrix_values: "수익률 행에 재표본할 수 없는 값이 있습니다.",
    draw_plan_blocked: "국면 조건부 블록 추출 계획을 만들지 못했습니다.",
    scenario_execution_blocked: "경로 계산 중 수치 검증을 통과하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatCurrentRelease(date: string | null, carryDays: number | null) {
  if (!date || carryDays === null) return "없음";
  return `${formatDate(date)} · ${carryDays}일 적용`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "없음";
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(0)}%`;
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
