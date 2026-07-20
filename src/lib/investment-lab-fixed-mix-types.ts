import {
  INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  type InvestmentLabModifiedDietzPeriod,
} from "./investment-lab-modified-dietz.ts";
import type { InvestmentLabPathRiskMetrics } from "./investment-lab-path-risk.ts";

export const INVESTMENT_LAB_FIXED_MIX_POLICY = Object.freeze({
  version: "kodex_voo_fixed_allocation_same_flow_v1",
  instruments: Object.freeze([
    "korea:KRW:069500",
    "us:USD:VOO",
  ]),
  allocationBoundary: "initial_value_and_each_external_flow",
  rebalancing: "none",
  fractionalUnits: true,
  residualCash: 0,
  partialLegResults: "forbidden",
  componentEvidence: "existing_ready_kodex_and_voo_paths",
  authority: "historical_research_only",
} as const);

export type InvestmentLabFixedMixActualRow = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

export type InvestmentLabFixedMixComponentRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  investedMarketValueKrw: number;
  comparisonBasis: string;
}>;

export type InvestmentLabFixedMixComponentFlow = Readonly<{
  sourceIndex: number;
  executionServiceDate: string;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

export type InvestmentLabFixedMixComponentPath = Readonly<{
  status: string;
  rows: readonly InvestmentLabFixedMixComponentRow[];
  appliedFlows: readonly InvestmentLabFixedMixComponentFlow[];
}>;

export type InvestmentLabFixedMixReturnEvidence = Readonly<{
  status: string;
  actualReturn: number | null;
}>;

export type InvestmentLabFixedMixWeights = Readonly<{
  kodexWeightBps: number;
  vooWeightBps: number;
}>;

export type InvestmentLabFixedMixBlocker =
  | "invalid_weight_selection"
  | "component_path_unavailable"
  | "valuation_axis_mismatch"
  | "invalid_component_value"
  | "component_flow_mismatch"
  | "return_evidence_unavailable"
  | "actual_return_mismatch"
  | "scenario_return_calculation_blocked"
  | "account_composition_incomplete"
  | "account_composition_mismatch";

export type InvestmentLabFixedMixRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  differenceKrw: number;
  kodexValueKrw: number;
  vooValueKrw: number;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabFixedMixScenario =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_FIXED_MIX_POLICY;
      weights: InvestmentLabFixedMixWeights;
      summary: Readonly<{
        startServiceDate: string;
        endServiceDate: string;
        actualEndValueKrw: number;
        scenarioEndValueKrw: number;
        endDifferenceKrw: number;
        comparisonDateCount: number;
      }>;
      returnEstimate: Readonly<{
        method: typeof INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
        actualReturn: number;
        scenarioReturn: number;
        differencePercentagePoints: number;
        scenarioPeriods: readonly InvestmentLabModifiedDietzPeriod[];
        scenarioRiskMetrics: InvestmentLabPathRiskMetrics;
      }>;
      rows: readonly InvestmentLabFixedMixRow[];
      coverage: Readonly<{
        componentFlowSourceCount: number;
        scenarioFlowLegCount: number;
        splitExecutionDateRows: number;
        pendingComparisonRows: number;
      }>;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      policy: typeof INVESTMENT_LAB_FIXED_MIX_POLICY;
      weights: InvestmentLabFixedMixWeights | null;
      summary: null;
      returnEstimate: null;
      rows: readonly [];
      coverage: Readonly<{
        componentFlowSourceCount: 0;
        scenarioFlowLegCount: 0;
        splitExecutionDateRows: 0;
        pendingComparisonRows: 0;
      }>;
      blockers: readonly InvestmentLabFixedMixBlocker[];
    }>;
