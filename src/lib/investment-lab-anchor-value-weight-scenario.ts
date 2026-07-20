import {
  buildInvestmentLabAnchorAllocationPath,
  type InvestmentLabAnchorAllocationBlocker,
  type InvestmentLabAnchorAllocationPath,
} from "./investment-lab-anchor-allocation-path.ts";
import type { InvestmentLabAnchorSelection } from "./investment-lab-anchor-basket-anchor.ts";
import type { InvestmentLabAnchorEvidenceResolution } from "./investment-lab-anchor-basket-evidence.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import {
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  type InvestmentLabModifiedDietzPeriod,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";

export const INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY =
  Object.freeze({
    version: "anchor_observed_value_weight_same_flow_path_v1",
    anchorAllocation: "stored_anchor_market_value_ratio_once",
    subsequentFlowAllocation: "same_anchor_market_value_ratio",
    futureInformation: "forbidden",
    rebalancing: "none",
    fractionalUnits: true,
    transactionCostsKrw: 0,
    shortSelling: "forbidden_fail_closed",
    partialPath: "forbidden",
  } as const);

export type InvestmentLabAnchorValueWeightScenario = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY;
  anchor: InvestmentLabAnchorSelection;
  weights: readonly Readonly<{
    instrumentKey: string;
    label: string;
    weight: number;
  }>[];
  summary: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    instrumentCount: number;
    allocationBasis:
      | "single_scope_anchor_value_weight"
      | "named_account_anchor_value_weight_then_sum";
    actualEndValueKrw: number;
    scenarioEndValueKrw: number;
    endDifferenceKrw: number;
    comparisonDateCount: number;
  }> | null;
  returnEstimate: Readonly<{
    method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
    actualReturn: number;
    scenarioReturn: number;
    differencePercentagePoints: number;
    actualPeriods: readonly InvestmentLabModifiedDietzPeriod[];
    scenarioPeriods: readonly InvestmentLabModifiedDietzPeriod[];
    scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
  }> | null;
  rows: InvestmentLabAnchorAllocationPath["rows"];
  coverage: InvestmentLabAnchorAllocationPath["coverage"];
  evidenceBlockers: InvestmentLabAnchorAllocationPath["evidenceBlockers"];
  blockers: readonly InvestmentLabAnchorAllocationBlocker[];
}>;

export function buildInvestmentLabAnchorValueWeightScenario(input: Readonly<{
  anchor: InvestmentLabAnchorSelection;
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabAnchorEvidenceResolution | null;
  actualReturn: number | null;
  actualPeriods?: readonly InvestmentLabModifiedDietzPeriod[];
}>): InvestmentLabAnchorValueWeightScenario {
  const anchorTotal = compensatedSum(
    input.anchor.instruments.map(
      (instrument) => instrument.storedMarketValueKrw,
    ),
  );
  const weights =
    Number.isFinite(anchorTotal) && anchorTotal > 0
      ? Object.freeze(
          input.anchor.instruments.map((instrument) =>
            Object.freeze({
              instrumentKey: instrument.key,
              label: instrument.label,
              weight: instrument.storedMarketValueKrw / anchorTotal,
            }),
          ),
        )
      : ([] as const);
  const result = buildInvestmentLabAnchorAllocationPath({
    ...input,
    weights,
  });

  return Object.freeze({
    ...result,
    policy: INVESTMENT_LAB_ANCHOR_VALUE_WEIGHT_SCENARIO_POLICY,
    weights,
    summary: result.summary
      ? Object.freeze({
          ...result.summary,
          allocationBasis: "single_scope_anchor_value_weight" as const,
        })
      : null,
  });
}

function compensatedSum(values: readonly number[]) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + compensation;
}
