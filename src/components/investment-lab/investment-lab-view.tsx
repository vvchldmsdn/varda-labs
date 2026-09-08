import { InvestmentLabDeferredPerformance } from "./investment-lab-deferred-performance";
import type { InvestmentLabWeightEvidence } from "@/lib/investment-lab-weight-evidence";
import type { ReactNode } from "react";

import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { InvestmentLabWorkspace } from "./investment-lab-workspace";
import styles from "./investment-lab-modern.module.css";
import { InvestmentLabScopeTabs } from "./investment-lab-scope-tabs";
import { InvestmentLabDialog } from "./investment-lab-dialog";
import { InvestmentLabScenarioChartView } from "./investment-lab-scenario-chart";
import { InvestmentLabFundingPreflightView } from "./investment-lab-funding-preflight";
import { InvestmentLabObservedHistoryView } from "./investment-lab-observed-history";
import { InvestmentLabPeriodSelector } from "./investment-lab-period-selector";
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
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";

export function InvestmentLabView({
  weightEvidence,
  accountComposition,
  anchorBasketScenario,
  anchorValueWeightScenario,
  anchorCurrentWeightMonthlyScenario,
  anchorEqualWeightMonthlyScenario,
  approvedTargetWeightScenario,
  dataAvailability,
  readiness,
  fountScopeAdjustment,
  fundingPreflight,
  generatedAt,
  model,
  observedHistory,
  period,
  scopeCatalog,
  scopeQuery,
  selectedScope,
}: {
  weightEvidence: InvestmentLabWeightEvidence;
  accountComposition: InvestmentLabAccountComposition;
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  dataAvailability: ReactNode;
  readiness: ReactNode;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  fundingPreflight: InvestmentLabAccountFundingPreflight;
  generatedAt: string;
  model: InvestmentLabCounterfactualReadModel;
  observedHistory: InvestmentLabObservedHistory;
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
      className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]"
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
          ? (anchorCurrentWeightMonthlyScenario.summary?.comparisonDateCount ??
            0)
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

      <div className="varda-content varda-presentation-content varda-stage-content flex flex-col">
        <header className={styles.stageHeader}>
          <h1 className="varda-page-title">투자 랩</h1>
          <InvestmentLabScopeTabs scopes={scopeCatalog} selectedScopeKey={selectedScope.key} />
        </header>

        <div
          className={styles.workspaceSlot}
          id="investment-lab-results"
        >
          <InvestmentLabWorkspace
            weights={weightEvidence}
            scopeKey={selectedScope.key}
            tools={
              <>
                <InvestmentLabPeriodSelector
                  period={period}
                  query={scopeQuery}
                  scopeKey={selectedScope.key}
                />
                <InvestmentLabDialog
                  title="계산 근거와 데이터 준비"
                  label="데이터"
                  size="wide"
                >
                  <div className="space-y-6">
                    {dataAvailability}
                    <InvestmentLabFundingPreflightView
                      model={fundingPreflight}
                    />
                    {readiness}
                  </div>
                </InvestmentLabDialog>
              </>
            }
            comparison={
              <>
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
                    {dataAvailability}
                    <InvestmentLabFundingPreflightView
                      model={fundingPreflight}
                    />
                  </div>
                ) : model.observedPath.status === "ready" ? (
                  <ReadyView
                    anchorBasketScenario={anchorBasketScenario}
                    anchorValueWeightScenario={anchorValueWeightScenario}
                    anchorCurrentWeightMonthlyScenario={
                      anchorCurrentWeightMonthlyScenario
                    }
                    anchorEqualWeightMonthlyScenario={
                      anchorEqualWeightMonthlyScenario
                    }
                    approvedTargetWeightScenario={approvedTargetWeightScenario}
                    fountScopeAdjustment={fountScopeAdjustment}
                    model={model}
                    period={period}
                    selectedScope={selectedScope}
                  />
                ) : (
                  <div className="mt-6 space-y-4">
                    {dataAvailability}
                    <InvestmentLabFundingPreflightView
                      model={fundingPreflight}
                    />
                    <BlockedView model={model} />
                  </div>
                )}
              </>
            }
          />
        </div>
      </div>
    </main>
  );
}

function ReadyView({
  anchorBasketScenario,
  anchorValueWeightScenario,
  anchorCurrentWeightMonthlyScenario,
  anchorEqualWeightMonthlyScenario,
  approvedTargetWeightScenario,
  model,
}: {
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  anchorCurrentWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  anchorEqualWeightMonthlyScenario: InvestmentLabAnchorScheduledRebalanceScenario;
  approvedTargetWeightScenario: InvestmentLabApprovedTargetWeightScenario;
  fountScopeAdjustment: InvestmentLabFountRuntimeScope;
  model: InvestmentLabCounterfactualReadModel;
  period: InvestmentLabPeriodSelection;
  selectedScope: PortfolioAnalysisScope;
}) {

  return (
    <>
      <InvestmentLabScenarioChartView
        anchorBasketScenario={anchorBasketScenario}
        anchorValueWeightScenario={anchorValueWeightScenario}
        anchorCurrentWeightMonthlyScenario={anchorCurrentWeightMonthlyScenario}
        anchorEqualWeightMonthlyScenario={anchorEqualWeightMonthlyScenario}
        approvedTargetWeightScenario={approvedTargetWeightScenario}
        model={model}
        details={<InvestmentLabDeferredPerformance />}
      />
    </>
  );
}

function BlockedView({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  return (
    <section className="border-y border-[var(--brand-soft)] py-6">
      <h2 className="text-lg font-semibold text-[var(--warning)]">
        현재 계산할 수 없습니다
      </h2>
      <p className="mt-2 text-sm text-[var(--warning)]">
        일부 결과를 추정해서 표시하지 않고 입력 증거를 차단했습니다.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[var(--warning)]">
        {model.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

function blockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    source_segment_authority_blocked:
      "선택 기간에 레거시와 현재 스냅샷이 섞였거나 현재 저장 구간이 아닙니다.",
    fount_scope_adjustment_blocked:
      "Fount 제외 경로의 계정·날짜·저장 식별 근거를 확인해야 합니다.",
    snapshot_evidence_invalid: "평가 스냅샷 형식 또는 중복을 확인해야 합니다.",
    actual_path_reconciliation_mismatch:
      "저장된 전체 평가액과 계정별 합계가 일치하지 않습니다.",
    actual_path_incomplete: "비교 가능한 전체 계정 평가일이 부족합니다.",
    event_account_unresolved: "일부 거래 이벤트의 계정을 확정할 수 없습니다.",
    event_evidence_unsupported: "거래 금액 또는 이벤트 유형을 확인해야 합니다.",
    scenario_close_evidence_invalid:
      "KODEX 200 조정종가 증거를 확인해야 합니다.",
    flow_schedule_blocked: "거래일 이후 7일 안에 체결 가능한 종가가 없습니다.",
    path_calculation_blocked:
      "가상 경로 계산의 보존 조건을 충족하지 못했습니다.",
    pending_flows_at_window_end:
      "마지막 평가일까지 처리되지 않은 거래가 있습니다.",
  };
  return labels[blocker] ?? "입력 증거를 확인해야 합니다.";
}
