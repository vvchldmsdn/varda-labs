import type { ReactNode } from "react";

import { AnalysisJourneyNav } from "@/components/analysis-journey-nav";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import { InvestmentLabScenarioChartView } from "./investment-lab-scenario-chart";
import { InvestmentLabCashComparisonView } from "./investment-lab-cash-comparison";
import { InvestmentLabContributionExperiment } from "./investment-lab-contribution-experiment";
import { InvestmentLabFundingPreflightView } from "./investment-lab-funding-preflight";
import { InvestmentLabObservedHistoryView } from "./investment-lab-observed-history";
import { InvestmentLabPeriodSelector } from "./investment-lab-period-selector";
import { InvestmentLabScenarioMatrix } from "./investment-lab-scenario-matrix";
import type { InvestmentLabAnchorBasketScenario } from "@/lib/investment-lab-anchor-basket-scenario";
import type { InvestmentLabAnchorValueWeightScenario } from "@/lib/investment-lab-anchor-value-weight-scenario";
import type { InvestmentLabAnchorScheduledRebalanceScenario } from "@/lib/investment-lab-anchor-scheduled-rebalance";
import type { InvestmentLabApprovedTargetWeightScenario } from "@/lib/investment-lab-approved-target-weight";
import type { InvestmentLabAccountComposition } from "@/lib/investment-lab-account-composition";
import type { InvestmentLabAccountFundingPreflight } from "@/lib/investment-lab-account-funding-preflight";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";
import type { InvestmentLabPeriodSelection } from "@/lib/investment-lab-period-selection";
import type { InvestmentLabFountRuntimeScope } from "@/lib/investment-lab-fount-runtime-scope";
import type { InvestmentLabObservedHistory } from "@/lib/investment-lab-observed-history-segments";
import type { InvestmentLabPreperiodOptimizer } from "@/lib/investment-lab-preperiod-optimizer";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";

export function InvestmentLabView({
  accountComposition,
  anchorBasketScenario,
  anchorValueWeightScenario,
  anchorCurrentWeightMonthlyScenario,
  anchorEqualWeightMonthlyScenario,
  approvedTargetWeightScenario,
  dataAvailability,
  fountScopeAdjustment,
  fundingPreflight,
  generatedAt,
  model,
  observedHistory,
  optimizerStatus,
  period,
  scopeCatalog,
  scopeQuery,
  selectedScope,
}: {
  accountComposition: InvestmentLabAccountComposition;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  dataAvailability: ReactNode;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  fundingPreflight: InvestmentLabAccountFundingPreflight;
  generatedAt: string;
  model: InvestmentLabCounterfactualReadModel;
  observedHistory: InvestmentLabObservedHistory;
  optimizerStatus: InvestmentLabPreperiodOptimizer["status"];
  period: InvestmentLabPeriodSelection;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  scopeQuery: PortfolioAnalysisScopeQuery;
  selectedScope: PortfolioAnalysisScope;
}) {
  const periodReady =
    period.status === "full" ||
    period.status === "current_writer" ||
    period.status === "selected";
  const showSegmentedHistory =
    period.status === "unavailable" &&
    period.reason === "range_evidence_incomplete" &&
    observedHistory.status !== "unavailable";

  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[#f8f9f6] text-[#171a16]"
      data-applied-flows={periodReady ? model.coverage.appliedFlowRows : 0}
      data-account-composition-status={accountComposition.status}
      data-analysis-scope={selectedScope.key}
      data-anchor-value-weight-comparison-dates={
        periodReady && anchorValueWeightScenario.status === "ready"
          ? (anchorValueWeightScenario.summary?.comparisonDateCount ?? 0)
          : 0
      }
      data-anchor-value-weight-status={
        periodReady ? anchorValueWeightScenario.status : "unavailable"
      }
      data-anchor-current-weight-monthly-status={
        periodReady ? anchorCurrentWeightMonthlyScenario.status : "unavailable"
      }
      data-anchor-current-weight-monthly-comparison-dates={
        periodReady && anchorCurrentWeightMonthlyScenario.status === "ready"
          ? (anchorCurrentWeightMonthlyScenario.summary?.comparisonDateCount ?? 0)
          : 0
      }
      data-anchor-current-weight-monthly-rebalances={
        periodReady && anchorCurrentWeightMonthlyScenario.status === "ready"
          ? (anchorCurrentWeightMonthlyScenario.summary?.rebalanceCount ?? 0)
          : 0
      }
      data-anchor-equal-weight-monthly-status={
        periodReady ? anchorEqualWeightMonthlyScenario.status : "unavailable"
      }
      data-anchor-equal-weight-monthly-comparison-dates={
        periodReady && anchorEqualWeightMonthlyScenario.status === "ready"
          ? (anchorEqualWeightMonthlyScenario.summary?.comparisonDateCount ?? 0)
          : 0
      }
      data-anchor-equal-weight-monthly-rebalances={
        periodReady && anchorEqualWeightMonthlyScenario.status === "ready"
          ? (anchorEqualWeightMonthlyScenario.summary?.rebalanceCount ?? 0)
          : 0
      }
      data-approved-target-weight-status={
        periodReady ? approvedTargetWeightScenario.status : "unavailable"
      }
      data-approved-target-weight-policy-bindings={
        periodReady && approvedTargetWeightScenario.status === "ready"
          ? approvedTargetWeightScenario.policyBindings.length
          : 0
      }
      data-comparison-dates={
        periodReady ? model.coverage.completeComparisonDates : 0
      }
      data-cash-comparison-status={
        periodReady
          ? (model.cashComparison?.status ?? "unavailable")
          : "unavailable"
      }
      data-delayed-executions={
        periodReady ? model.coverage.delayedExecutionRows : 0
      }
      data-page="investment-lab"
      data-fount-scope-adjustment={fountScopeAdjustment.status}
      data-output-authority="research_counterfactual_not_executable"
      data-observed-path-status={model.observedPath.status}
      data-observed-history-status={observedHistory.status}
      data-observed-history-segments={observedHistory.coverage.segmentCount}
      data-pending-at-end={periodReady ? model.coverage.pendingAtEndRows : 0}
      data-period-status={period.status}
      data-read-model-status={model.status}
      data-return-status={
        periodReady
          ? (model.returnEstimate?.status ?? "unavailable")
          : "unavailable"
      }
      data-scenario-close-rows={
        periodReady ? model.coverage.scenarioCloseRows : 0
      }
      data-voo-comparison-status={
        periodReady
          ? (model.vooComparison?.status ?? "unavailable")
          : "unavailable"
      }
      data-voo-readiness={
        periodReady
          ? (model.vooReadiness?.status ?? "unavailable")
          : "unavailable"
      }
      data-source-authority-decision={model.sourceAuthority.decision}
      data-source-authority-status={model.sourceAuthority.status}
      data-source-transition-count={
        model.sourceAuthority.coverage.sourceTransitionCount
      }
    >
      <PortfolioPrimaryNavigation
        activePath="/investment-lab"
        generatedAt={generatedAt}
        selectedScopeKey={selectedScope.key}
      />

      <div className="mx-auto w-full max-w-[1540px] px-5 pb-16 pt-7 sm:px-8 lg:px-10">
        <header>
          <div className="flex items-center justify-between gap-5 text-[11px] text-[#777d75]">
            <p>PORTFOLIO / INVESTMENT LAB</p>
            <p className="tabular-nums">분석 범위 {selectedScope.label}</p>
          </div>
          <div className="mt-3">
            <PortfolioAnalysisScopeTabs
              basePath="/investment-lab"
              query={scopeQuery}
              scopes={scopeCatalog}
              selectedScopeKey={selectedScope.key}
              variant="underline"
            />
          </div>
        </header>

        <div className="mt-8 scroll-mt-4" id="investment-lab-results">
          <InvestmentLabPeriodSelector
            period={period}
            query={scopeQuery}
            scopeKey={selectedScope.key}
          />

          {showSegmentedHistory ? (
            <div className="mt-6">
              <InvestmentLabObservedHistoryView
                model={observedHistory}
                query={scopeQuery}
                scopeKey={selectedScope.key}
              />
            </div>
          ) : null}

          {!periodReady ? (
            <div className="mt-6 space-y-4">
              <InvestmentLabJourneyNav
                model={model}
                optimizerStatus={optimizerStatus}
                periodReady={false}
                showSegmentedHistory={showSegmentedHistory}
              />
              {dataAvailability}
              <InvestmentLabFundingPreflightView model={fundingPreflight} />
            </div>
          ) : model.observedPath.status === "ready" ? (
            <ReadyView
              anchorBasketScenario={anchorBasketScenario}
              anchorValueWeightScenario={anchorValueWeightScenario}
              anchorCurrentWeightMonthlyScenario={
                anchorCurrentWeightMonthlyScenario
              }
              anchorEqualWeightMonthlyScenario={anchorEqualWeightMonthlyScenario}
              approvedTargetWeightScenario={approvedTargetWeightScenario}
              dataAvailability={dataAvailability}
              fountScopeAdjustment={fountScopeAdjustment}
              fundingPreflight={fundingPreflight}
              model={model}
              optimizerStatus={optimizerStatus}
              period={period}
              selectedScope={selectedScope}
            />
          ) : (
            <div className="mt-6 space-y-4">
              <InvestmentLabJourneyNav
                model={model}
                optimizerStatus={optimizerStatus}
                periodReady
                showSegmentedHistory={false}
              />
              {dataAvailability}
              <InvestmentLabFundingPreflightView model={fundingPreflight} />
              <BlockedView model={model} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function investmentLabResultStatus({
  model,
  periodReady,
  showSegmentedHistory,
}: {
  model: InvestmentLabCounterfactualReadModel;
  periodReady: boolean;
  showSegmentedHistory: boolean;
}) {
  if (!periodReady) {
    return showSegmentedHistory ? "부분 이력 표시" : "기간 확인 필요";
  }
  if (model.observedPath.status !== "ready") return "입력 확인 필요";
  return model.status === "ready" ? "계산 가능" : "일부 계산 가능";
}

function optimizerStatusLabel(
  status: InvestmentLabPreperiodOptimizer["status"],
) {
  if (status === "ready") return "4개 목적 계산 가능";
  if (status === "training_unavailable") return "학습 이력 확인 필요";
  return "비교 경로 확인 필요";
}

function InvestmentLabJourneyNav({
  model,
  optimizerStatus,
  periodReady,
  showSegmentedHistory,
}: {
  model: InvestmentLabCounterfactualReadModel;
  optimizerStatus: InvestmentLabPreperiodOptimizer["status"];
  periodReady: boolean;
  showSegmentedHistory: boolean;
}) {
  return (
    <AnalysisJourneyNav
      items={[
        {
          description: "실제와 대안 세계선",
          href: "#investment-lab-results",
          label: "성과 비교",
          status: investmentLabResultStatus({
            model,
            periodReady,
            showSegmentedHistory,
          }),
        },
        {
          description: "수익·위험 목적별 비중",
          href: "#investment-lab-optimizer",
          label: "비중 실험",
          status: optimizerStatusLabel(optimizerStatus),
        },
        {
          description: "충격 구간과 ETF 내부",
          href: "#investment-lab-etf-xray",
          label: "스트레스와 구성",
          status: "독립 계산",
        },
        {
          description: "비중 변경 전후 구조",
          href: "#investment-lab-small-adjustment",
          label: "작은 조정",
          status: "독립 계산",
        },
      ]}
      title="투자랩 분석 흐름"
      variant="editorial"
    />
  );
}

function ReadyView({
  anchorBasketScenario,
  anchorValueWeightScenario,
  anchorCurrentWeightMonthlyScenario,
  anchorEqualWeightMonthlyScenario,
  approvedTargetWeightScenario,
  dataAvailability,
  fountScopeAdjustment,
  fundingPreflight,
  model,
  optimizerStatus,
  period,
  selectedScope,
}: {
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  dataAvailability: ReactNode;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  fundingPreflight: InvestmentLabAccountFundingPreflight;
  model: InvestmentLabCounterfactualReadModel;
  optimizerStatus: InvestmentLabPreperiodOptimizer["status"];
  period: InvestmentLabPeriodSelection;
  selectedScope: PortfolioAnalysisScope;
}) {
  const observedSummary = model.observedPath.summary!;
  const fixedMixWeights = model.fixedMixScenario?.weights ?? null;

  return (
    <>
      <InvestmentLabScenarioChartView
        anchorBasketScenario={anchorBasketScenario}
        anchorValueWeightScenario={anchorValueWeightScenario}
        anchorCurrentWeightMonthlyScenario={anchorCurrentWeightMonthlyScenario}
        anchorEqualWeightMonthlyScenario={anchorEqualWeightMonthlyScenario}
        approvedTargetWeightScenario={approvedTargetWeightScenario}
        model={model}
      />

      <div className="mt-6">
        <InvestmentLabJourneyNav
          model={model}
          optimizerStatus={optimizerStatus}
          periodReady
          showSegmentedHistory={false}
        />
      </div>

      <details className="group mt-6 border-y border-[#dce1da] bg-[#f8f9f6] px-5 py-4 sm:px-7 lg:px-9">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold marker:content-none">
          <span>계산 근거와 준비 상태</span>
          <span className="text-xs font-normal text-[#777d75] group-open:hidden">
            펼쳐서 확인
          </span>
          <span className="hidden text-xs font-normal text-[#777d75] group-open:inline">
            접기
          </span>
        </summary>
        <div className="mt-5 space-y-4 border-t border-[#dce1da] pt-5">
          {dataAvailability}
          <InvestmentLabFundingPreflightView model={fundingPreflight} />
        </div>
      </details>

      <div className="mt-6">
        <CurrentWriterSegmentNotice
          fountScopeAdjustment={fountScopeAdjustment}
          model={model}
          period={period}
          selectedScope={selectedScope}
        />
      </div>

      <div className="mt-6">
        <InvestmentLabScenarioMatrix
          anchorBasketScenario={anchorBasketScenario}
          anchorValueWeightScenario={anchorValueWeightScenario}
          anchorCurrentWeightMonthlyScenario={anchorCurrentWeightMonthlyScenario}
          anchorEqualWeightMonthlyScenario={anchorEqualWeightMonthlyScenario}
          approvedTargetWeightScenario={approvedTargetWeightScenario}
          model={model}
        />
      </div>

      <div className="mt-6">
        <InvestmentLabCashComparisonView comparison={model.cashComparison} />
      </div>

      <div className="mt-6">
        <ReturnEstimateSection model={model} />
      </div>

      <div className="mt-6">
        <VooComparisonSection model={model} />
      </div>

      <div className="mt-6">
        <InvestmentLabContributionExperiment
          fixedMixWeights={fixedMixWeights}
          key={`${observedSummary.startServiceDate}:${observedSummary.endServiceDate}:${fixedMixWeights?.kodexWeightBps ?? 0}`}
          scenarios={model.contributionExperimentScenarios}
        />
      </div>

      {model.status === "ready" ? (
        <section className="overflow-hidden border-y border-[#dde1db]">
        <div className="flex flex-col gap-1 border-b border-[#e1e6dc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">비교 데이터</h2>
            <p className="mt-1 text-sm text-[#687064]">
              평가액과 해당 시점에 사용된 KODEX 200 가격 기준일을 함께 확인합니다.
            </p>
          </div>
          <p className="text-sm text-[#687064]">
            기간 내 반영 거래 {model.coverage.appliedFlowRows}건 · 지연 체결 {model.coverage.delayedExecutionRows}건
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#dde1db] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-4 py-3">평가일</th>
                <th className="px-3 py-3 text-right">실제 평가액</th>
                <th className="px-3 py-3 text-right">KODEX 200</th>
                <th className="px-3 py-3 text-right">차이</th>
                <th className="px-4 py-3">가격 기준</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.serviceDate} className="border-t border-[#e1e6dc]">
                  <td className="px-4 py-3 font-medium">{formatDate(row.serviceDate)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.actualMarketValueKrw)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.scenarioMarketValueKrw)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-semibold tabular-nums ${moneyTone(row.differenceKrw)}`}
                  >
                    {formatSignedKrw(row.differenceKrw)}
                  </td>
                  <td className="px-4 py-3 text-[#687064]">
                    {formatDate(row.valuationPriceDate)}
                    {row.hasPendingExecution ? " · 지연 체결" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>
      ) : null}

      <section className="border-y border-[#dde1db] py-5">
        <h2 className="text-lg font-semibold">데이터 상태</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <EvidenceCell label="완전한 비교일" value={`${model.coverage.completeComparisonDates}일`} />
          <EvidenceCell label="평가 스냅샷" value={`${model.coverage.snapshotSourceRows}행`} />
          <EvidenceCell
            label={`KODEX 200 ${kodexPriceBasisLabel(model.scenario.priceBasis)}`}
            value={`${model.coverage.scenarioCloseRows}행`}
          />
          <EvidenceCell label="종료 시 대기 거래" value={`${model.coverage.pendingAtEndRows}건`} />
        </div>
      </section>
    </>
  );
}

function kodexPriceBasisLabel(
  priceBasis: InvestmentLabCounterfactualReadModel["scenario"]["priceBasis"],
) {
  if (priceBasis === "kis_raw_close") {
    return "KIS 원종가(배당·기업행사 미조정)";
  }
  if (priceBasis === "provider_adjusted_close") return "조정종가";
  return "가격 근거";
}

function CurrentWriterSegmentNotice({
  fountScopeAdjustment,
  model,
  period,
  selectedScope,
}: {
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  selectedScope: PortfolioAnalysisScope;
}) {
  const summary = model.observedPath.summary!;
  return (
    <section
      className="border-y border-[#dde1db] py-5"
      data-section="investment-lab-current-writer-segment"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-semibold">최신 writer 관측 구간 연구 비교</h2>
          <p className="mt-1 text-sm leading-6 text-[#5f685d]">
            {formatDate(summary.startServiceDate)} ~ {formatDate(summary.endServiceDate)} · {summary.comparisonDateCount}개 평가일만 사용합니다. 레거시 구간과 이어 붙이지 않았고, 짧은 구간이므로 연환산·순위·스트레스 결론을 만들지 않습니다.
          </p>
        </div>
        <span className="w-fit border border-[#d4dbce] px-3 py-1.5 text-xs font-semibold text-[#4e594d]">
          {period.status === "current_writer" ? "최신 구간 자동 적용" : "명시 구간 적용"}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#73786c]">
        {selectedScope.label} 범위의 연구용 반사실 비교이며, 계정별 매수 가능 상품·환전·세금·주문 가능성을 검증한 투자 권고가 아닙니다. 금현물은 저장된 수동 평가 이력을 사용합니다.
        {fountScopeAdjustment.status === "applied"
          ? ` Fount는 ${fountScopeAdjustment.adjustedDateCount}개 평가일에서 제외했습니다.`
          : ""}
      </p>
    </section>
  );
}

function ReturnEstimateSection({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  const estimate = model.returnEstimate;
  if (!estimate || estimate.status === "blocked") {
    return (
      <section className="border-y border-[#e6dcc2] py-5">
        <h2 className="text-lg font-semibold text-[#5f5027]">
          현금흐름 조정 추정수익률
        </h2>
        <p className="mt-2 text-sm text-[#725f2d]">
          평가액 비교는 유지하지만 가격 기준 또는 계산 입력이 불충분해 수익률 추정치는 표시하지 않습니다.
        </p>
        {estimate ? (
          <ul className="mt-3 space-y-1 text-sm text-[#725f2d]">
            {estimate.blockers.map((blocker) => (
              <li key={blocker}>{returnBlockerLabel(blocker)}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="border-y border-[#dde1db] py-6"
      data-return-method={estimate.method.version}
    >
      <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">현금흐름 조정 추정수익률</h2>
          <p className="mt-1 text-sm text-[#687064]">
            관측 평가일 사이의 일별 가중 현금흐름을 반영한 Modified Dietz 추정치
          </p>
        </div>
        <p className="text-xs text-[#777e73]">
          가격수익 기준 · 배당·수수료·세금 별도 반영 안 함
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ReturnMetricCell
          label="실제 포트폴리오"
          value={formatSignedPercent(estimate.actualReturn)}
          detail={`${estimate.periodCount}개 구간 · 거래 ${estimate.actualFlowCount}건`}
          tone={estimate.actualReturn >= 0 ? "positive" : "negative"}
        />
        <ReturnMetricCell
          label="전액 KODEX 200"
          value={formatSignedPercent(estimate.scenarioReturn)}
          detail={`${estimate.periodCount}개 구간 · 체결 ${estimate.scenarioFlowCount}건`}
          tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
        />
        <ReturnMetricCell
          label="수익률 차이"
          value={formatSignedPercentagePoints(
            estimate.differencePercentagePoints,
          )}
          detail="KODEX 200 - 실제"
          tone={
            estimate.differencePercentagePoints >= 0
              ? "positive"
              : "negative"
          }
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#777e73]">
        현금흐름 직전 전체 평가액이 없는 구간을 날짜 가중 방식으로 추정한 값이며, 정확한 일별 TWR 또는 총수익률을 의미하지 않습니다.
      </p>
    </section>
  );
}

function VooComparisonSection({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  const readiness = model.vooReadiness;
  const comparison = model.vooComparison;
  if (!readiness || !comparison) return null;

  if (comparison.status === "ready") {
    const summary = comparison.summary;
    const estimate = comparison.returnEstimate;
    return (
      <section
        className="border-y border-[#dde1db] py-6"
        data-voo-applied-flows={comparison.coverage.appliedFlowRows}
        data-voo-comparison-dates={summary.comparisonDateCount}
        data-voo-delayed-executions={
          comparison.coverage.delayedExecutionRows
        }
        data-voo-execution-fx-ready={readiness.executionFxReadyCount}
        data-voo-relevant-flows={readiness.relevantFlowCount}
        data-voo-return-method={estimate.method.version}
        data-voo-return-status={estimate.status}
        data-voo-service-dates={readiness.serviceDateCount}
        data-voo-snapshot-fx-provenance-ready={
          readiness.snapshotFxProvenanceReadyCount
        }
        data-voo-snapshot-fx-ready={readiness.snapshotFxReadyCount}
        data-voo-valuation-price-ready={readiness.valuationPriceReadyCount}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">전액 VOO 비교</h2>
            <p className="mt-1 text-sm text-[#687064]">
              실제와 같은 원화 매수·매도 금액을 VOO에 적용한 가격수익 경로
            </p>
          </div>
          <p className="text-sm font-semibold text-[#087f4f]">
            계산 완료
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ReadinessMetric
            label="VOO 종료 평가액"
            value={formatKrw(summary.scenarioEndValueKrw)}
            detail={`${summary.comparisonDateCount}개 평가일`}
          />
          <ReadinessMetric
            label="실제 대비 차이"
            value={formatSignedKrw(summary.endDifferenceKrw)}
            detail="VOO - 실제"
          />
          <ReadinessMetric
            label="체결 증거"
            value={`${comparison.coverage.appliedFlowRows}/${readiness.relevantFlowCount}`}
            detail={`지연 체결 ${comparison.coverage.delayedExecutionRows}건`}
          />
        </div>

        {estimate.status === "ready" ? (
          <div className="mt-4 grid gap-3 border-t border-[#e1e6dc] pt-4 sm:grid-cols-3">
            <ReturnMetricCell
              label="실제 추정수익률"
              value={formatSignedPercent(estimate.actualReturn)}
              detail={`${estimate.periodCount}개 구간`}
              tone={estimate.actualReturn >= 0 ? "positive" : "negative"}
            />
            <ReturnMetricCell
              label="전액 VOO 추정수익률"
              value={formatSignedPercent(estimate.scenarioReturn)}
              detail={`체결 ${estimate.scenarioFlowCount}건`}
              tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
            />
            <ReturnMetricCell
              label="수익률 차이"
              value={formatSignedPercentagePoints(
                estimate.differencePercentagePoints,
              )}
              detail="VOO - 실제"
              tone={
                estimate.differencePercentagePoints >= 0
                  ? "positive"
                  : "negative"
              }
            />
          </div>
        ) : (
          <p className="mt-4 border-y border-[#e6dcc2] py-3 text-sm text-[#725f2d]">
            경로는 계산됐지만 현금·이벤트 근거가 불충분해 추정수익률은 표시하지 않습니다.
          </p>
        )}

        <div className="mt-5 border-t border-[#e1e6dc] pt-4">
          <InvestmentLabComparisonChart
            chartId="investment-lab-voo-chart"
            description="저장된 평가일마다 실제 평가액과 동일한 원화 거래금액을 VOO raw close와 당시 저장 환율에 적용한 가상 평가액을 비교합니다."
            rows={comparison.rows}
            scenarioLabel="전액 VOO"
            title="실제 포트폴리오와 VOO 시나리오 비교"
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-[#777e73]">
          소수점 수량을 허용해 잔여 현금을 만들지 않으며, 보유 수량을 넘는 매도는 축소·차입 없이 전체 시나리오를 차단합니다. VOO raw close와 같은 서비스 날짜에 저장된 환율을 사용하고 배당 재투자는 제외합니다.
        </p>
      </section>
    );
  }

  return (
    <section
      className="border-y border-[#dde1db] py-6"
      data-voo-execution-fx-ready={readiness.executionFxReadyCount}
      data-voo-relevant-flows={readiness.relevantFlowCount}
      data-voo-service-dates={readiness.serviceDateCount}
      data-voo-snapshot-fx-ready={readiness.snapshotFxReadyCount}
      data-voo-snapshot-fx-provenance-ready={
        readiness.snapshotFxProvenanceReadyCount
      }
      data-voo-valuation-price-ready={readiness.valuationPriceReadyCount}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">전액 VOO 비교 준비도</h2>
          <p className="mt-1 text-sm text-[#687064]">
            미국 종가·환율·체결일 증거가 모두 맞을 때만 다음 단계에서 경로를 계산합니다.
          </p>
        </div>
        <p
          className={
            readiness.status === "ready"
              ? "text-sm font-semibold text-[#087f4f]"
              : "text-sm font-semibold text-[#9a6b18]"
          }
        >
          {readiness.status === "ready" ? "계산 입력 준비" : "증거 보완 필요"}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ReadinessMetric
          label="VOO 평가 종가"
          value={`${readiness.valuationPriceReadyCount}/${readiness.serviceDateCount}`}
          detail="미국 거래일 raw close"
        />
        <ReadinessMetric
          label="평가 환율"
          value={`${readiness.snapshotFxReadyCount}/${readiness.serviceDateCount}`}
          detail={`출처 합의 ${readiness.snapshotFxProvenanceReadyCount}/${readiness.serviceDateCount}`}
        />
        <ReadinessMetric
          label="체결 환율"
          value={`${readiness.executionFxReadyCount}/${readiness.relevantFlowCount}`}
          detail="체결 가격일 exact FX"
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#777e73]">
        실제 포트폴리오와 같은 가격수익 기준을 위해 VOO raw close를 사용하고 배당 재투자는 제외합니다. 준비 전에는 부분 경로나 추정값을 표시하지 않습니다.
      </p>
      {readiness.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-[#725f2d]">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{vooReadinessBlockerLabel(blocker)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function BlockedView({ model }: { model: InvestmentLabCounterfactualReadModel }) {
  return (
    <section className="border-y border-[#e6dcc2] py-6">
      <h2 className="text-lg font-semibold text-[#5f5027]">현재 계산할 수 없습니다</h2>
      <p className="mt-2 text-sm text-[#725f2d]">
        일부 결과를 추정해서 표시하지 않고 입력 증거를 차단했습니다.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[#725f2d]">
        {model.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ReturnMetricCell({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "negative";
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "positive" ? "text-[#087f4f]" : "text-[#c43d39]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function ReadinessMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function blockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    source_segment_authority_blocked:
      "선택 기간에 레거시와 현재 스냅샷이 섞였거나 현재 저장 구간이 아닙니다.",
    fount_scope_adjustment_blocked:
      "Fount 제외 경로의 계정·날짜·저장 식별 근거를 확인해야 합니다.",
    snapshot_evidence_invalid: "평가 스냅샷 형식 또는 중복을 확인해야 합니다.",
    actual_path_reconciliation_mismatch: "저장된 전체 평가액과 계정별 합계가 일치하지 않습니다.",
    actual_path_incomplete: "비교 가능한 전체 계정 평가일이 부족합니다.",
    event_account_unresolved: "일부 거래 이벤트의 계정을 확정할 수 없습니다.",
    event_evidence_unsupported: "거래 금액 또는 이벤트 유형을 확인해야 합니다.",
    scenario_close_evidence_invalid: "KODEX 200 조정종가 증거를 확인해야 합니다.",
    flow_schedule_blocked: "거래일 이후 7일 안에 체결 가능한 종가가 없습니다.",
    path_calculation_blocked: "가상 경로 계산의 보존 조건을 충족하지 못했습니다.",
    pending_flows_at_window_end: "마지막 평가일까지 처리되지 않은 거래가 있습니다.",
  };
  return labels[blocker] ?? "입력 증거를 확인해야 합니다.";
}

function returnBlockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    valuation_axis_mismatch: "실제 경로와 가상 경로의 평가일이 일치하지 않습니다.",
    price_basis_unavailable: "비교 구간의 종가 기준을 확인할 수 없습니다.",
    price_basis_mismatch: "종가와 조정종가 기준이 섞여 있어 동일 기준 비교가 아닙니다.",
    actual_return_calculation_blocked: "실제 포트폴리오 수익률 입력을 확인해야 합니다.",
    scenario_return_calculation_blocked: "KODEX 200 수익률 입력을 확인해야 합니다.",
    cash_evidence_unavailable: "평가일별 현금 제외 근거를 확인할 수 없습니다.",
    nonzero_cash_evidence: "현금이 있는 구간의 수익률 정책이 아직 확정되지 않았습니다.",
    ambiguous_position_metadata_event:
      "자산 추가·제외 이벤트에 재무 값이 섞여 있어 별도 분류가 필요합니다.",
    unmodeled_return_event: "수익률에 영향을 줄 수 있는 미분류 이벤트가 있습니다.",
  };
  return labels[blocker] ?? "수익률 계산 입력을 확인해야 합니다.";
}

function vooReadinessBlockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    invalid_service_date_axis: "비교 평가일 축을 확인해야 합니다.",
    missing_valuation_price: "일부 평가일의 미국 거래일 종가가 없습니다.",
    duplicate_valuation_price: "같은 날짜의 VOO 종가가 중복되어 있습니다.",
    invalid_valuation_price: "사용할 수 없는 VOO 종가가 있습니다.",
    missing_snapshot_fx: "일부 평가일의 저장 환율이 없습니다.",
    ambiguous_snapshot_fx: "같은 평가일의 계좌별 환율이 일치하지 않습니다.",
    invalid_flow_date: "거래 기준일을 확인해야 합니다.",
    missing_execution_price: "거래 이후 체결 가능한 VOO 종가가 없습니다.",
    duplicate_execution_price: "체결 기준일의 VOO 종가가 중복되어 있습니다.",
    invalid_execution_price: "체결 기준일의 VOO 종가를 사용할 수 없습니다.",
    execution_price_too_late: "거래와 체결 가능일 간격이 허용 범위를 넘었습니다.",
    execution_after_window: "비교 종료일까지 체결되지 않는 거래가 있습니다.",
    missing_execution_fx: "일부 체결 가격일의 USD/KRW가 없습니다.",
    duplicate_execution_fx: "일부 체결 가격일의 USD/KRW가 중복되어 있습니다.",
    invalid_execution_fx: "일부 체결 가격일의 USD/KRW를 사용할 수 없습니다.",
  };
  return labels[blocker] ?? "VOO 비교 입력을 확인해야 합니다.";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrw(value: number) {
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}₩${Math.round(Math.abs(value)).toLocaleString("ko-KR")}`;
}

function formatSignedPercent(value: number) {
  if (Math.abs(value) < 0.0000005) return "0.00%";
  return `${value > 0 ? "+" : "-"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

function formatSignedPercentagePoints(value: number) {
  if (Math.abs(value) < 0.0005) return "0.00%p";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%p`;
}

function moneyTone(value: number) {
  return value > 0
    ? "text-[#087f4f]"
    : value < 0
      ? "text-[#c43d39]"
      : "text-[#5d665b]";
}
