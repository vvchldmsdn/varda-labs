import Link from "next/link";

import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import {
  INVESTMENT_LAB_FIXED_MIX_POLICY,
  type InvestmentLabFixedMixBlocker,
  type InvestmentLabFixedMixScenario,
} from "@/lib/investment-lab-fixed-mix";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabPeriodSelection } from "@/lib/investment-lab-period-selection";
import type { PortfolioAccountScope } from "@/lib/portfolio-account-scope";

export function InvestmentLabFixedMix({
  account,
  model,
  period,
  selection,
}: {
  account: PortfolioAccountScope;
  model: InvestmentLabFixedMixScenario | null;
  period: InvestmentLabPeriodSelection;
  selection: InvestmentLabFixedMixSelection;
}) {
  const periodReady =
    period.status === "full" ||
    period.status === "current_writer" ||
    period.status === "selected";
  const ready =
    periodReady && selection.status !== "invalid" && model?.status === "ready";
  const kodexWeightPct = selection.kodexWeightPct ?? 50;
  const vooWeightPct = selection.vooWeightPct ?? 50;

  return (
    <section
      className="border-t border-[#dfe3d5] bg-[#f3f4ef] px-4 py-6"
      data-fixed-mix-comparison-dates={
        ready ? model.summary.comparisonDateCount : 0
      }
      data-fixed-mix-flow-sources={
        ready ? model.coverage.componentFlowSourceCount : 0
      }
      data-fixed-mix-kodex-weight-bps={selection.kodexWeightBps ?? 0}
      data-fixed-mix-pending-comparison-rows={
        ready ? model.coverage.pendingComparisonRows : 0
      }
      data-fixed-mix-policy={INVESTMENT_LAB_FIXED_MIX_POLICY.version}
      data-fixed-mix-return-status={ready ? "ready" : "unavailable"}
      data-fixed-mix-scenario-flow-legs={
        ready ? model.coverage.scenarioFlowLegCount : 0
      }
      data-fixed-mix-selection-status={selection.status}
      data-fixed-mix-split-execution-date-rows={
        ready ? model.coverage.splitExecutionDateRows : 0
      }
      data-fixed-mix-status={ready ? "ready" : "unavailable"}
      data-fixed-mix-voo-weight-bps={selection.vooWeightBps ?? 0}
      data-section="investment-lab-fixed-mix"
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[#657065]">
              Historical research
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              KODEX 200·VOO 고정 배분 실험
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
              초기 평가액과 실제 매수·매도 금액을 선택 비율로 나눠 두
              종목에 적용합니다. 이후 가격 변동에 따른 비중 변화는 그대로
              두며 중간 재리밸런싱은 하지 않습니다.
            </p>
          </div>
          <MixForm
            account={account}
            kodexWeightPct={kodexWeightPct}
            period={period}
            vooWeightPct={vooWeightPct}
          />
        </div>

        <PresetLinks account={account} period={period} />

        {selection.status === "invalid" ? (
          <UnavailableMessage>
            KODEX 200 배분은 1~99 사이의 정수 퍼센트로 입력해야 합니다.
          </UnavailableMessage>
        ) : !periodReady ? (
          <UnavailableMessage>
            먼저 사용할 수 있는 과거 비교 구간을 선택해야 합니다.
          </UnavailableMessage>
        ) : model?.status !== "ready" ? (
          <UnavailableMessage>
            {model?.blockers.map(blockerLabel).join(" · ") ??
              "기존 KODEX 200·VOO 경로 증거를 준비할 수 없습니다."}
          </UnavailableMessage>
        ) : (
          <FixedMixResult model={model} />
        )}

        <p className="text-xs leading-5 text-[#73786c]">
          두 leg 중 하나라도 가격·환율·체결·매도 가능성 검증에 실패하면
          부분 결과를 표시하지 않습니다. 소수점 수량을 사용해 자동 잔여
          현금을 만들지 않으며, 이 결과는 목표비중·추천·주문 근거가 아닌
          과거 연구 비교입니다.
        </p>
        <p className="text-xs leading-5 text-[#73786c]">
          KODEX 200은 조정종가, VOO는 원종가 × 저장 USD/KRW로 합산하며
          VOO 배당은 반영하지 않습니다. 서로 다른 가격 기준을 결합한
          현금흐름 조정 추정치이므로 정확한 일별 TWR 또는 총수익률을
          의미하지 않습니다.
        </p>
      </div>
    </section>
  );
}

function MixForm({
  account,
  kodexWeightPct,
  period,
  vooWeightPct,
}: {
  account: PortfolioAccountScope;
  kodexWeightPct: number;
  period: InvestmentLabPeriodSelection;
  vooWeightPct: number;
}) {
  return (
    <form
      action="/investment-lab"
      className="flex flex-wrap items-end gap-2"
      method="get"
    >
      <input name="account" type="hidden" value={account} />
      <PeriodHiddenInputs period={period} />
      <label className="grid gap-1 text-xs font-semibold text-[#586358]">
        KODEX 200 배분
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
        계산
      </button>
    </form>
  );
}

function PresetLinks({
  account,
  period,
}: {
  account: PortfolioAccountScope;
  period: InvestmentLabPeriodSelection;
}) {
  return (
    <nav aria-label="고정 배분 예시" className="flex flex-wrap gap-2">
      {[25, 50, 75].map((kodexWeightPct) => (
        <Link
          className="rounded-md border border-[#d5dacd] bg-[#fbfcf7] px-3 py-2 text-sm font-semibold text-[#33423a]"
          href={mixHref(account, period, kodexWeightPct)}
          key={kodexWeightPct}
        >
          {kodexWeightPct}:{100 - kodexWeightPct}
        </Link>
      ))}
    </nav>
  );
}

function FixedMixResult({ model }: { model: Extract<InvestmentLabFixedMixScenario, { status: "ready" }> }) {
  const summary = model.summary;
  const estimate = model.returnEstimate;
  const kodexWeightPct = model.weights.kodexWeightBps / 100;
  const vooWeightPct = model.weights.vooWeightBps / 100;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="시나리오 종료 평가액"
          value={formatKrw(summary.scenarioEndValueKrw)}
        />
        <SummaryCell
          label="실제 대비 차이"
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
          value={formatSignedKrw(summary.endDifferenceKrw)}
        />
        <SummaryCell
          label="현금흐름 조정 추정수익률"
          tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
          value={formatSignedPercent(estimate.scenarioReturn)}
        />
        <SummaryCell
          label="실제 대비 수익률 차이"
          tone={
            estimate.differencePercentagePoints >= 0
              ? "positive"
              : "negative"
          }
          value={formatSignedPercentagePoints(
            estimate.differencePercentagePoints,
          )}
        />
      </div>

      <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <InvestmentLabComparisonChart
          chartId="investment-lab-fixed-mix-chart"
          description={`실제 포트폴리오와 KODEX 200 ${kodexWeightPct}%, VOO ${vooWeightPct}% 고정 배분 same-flow 경로를 비교합니다.`}
          rows={model.rows}
          scenarioLabel={`KODEX ${kodexWeightPct}% · VOO ${vooWeightPct}%`}
          title="실제 포트폴리오와 고정 배분 시나리오 비교"
        />
      </div>

      <p className="text-sm text-[#687064]">
        관측일 {summary.comparisonDateCount}개 · 원본 현금흐름 {" "}
        {model.coverage.componentFlowSourceCount}건 · 분할 체결 {" "}
        {model.coverage.scenarioFlowLegCount}건 · 두 시장 체결일이 달랐던
        현금흐름 {model.coverage.splitExecutionDateRows}건
      </p>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#08784d]"
            : tone === "negative"
              ? "text-[#bd2929]"
              : "text-[#111411]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function UnavailableMessage({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-[#ead9b2] bg-[#fff9ea] px-4 py-3 text-sm text-[#73551b]">
      {children}
    </p>
  );
}

function PeriodHiddenInputs({ period }: { period: InvestmentLabPeriodSelection }) {
  if (
    period.status !== "selected" ||
    !period.selectedStartServiceDate ||
    !period.selectedEndServiceDate
  ) {
    return null;
  }
  return (
    <>
      <input name="start" type="hidden" value={period.selectedStartServiceDate} />
      <input name="end" type="hidden" value={period.selectedEndServiceDate} />
    </>
  );
}

function mixHref(
  account: PortfolioAccountScope,
  period: InvestmentLabPeriodSelection,
  kodexWeightPct: number,
) {
  const params = new URLSearchParams({
    account,
    kodexWeight: String(kodexWeightPct),
  });
  if (
    period.status === "selected" &&
    period.selectedStartServiceDate &&
    period.selectedEndServiceDate
  ) {
    params.set("start", period.selectedStartServiceDate);
    params.set("end", period.selectedEndServiceDate);
  }
  return `/investment-lab?${params}`;
}

function blockerLabel(blocker: InvestmentLabFixedMixBlocker) {
  const labels: Record<InvestmentLabFixedMixBlocker, string> = {
    invalid_weight_selection: "배분 입력을 확인해야 합니다.",
    component_path_unavailable: "두 종목의 완전한 경로가 모두 필요합니다.",
    valuation_axis_mismatch: "두 종목의 비교 날짜축이 일치하지 않습니다.",
    invalid_component_value: "구성 종목 평가액 근거를 확인해야 합니다.",
    component_flow_mismatch: "두 종목의 현금흐름 원본이 일치하지 않습니다.",
    return_evidence_unavailable: "수익률 근거가 완전하지 않습니다.",
    actual_return_mismatch: "실제 수익률 기준이 서로 일치하지 않습니다.",
    scenario_return_calculation_blocked: "시나리오 수익률을 계산할 수 없습니다.",
    account_composition_incomplete: "계좌별 시나리오 근거가 모두 필요합니다.",
    account_composition_mismatch: "계좌별 합계와 전체 결과가 일치하지 않습니다.",
  };
  return labels[blocker];
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedKrw(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatKrw(value)}`;
}

function formatSignedPercent(value: number) {
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

function formatSignedPercentagePoints(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%p`;
}
