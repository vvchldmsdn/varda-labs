import {
  buildInvestmentLabAnchorAllocationPath,
  type InvestmentLabAnchorAllocationBlocker,
  type InvestmentLabAnchorAllocationPath,
} from "./investment-lab-anchor-allocation-path.ts";
import type { InvestmentLabAnchorSelection } from "./investment-lab-anchor-basket-anchor.ts";
import type { InvestmentLabAnchorEvidenceResolution } from "./investment-lab-anchor-basket-evidence.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import { INVESTMENT_LAB_MODIFIED_DIETZ_POLICY } from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";

export const INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY = Object.freeze({
  version: "anchor_observed_equal_weight_same_flow_path_v1",
  anchorAllocation: "exact_equal_ratio_once",
  subsequentFlowAllocation: "exact_equal_ratio_per_anchor_instrument",
  rebalancing: "none",
  fractionalUnits: true,
  transactionCostsKrw: 0,
  shortSelling: "forbidden_fail_closed",
  partialPath: "forbidden",
} as const);

export type InvestmentLabAnchorScenarioBlocker =
  InvestmentLabAnchorAllocationBlocker;

export type InvestmentLabAnchorBasketScenario = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY;
  anchor: InvestmentLabAnchorSelection;
  summary: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    instrumentCount: number;
    equalWeightPct: number | null;
    allocationBasis:
      | "single_scope_equal_weight"
      | "named_account_equal_weight_then_sum";
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
    scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
  }> | null;
  rows: InvestmentLabAnchorAllocationPath["rows"];
  coverage: InvestmentLabAnchorAllocationPath["coverage"];
  evidenceBlockers: InvestmentLabAnchorAllocationPath["evidenceBlockers"];
  blockers: readonly InvestmentLabAnchorScenarioBlocker[];
}>;

export function buildInvestmentLabAnchorBasketScenario(input: Readonly<{
  anchor: InvestmentLabAnchorSelection;
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabAnchorEvidenceResolution | null;
  actualReturn: number | null;
}>): InvestmentLabAnchorBasketScenario {
  const instrumentCount = input.anchor.instruments.length;
  const result = buildInvestmentLabAnchorAllocationPath({
    ...input,
    weights:
      instrumentCount === 0
        ? []
        : input.anchor.instruments.map((instrument) =>
            Object.freeze({
              instrumentKey: instrument.key,
              weight: 1 / instrumentCount,
            }),
          ),
  });
  return Object.freeze({
    ...result,
    policy: INVESTMENT_LAB_ANCHOR_BASKET_SCENARIO_POLICY,
    summary: result.summary
      ? Object.freeze({
          ...result.summary,
          equalWeightPct: 100 / result.summary.instrumentCount,
          allocationBasis: "single_scope_equal_weight" as const,
        })
      : null,
  });
}
