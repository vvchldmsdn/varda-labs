import type { InvestmentLabFixedMixWeights } from "./investment-lab-fixed-mix-types.ts";

export const INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY = Object.freeze({
  version: "historical_fixed_mix_contribution_v1",
  allocationBoundary: "selected_observed_valuation_boundary",
  allocationRule: "selected_fixed_mix_weights",
  rebalancing: "none_after_contribution",
  fractionalUnits: true,
  residualCashKrw: 0,
  transactionCostsKrw: 0,
  interpolation: "forbidden",
  latestPriceFallback: "forbidden",
  persistence: "none_client_memory_only",
  authority: "historical_research_only",
  componentPriceBasis: Object.freeze({
    kodex200: "adjusted_close_krw",
    voo: "raw_close_usd_times_stored_snapshot_fx",
  }),
} as const);

export type InvestmentLabFixedMixContributionPoint = Readonly<{
  serviceDate: string;
  kodexPriceDate: string;
  vooPriceDate: string;
  kodexUnitValueKrw: number;
  vooUnitValueKrw: number;
  baseScenarioValueKrw: number;
}>;

export type InvestmentLabFixedMixContributionEvidence = Readonly<{
  weights: InvestmentLabFixedMixWeights;
  points: readonly InvestmentLabFixedMixContributionPoint[];
}>;

export type InvestmentLabFixedMixContributionRow = Readonly<{
  serviceDate: string;
  kodexPriceDate: string;
  vooPriceDate: string;
  baseScenarioValueKrw: number;
  kodexAdditionalValueKrw: number;
  vooAdditionalValueKrw: number;
  additionalValueKrw: number;
  projectedScenarioValueKrw: number;
}>;

export type InvestmentLabFixedMixContributionBlocker =
  | "invalid_component_evidence"
  | "invalid_weight_selection"
  | "invalid_contribution_amount"
  | "contribution_date_unavailable"
  | "invalid_calculation_result";

export type InvestmentLabFixedMixContributionResult =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY;
      scenarioId: "fixed_mix";
      weights: InvestmentLabFixedMixWeights;
      contributionServiceDate: string;
      kodexContributionPriceDate: string;
      vooContributionPriceDate: string;
      endServiceDate: string;
      contributionAmountKrw: number;
      allocation: Readonly<{
        kodexAmountKrw: number;
        vooAmountKrw: number;
        kodexUnits: number;
        vooUnits: number;
        kodexEndValueKrw: number;
        vooEndValueKrw: number;
      }>;
      baseEndValueKrw: number;
      additionalEndValueKrw: number;
      projectedEndValueKrw: number;
      additionalProfitKrw: number;
      additionalReturn: number;
      rows: readonly InvestmentLabFixedMixContributionRow[];
      blockers: readonly [];
    }>
  | Readonly<{
      status: "blocked";
      policy: typeof INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY;
      scenarioId: "fixed_mix";
      weights: InvestmentLabFixedMixWeights | null;
      contributionServiceDate: null;
      kodexContributionPriceDate: null;
      vooContributionPriceDate: null;
      endServiceDate: null;
      contributionAmountKrw: null;
      allocation: null;
      baseEndValueKrw: null;
      additionalEndValueKrw: null;
      projectedEndValueKrw: null;
      additionalProfitKrw: null;
      additionalReturn: null;
      rows: readonly [];
      blockers: readonly InvestmentLabFixedMixContributionBlocker[];
    }>;
