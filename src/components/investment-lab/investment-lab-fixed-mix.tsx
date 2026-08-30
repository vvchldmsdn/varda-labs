import {
  InvestmentLabQueryFields,
  InvestmentLabQueryLink,
} from "./investment-lab-query-controls";

import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import {
  InvestmentLabFixedMixStandardComparison,
  isInvestmentLabStandardFixedMixPreset,
} from "./investment-lab-fixed-mix-standard-comparison";
import {
  formatInvestmentLabKrw,
  formatInvestmentLabSignedKrw,
  formatInvestmentLabSignedPercent,
  investmentLabFixedMixBlockerLabel,
} from "./investment-lab-fixed-mix-presentation";
import {
  INVESTMENT_LAB_FIXED_MIX_POLICY,
  type InvestmentLabFixedMixScenario,
} from "@/lib/investment-lab-fixed-mix";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFixedMixComparison as FixedMixComparisonModel } from "@/lib/investment-lab-fixed-mix-comparison";
import type { InvestmentLabPeriodSelection } from "@/lib/investment-lab-period-selection";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

export function InvestmentLabFixedMix({
  comparison,
  model,
  period,
  scopeKey,
  selection,
}: {
  comparison: FixedMixComparisonModel | null;
  model: InvestmentLabFixedMixScenario | null;
  period: InvestmentLabPeriodSelection;
  scopeKey: PortfolioAnalysisScopeKey;
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
      className="min-w-0 py-6"
      data-fixed-mix-comparison-dates={
        ready ? model.summary.comparisonDateCount : 0
      }
      data-fixed-mix-comparison-ready={
        periodReady ? (comparison?.readyScenarioCount ?? 0) : 0
      }
      data-fixed-mix-comparison-status={
        periodReady ? (comparison?.status ?? "unavailable") : "unavailable"
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
      <div className="mx-auto w-full max-w-[1540px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">
              ALLOCATION SANDBOX
            </p>
            <h2 className="mt-2 text-lg font-medium sm:text-xl">
              KODEX 200·VOO 고정 배분 실험
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              초기 평가액과 실제 매수·매도 금액을 선택 비율로 나눠 두 종목에
              적용합니다. 이후 가격 변동에 따른 비중 변화는 그대로 두며 중간
              재리밸런싱은 하지 않습니다.
            </p>
          </div>
          <MixForm
            kodexWeightPct={kodexWeightPct}
            period={period}
            scopeKey={scopeKey}
            vooWeightPct={vooWeightPct}
          />
        </div>

        <PresetLinks period={period} scopeKey={scopeKey} />

        {!periodReady ? (
          <UnavailableMessage>
            먼저 사용할 수 있는 과거 비교 구간을 선택해야 합니다.
          </UnavailableMessage>
        ) : (
          <InvestmentLabFixedMixStandardComparison
            model={comparison}
            selectedKodexWeightPct={selection.kodexWeightPct}
          />
        )}

        {periodReady && selection.status === "invalid" ? (
          <UnavailableMessage>
            KODEX 200 배분은 1~99 사이의 정수 퍼센트로 입력해야 합니다.
          </UnavailableMessage>
        ) : periodReady &&
          !isInvestmentLabStandardFixedMixPreset(selection.kodexWeightPct) &&
          model?.status !== "ready" ? (
          <UnavailableMessage>
            {model?.blockers
              .map(investmentLabFixedMixBlockerLabel)
              .join(" · ") ??
              "기존 KODEX 200·VOO 경로 증거를 준비할 수 없습니다."}
          </UnavailableMessage>
        ) : periodReady &&
          !isInvestmentLabStandardFixedMixPreset(selection.kodexWeightPct) &&
          model?.status === "ready" ? (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">직접 입력한 비중 상세</h3>
            <FixedMixResult model={model} />
          </div>
        ) : null}

        <p className="text-xs leading-5 text-[var(--muted)]">
          두 leg 중 하나라도 가격·환율·체결·매도 가능성 검증에 실패하면 부분
          결과를 표시하지 않습니다. 소수점 수량을 사용해 자동 잔여 현금을 만들지
          않으며, 이 결과는 목표비중·추천·주문 근거가 아닌 과거 연구 비교입니다.
        </p>
        <p className="text-xs leading-5 text-[var(--muted)]">
          KODEX 200과 VOO는 화면에 표시된 저장 가격 근거를 사용하며, KIS 원종가
          구간은 배당·기업행사를 조정하지 않습니다. 서로 다른 가격 기준을 결합한
          현금흐름 조정 추정치이므로 정확한 일별 TWR 또는 총수익률을 의미하지
          않습니다.
        </p>
      </div>
    </section>
  );
}

function MixForm({
  kodexWeightPct,
  period,
  scopeKey,
  vooWeightPct,
}: {
  kodexWeightPct: number;
  period: InvestmentLabPeriodSelection;
  scopeKey: PortfolioAnalysisScopeKey;
  vooWeightPct: number;
}) {
  return (
    <form
      action="/investment-lab"
      className="flex flex-wrap items-end gap-2"
      method="get"
    >
      <input name="scope" type="hidden" value={scopeKey} />
      <InvestmentLabQueryFields />
      <PeriodHiddenInputs period={period} />
      <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
        KODEX 200 배분
        <span className="flex items-center overflow-hidden rounded-md border border-[var(--line)] bg-white">
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
      <div className="h-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm tabular-nums">
        VOO {vooWeightPct}%
      </div>
      <button
        className="h-10 rounded-md bg-[var(--ink)] px-4 text-sm font-semibold text-white"
        type="submit"
      >
        계산
      </button>
    </form>
  );
}

function PresetLinks({
  period,
  scopeKey,
}: {
  period: InvestmentLabPeriodSelection;
  scopeKey: PortfolioAnalysisScopeKey;
}) {
  return (
    <nav
      aria-label="고정 배분 예시"
      className="flex flex-wrap gap-5 border-y border-[var(--line)] py-3"
    >
      {[25, 50, 75].map((kodexWeightPct) => (
        <InvestmentLabQueryLink
          className="border-b border-transparent py-1 text-sm font-semibold text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
          href={mixHref(scopeKey, period, kodexWeightPct)}
          key={kodexWeightPct}
        >
          {kodexWeightPct}:{100 - kodexWeightPct}
        </InvestmentLabQueryLink>
      ))}
    </nav>
  );
}

function FixedMixResult({
  model,
}: {
  model: Extract<InvestmentLabFixedMixScenario, { status: "ready" }>;
}) {
  const summary = model.summary;
  const estimate = model.returnEstimate;
  const kodexWeightPct = model.weights.kodexWeightBps / 100;
  const vooWeightPct = model.weights.vooWeightBps / 100;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="시나리오 종료 평가액"
          value={formatInvestmentLabKrw(summary.scenarioEndValueKrw)}
        />
        <SummaryCell
          label="실제 대비 차이"
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
          value={formatInvestmentLabSignedKrw(summary.endDifferenceKrw)}
        />
        <SummaryCell
          label="현금흐름 조정 추정수익률"
          tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
          value={formatInvestmentLabSignedPercent(estimate.scenarioReturn)}
        />
        <SummaryCell
          label="실제 대비 수익률 차이"
          tone={
            estimate.differencePercentagePoints >= 0 ? "positive" : "negative"
          }
          value={formatSignedPercentagePoints(
            estimate.differencePercentagePoints,
          )}
        />
      </div>

      <div className="border-y border-[var(--line)] py-6">
        <InvestmentLabComparisonChart
          chartId="investment-lab-fixed-mix-chart"
          description={`실제 포트폴리오와 KODEX 200 ${kodexWeightPct}%, VOO ${vooWeightPct}% 고정 배분 same-flow 경로를 비교합니다.`}
          rows={model.rows}
          scenarioLabel={`KODEX ${kodexWeightPct}% · VOO ${vooWeightPct}%`}
          title="실제 포트폴리오와 고정 배분 시나리오 비교"
        />
      </div>

      <p className="text-sm text-[var(--muted)]">
        관측일 {summary.comparisonDateCount}개 · 원본 현금흐름{" "}
        {model.coverage.componentFlowSourceCount}건 · 분할 체결{" "}
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
    <div className="border-b border-[var(--line)] px-4 py-5 first:border-l-0 xl:border-r">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[var(--brand)]"
            : tone === "negative"
              ? "text-[var(--negative)]"
              : "text-[var(--ink)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function UnavailableMessage({ children }: { children: string }) {
  return (
    <p className="border-y border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--warning)]">
      {children}
    </p>
  );
}

function PeriodHiddenInputs({
  period,
}: {
  period: InvestmentLabPeriodSelection;
}) {
  if (
    period.status !== "selected" ||
    !period.selectedStartServiceDate ||
    !period.selectedEndServiceDate
  ) {
    return null;
  }
  return (
    <>
      <input
        name="start"
        type="hidden"
        value={period.selectedStartServiceDate}
      />
      <input name="end" type="hidden" value={period.selectedEndServiceDate} />
    </>
  );
}

function mixHref(
  scopeKey: PortfolioAnalysisScopeKey,
  period: InvestmentLabPeriodSelection,
  kodexWeightPct: number,
) {
  const query: Record<string, string> = {
    kodexWeight: String(kodexWeightPct),
  };
  if (
    period.status === "selected" &&
    period.selectedStartServiceDate &&
    period.selectedEndServiceDate
  ) {
    query.start = period.selectedStartServiceDate;
    query.end = period.selectedEndServiceDate;
  }
  return buildPortfolioAnalysisScopeHref("/investment-lab", scopeKey, query);
}

function formatSignedPercentagePoints(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%p`;
}
