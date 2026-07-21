import Form from "next/form";
import Link from "next/link";

import type { KodexVooFixedMixSelection } from "@/lib/kodex-voo-fixed-mix-selection";
import type { FixedMixResearchSimulationResult } from "@/lib/simulation-fixed-mix-research-execution";

import { ResearchFanChart } from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyExecution = Extract<
  FixedMixResearchSimulationResult,
  { status: "ready" }
>;

export function FixedMixResearchExecutionSection({
  endServiceDate,
  execution,
  selection,
}: {
  endServiceDate: string;
  execution: FixedMixResearchSimulationResult | null;
  selection: KodexVooFixedMixSelection;
}) {
  if (!execution) return null;

  const kodexWeightPct = selection.kodexWeightPct ?? 50;
  const vooWeightPct = selection.vooWeightPct ?? 50;

  return (
    <section
      aria-labelledby="fixed-mix-research-title"
      className="border-b border-[#d7ddcf] py-5"
      data-fixed-mix-research-execution
      data-joint-research-execution-status={execution.status}
      data-joint-research-selection-status={selection.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="fixed-mix-research-title" className="text-lg font-semibold">
            명시 비중 공동 포트폴리오 연구
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            KODEX 200과 VOO의 같은 기준일 수익률 쌍을 한 행으로 묶어 함께
            재표본합니다. 선택한 최초 비중만 적용하고 이후에는 리밸런싱하지
            않아, 두 자산의 성과에 따라 비중이 자연스럽게 달라지는
            buy-and-hold 경로입니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          고정 연구 가정 · 추천 아님
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-y border-[#e1e5da] py-4 lg:flex-row lg:items-end lg:justify-between">
        <MixForm
          endServiceDate={endServiceDate}
          kodexWeightPct={kodexWeightPct}
          vooWeightPct={vooWeightPct}
        />
        <PresetLinks endServiceDate={endServiceDate} />
      </div>

      {execution.status === "ready" ? (
        <ReadyPanel execution={execution} />
      ) : (
        <div
          className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
          data-joint-research-unavailable-reason={execution.reason}
        >
          <p className="font-semibold">공동 경로를 계산하지 않았습니다.</p>
          <p className="mt-2 text-sm leading-6 text-[#6b6044]">
            {unavailableReasonLabel(execution.reason)} 단일 종목 입력이 준비된 경우에는
            위 결과를 그대로 볼 수 있습니다.
          </p>
        </div>
      )}

      <p
        className="mt-3 text-xs leading-5 text-[#687064]"
        data-joint-research-methodology="paired-stationary-bootstrap-v1"
      >
        방법 v2: 완전한 KRW 투자자 기준 수익률 쌍 90개 · stationary
        bootstrap · 평균 블록 5거래일 · 63거래일 · 500경로. 같은 입력 행렬,
        엔진 정책, 고정 seed에서만 결과가 동일합니다. 시장 국면 조건, 미래
        예측, 계좌 보유비중, Fount, 금현물은 사용하지 않습니다.
      </p>
    </section>
  );
}

function ReadyPanel({ execution }: { execution: ReadyExecution }) {
  return (
    <article
      className="mt-4 overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
      data-joint-sampling={execution.policy.jointSampling}
      data-joint-rebalancing="none"
      data-joint-research-horizon={execution.assumptions.horizon}
      data-joint-research-path-count={execution.assumptions.pathCount}
      data-joint-research-policy={execution.policy.version}
      data-joint-research-seed-policy={execution.policy.seedPolicy}
      data-joint-research-kodex-weight-bps={execution.weights[0].weightBps}
      data-joint-research-voo-weight-bps={execution.weights[1].weightBps}
    >
      <header className="flex flex-col gap-3 border-b border-[#e1e5da] px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            공통 날짜쌍 공동 재표본
          </p>
          <h3 className="mt-1 text-lg font-semibold">{execution.name}</h3>
          <p className="mt-1 text-xs text-[#687064]">
            069500 {formatBps(execution.weights[0].weightBps)} · VOO{" "}
            {formatBps(execution.weights[1].weightBps)} · 최초 배분 후 리밸런싱 없음
          </p>
        </div>
        <span className="w-fit rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]">
          계산 완료
        </span>
      </header>

      <SimulationTerminalRiskMetrics terminal={execution.terminal} />

      <ResearchFanChart execution={execution} />

      <div className="grid border-t border-[#e1e5da] text-xs text-[#687064] sm:grid-cols-2">
        <p className="px-4 py-3 sm:border-r sm:border-[#e1e5da]">
          종료 분포 P10 {execution.terminal.p10Index.toFixed(1)} · P50{" "}
          {execution.terminal.p50Index.toFixed(1)} · P90{" "}
          {execution.terminal.p90Index.toFixed(1)}
        </p>
        <p className="px-4 py-3">
          기준일 {formatDate(execution.source.endServiceDate)} · 공통 수익률 쌍{" "}
          {execution.source.returnStepCount}개 · 시작지수 100
        </p>
      </div>
    </article>
  );
}

function unavailableReasonLabel(
  reason: Exclude<FixedMixResearchSimulationResult, { status: "ready" }>["reason"],
) {
  const labels = {
    invalid_weight_selection:
      "KODEX 200 비중은 중복 없이 1~99 사이의 정수 퍼센트로 입력해야 합니다.",
    explicit_end_required:
      "공동 연구 실행은 기준일을 직접 선택한 뒤에만 시작합니다.",
    input_matrix_unavailable:
      "두 종목 모두에 대해 같은 날짜축의 완전한 90개 수익률 쌍이 없습니다.",
    input_matrix_shape_mismatch:
      "입력 기간 또는 종목 구성이 069500·VOO 공동 연구 규격과 일치하지 않습니다.",
    research_vector_invalid: "선택한 명시 비중 연구 가정을 검증하지 못했습니다.",
    draw_plan_blocked: "공동 재표본 추출 계획을 만들지 못했습니다.",
    gross_growth_blocked: "두 종목의 누적 성장 경로를 계산하지 못했습니다.",
    normalized_nav_blocked: "선택 비중의 정규화 경로를 계산하지 못했습니다.",
    summary_blocked: "경로는 계산했지만 분포·위험 요약 검증을 통과하지 못했습니다.",
  } as const;
  return labels[reason];
}

function MixForm({
  endServiceDate,
  kodexWeightPct,
  vooWeightPct,
}: {
  endServiceDate: string;
  kodexWeightPct: number;
  vooWeightPct: number;
}) {
  return (
    <Form action="/simulation" className="flex flex-wrap items-end gap-2" scroll={false}>
      {isDateKey(endServiceDate) ? (
        <input name="end" type="hidden" value={endServiceDate} />
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-[#586358]">
        KODEX 200 최초 비중
        <span className="flex items-center overflow-hidden rounded-md border border-[#cfd5c9] bg-white">
          <input
            className="h-10 w-24 bg-transparent px-3 text-right text-sm tabular-nums outline-none"
            defaultValue={kodexWeightPct}
            max={99}
            min={1}
            name="kodexWeight"
            required
            step={1}
            type="number"
          />
          <span className="pr-3 text-sm">%</span>
        </span>
      </label>
      <div className="h-10 rounded-md border border-[#dfe3d5] bg-[#fbfcf7] px-3 py-2 text-sm tabular-nums">
        VOO {vooWeightPct}%
      </div>
      <button
        className="h-10 rounded-md bg-[#173c35] px-4 text-sm font-semibold text-white"
        type="submit"
      >
        이 비중으로 계산
      </button>
    </Form>
  );
}

function PresetLinks({ endServiceDate }: { endServiceDate: string }) {
  return (
    <nav aria-label="공동 연구 비중 예시" className="flex flex-wrap gap-2">
      {[25, 50, 75].map((kodexWeightPct) => (
        <Link
          className="rounded-md border border-[#d5dacd] bg-[#fbfcf7] px-3 py-2 text-sm font-semibold text-[#33423a]"
          href={simulationHref(endServiceDate, kodexWeightPct)}
          key={kodexWeightPct}
          scroll={false}
        >
          {kodexWeightPct}:{100 - kodexWeightPct}
        </Link>
      ))}
    </nav>
  );
}

function simulationHref(endServiceDate: string, kodexWeightPct: number) {
  const params = new URLSearchParams({ kodexWeight: String(kodexWeightPct) });
  if (isDateKey(endServiceDate)) params.set("end", endServiceDate);
  return `/simulation?${params}`;
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatBps(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}bps`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
