import { resolveInvestmentLabFixedMixFlows } from "./investment-lab-fixed-mix-flows.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import {
  INVESTMENT_LAB_FIXED_MIX_POLICY,
  type InvestmentLabFixedMixActualRow,
  type InvestmentLabFixedMixBlocker,
  type InvestmentLabFixedMixComponentPath,
  type InvestmentLabFixedMixComponentRow,
  type InvestmentLabFixedMixReturnEvidence,
  type InvestmentLabFixedMixScenario,
  type InvestmentLabFixedMixWeights,
} from "./investment-lab-fixed-mix-types.ts";
import {
  calculateInvestmentLabModifiedDietz,
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
} from "./investment-lab-modified-dietz.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export { INVESTMENT_LAB_FIXED_MIX_POLICY } from "./investment-lab-fixed-mix-types.ts";
export type {
  InvestmentLabFixedMixBlocker,
  InvestmentLabFixedMixRow,
  InvestmentLabFixedMixScenario,
} from "./investment-lab-fixed-mix-types.ts";

export function buildInvestmentLabFixedMixScenario(input: {
  selection: InvestmentLabFixedMixSelection;
  actualPath: readonly InvestmentLabFixedMixActualRow[];
  kodexPath: InvestmentLabFixedMixComponentPath;
  vooPath: InvestmentLabFixedMixComponentPath;
  kodexReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
  vooReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
}): InvestmentLabFixedMixScenario {
  const weights = selectionWeights(input.selection);
  if (!weights) return unavailable(null, ["invalid_weight_selection"]);
  if (input.kodexPath.status !== "ready" || input.vooPath.status !== "ready") {
    return unavailable(weights, ["component_path_unavailable"]);
  }

  const rowBlocker = validateRows(
    input.actualPath,
    input.kodexPath.rows,
    input.vooPath.rows,
  );
  if (rowBlocker) return unavailable(weights, [rowBlocker]);

  const flowResolution = resolveInvestmentLabFixedMixFlows(
    input.kodexPath.appliedFlows,
    input.vooPath.appliedFlows,
    weights,
  );
  if (!flowResolution) {
    return unavailable(weights, ["component_flow_mismatch"]);
  }

  const actualReturn = resolveActualReturn(
    input.kodexReturnEvidence,
    input.vooReturnEvidence,
  );
  if (actualReturn.status !== "ready") {
    return unavailable(weights, [actualReturn.blocker]);
  }

  const kodexRatio = weights.kodexWeightBps / 10_000;
  const vooRatio = weights.vooWeightBps / 10_000;
  const rows = Object.freeze(
    input.actualPath.map((actual, index) => {
      const kodex = input.kodexPath.rows[index];
      const voo = input.vooPath.rows[index];
      const kodexValueKrw = kodex.investedMarketValueKrw * kodexRatio;
      const vooValueKrw = voo.investedMarketValueKrw * vooRatio;
      const scenarioMarketValueKrw = kodexValueKrw + vooValueKrw;
      return Object.freeze({
        serviceDate: actual.serviceDate,
        actualMarketValueKrw: actual.totalMarketValueKrw,
        scenarioMarketValueKrw,
        differenceKrw: scenarioMarketValueKrw - actual.totalMarketValueKrw,
        kodexValueKrw,
        vooValueKrw,
        hasPendingExecution:
          hasPendingExecution(kodex) || hasPendingExecution(voo),
      });
    }),
  );
  const scenarioReturn = calculateInvestmentLabModifiedDietz({
    valuations: rows.map((row) => ({
      serviceDate: row.serviceDate,
      valueKrw: row.scenarioMarketValueKrw,
    })),
    flows: flowResolution.scenarioFlows,
  });
  if (scenarioReturn.status !== "ready") {
    return unavailable(weights, ["scenario_return_calculation_blocked"]);
  }

  const latest = rows.at(-1)!;
  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_FIXED_MIX_POLICY,
    weights,
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnEstimate: Object.freeze({
      method: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
      actualReturn: actualReturn.value,
      scenarioReturn: scenarioReturn.totalReturn,
      differencePercentagePoints:
        (scenarioReturn.totalReturn - actualReturn.value) * 100,
      scenarioPeriods: scenarioReturn.periods,
      scenarioRiskMetrics: scenarioReturn.riskMetrics,
    }),
    rows,
    coverage: Object.freeze({
      componentFlowSourceCount: flowResolution.sourceCount,
      scenarioFlowLegCount: flowResolution.scenarioFlows.length,
      splitExecutionDateRows: flowResolution.splitExecutionDateRows,
      pendingComparisonRows: rows.filter((row) => row.hasPendingExecution)
        .length,
    }),
    blockers: [] as const,
  });
}

function selectionWeights(
  selection: InvestmentLabFixedMixSelection,
): InvestmentLabFixedMixWeights | null {
  const kodexWeightBps = selection.kodexWeightBps;
  const vooWeightBps = selection.vooWeightBps;
  if (
    selection.status === "invalid" ||
    kodexWeightBps === null ||
    vooWeightBps === null ||
    !Number.isInteger(kodexWeightBps) ||
    !Number.isInteger(vooWeightBps) ||
    kodexWeightBps <= 0 ||
    vooWeightBps <= 0 ||
    kodexWeightBps + vooWeightBps !== 10_000
  ) {
    return null;
  }
  return Object.freeze({ kodexWeightBps, vooWeightBps });
}

function validateRows(
  actualRows: readonly InvestmentLabFixedMixActualRow[],
  kodexRows: readonly InvestmentLabFixedMixComponentRow[],
  vooRows: readonly InvestmentLabFixedMixComponentRow[],
): "valuation_axis_mismatch" | "invalid_component_value" | null {
  if (
    actualRows.length < 2 ||
    actualRows.length !== kodexRows.length ||
    actualRows.length !== vooRows.length
  ) {
    return "valuation_axis_mismatch";
  }

  for (let index = 0; index < actualRows.length; index += 1) {
    const actual = actualRows[index];
    const kodex = kodexRows[index];
    const voo = vooRows[index];
    if (
      !isRiskDate(actual.serviceDate) ||
      actual.serviceDate !== kodex.serviceDate ||
      actual.serviceDate !== voo.serviceDate ||
      (index > 0 && actualRows[index - 1].serviceDate >= actual.serviceDate)
    ) {
      return "valuation_axis_mismatch";
    }
    if (
      !positiveFinite(actual.totalMarketValueKrw) ||
      !nonNegativeFinite(kodex.investedMarketValueKrw) ||
      !nonNegativeFinite(voo.investedMarketValueKrw) ||
      !nearlyEqual(kodex.actualMarketValueKrw, actual.totalMarketValueKrw) ||
      !nearlyEqual(voo.actualMarketValueKrw, actual.totalMarketValueKrw)
    ) {
      return "invalid_component_value";
    }
  }
  return null;
}

function resolveActualReturn(
  kodex: InvestmentLabFixedMixReturnEvidence | null,
  voo: InvestmentLabFixedMixReturnEvidence | null,
):
  | Readonly<{ status: "ready"; value: number }>
  | Readonly<{
      status: "unavailable";
      blocker: "return_evidence_unavailable" | "actual_return_mismatch";
    }> {
  if (
    kodex?.status !== "ready" ||
    voo?.status !== "ready" ||
    kodex.actualReturn === null ||
    voo.actualReturn === null ||
    !Number.isFinite(kodex.actualReturn) ||
    !Number.isFinite(voo.actualReturn)
  ) {
    return { status: "unavailable", blocker: "return_evidence_unavailable" };
  }
  if (!nearlyEqual(kodex.actualReturn, voo.actualReturn, 1e-10)) {
    return { status: "unavailable", blocker: "actual_return_mismatch" };
  }
  return { status: "ready", value: kodex.actualReturn };
}

function hasPendingExecution(row: InvestmentLabFixedMixComponentRow) {
  return row.comparisonBasis === "position_value_only_with_pending_flows";
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function nearlyEqual(left: number, right: number, tolerance = 1e-8) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function unavailable(
  weights: InvestmentLabFixedMixWeights | null,
  blockers: readonly InvestmentLabFixedMixBlocker[],
): InvestmentLabFixedMixScenario {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_FIXED_MIX_POLICY,
    weights,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      componentFlowSourceCount: 0 as const,
      scenarioFlowLegCount: 0 as const,
      splitExecutionDateRows: 0 as const,
      pendingComparisonRows: 0 as const,
    }),
    blockers: Object.freeze([...new Set(blockers)].sort()),
  });
}
