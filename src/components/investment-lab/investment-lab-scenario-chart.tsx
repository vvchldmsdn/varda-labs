import {
  InvestmentLabTimeMachine,
  type InvestmentLabTimeMachineScenarioSummary,
} from "@/components/investment-lab/investment-lab-time-machine";
import type { InvestmentLabAnchorBasketScenario } from "@/lib/investment-lab-anchor-basket-scenario";
import type { InvestmentLabAnchorValueWeightScenario } from "@/lib/investment-lab-anchor-value-weight-scenario";
import type { InvestmentLabAnchorScheduledRebalanceScenario } from "@/lib/investment-lab-anchor-scheduled-rebalance";
import type { InvestmentLabApprovedTargetWeightScenario } from "@/lib/investment-lab-approved-target-weight";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";
import { buildInvestmentLabScenarioChart } from "@/lib/investment-lab-scenario-chart";
import { buildInvestmentLabScenarioMatrix } from "@/lib/investment-lab-scenario-matrix";

export function InvestmentLabScenarioChartView({
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
  model: InvestmentLabCounterfactualReadModel;
}) {
  const input = {
    model,
    anchorBasketScenario,
    anchorValueWeightScenario,
    anchorCurrentWeightMonthlyScenario,
    anchorEqualWeightMonthlyScenario,
    approvedTargetWeightScenario,
  } as const;
  const chart = buildInvestmentLabScenarioChart(input);
  if (!chart.period || chart.lines.length === 0) return null;

  const matrix = buildInvestmentLabScenarioMatrix(input);
  const matrixRows = new Map(matrix.rows.map((row) => [row.id, row]));
  const actualEndValueKrw =
    chart.lines.find((line) => line.id === "actual")?.points.at(-1)?.valueKrw ??
    null;
  const scenarioSummaries: readonly InvestmentLabTimeMachineScenarioSummary[] =
    chart.lines.map((line) => {
      const matrixRow = matrixRows.get(line.id);
      const endValueKrw =
        matrixRow?.endValueKrw ?? line.points.at(-1)?.valueKrw ?? null;
      return Object.freeze({
        id: line.id,
        endValueKrw,
        endDifferenceKrw:
          matrixRow?.endDifferenceKrw ??
          (endValueKrw !== null && actualEndValueKrw !== null
            ? endValueKrw - actualEndValueKrw
            : null),
        returnEstimate:
          matrixRow?.returnEstimate.status === "ready"
            ? matrixRow.returnEstimate.value
            : null,
        maximumDrawdown: matrixRow?.riskMetrics.maximumDrawdown ?? null,
        annualizedVolatility:
          matrixRow?.riskMetrics.annualizedVolatility ?? null,
      });
    });

  return (
    <section
      data-scenario-chart-anchor={chart.policy.initialAnchorRequirement}
      data-scenario-chart-domain={chart.policy.yDomain}
      data-scenario-chart-lines={chart.lines.length}
      data-scenario-chart-status={chart.status}
      data-scenario-chart-unavailable={chart.unavailableScenarioIds.length}
      data-section="investment-lab-scenario-chart"
    >
      <InvestmentLabTimeMachine
        chart={chart}
        scenarioSummaries={scenarioSummaries}
      />
      {chart.unavailableScenarioIds.length > 0 ? (
        <p className="border-b border-[#dce1da] bg-[#fffaf0] px-5 py-3 text-sm text-[#725f2d] sm:px-7 lg:px-9">
          계산 근거가 부족한 {chart.unavailableScenarioIds.length}개 경로는
          임의로 채우지 않았습니다. 아래 비교표에서 경로별 사유를 확인할 수
          있습니다.
        </p>
      ) : null}
    </section>
  );
}
