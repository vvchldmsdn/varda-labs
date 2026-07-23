import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";

export const SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY = Object.freeze({
  version: "simulation_research_universe_preflight_v1",
  queryParameter: "researchUniverse",
  rowFormat: "market:currency:ticker:weight_bps",
  maximumRowCount: 16,
  maximumQueryLength: 2_048,
  requiredWeightBps: 10_000,
  returnStepCount: 90,
  identity: "market_currency_ticker",
  providerCalls: "forbidden",
  databaseWrites: "forbidden",
  weightRenormalization: "forbidden",
  partialResultPolicy: "preserve_per_instrument_diagnostics",
  runtimeTrustStatus: "not_established",
  managedSleevePolicy: "excluded_by_policy",
  physicalCommodityPolicy: "manual_history_required",
} as const);

export type SimulationResearchUniverseSelectionIssue =
  | "repeated_query"
  | "query_too_long"
  | "empty_query"
  | "too_many_rows"
  | "invalid_row_format"
  | "invalid_market"
  | "invalid_currency"
  | "invalid_ticker"
  | "invalid_weight_bps"
  | "duplicate_instrument"
  | "weight_total_not_10000";

export type SimulationResearchUniverseInstrument = Readonly<{
  instrumentKey: string;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  weightBps: number;
  classification: PortfolioHoldingClassification;
}>;

export type SimulationResearchUniverseSelection =
  | Readonly<{
      status: "not_requested";
      rawValue: null;
      issues: readonly SimulationResearchUniverseSelectionIssue[];
      instruments: readonly SimulationResearchUniverseInstrument[];
      totalWeightBps: 0;
    }>
  | Readonly<{
      status: "invalid";
      rawValue: string | null;
      issues: readonly SimulationResearchUniverseSelectionIssue[];
      instruments: readonly SimulationResearchUniverseInstrument[];
      totalWeightBps: number;
    }>
  | Readonly<{
      status: "valid";
      rawValue: string;
      issues: readonly SimulationResearchUniverseSelectionIssue[];
      instruments: readonly SimulationResearchUniverseInstrument[];
      totalWeightBps: 10_000;
    }>;
