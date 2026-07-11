import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";

export const HISTORICAL_COUNTERFACTUAL_CONTRACT = Object.freeze({
  anchor: "first_observed_portfolio_snapshot",
  actualPath: "observed_total_market_value",
  scenarioPath: "same_dated_same_krw_trade_events",
  valuation: "adjusted_close_with_date_specific_fx",
  comparisonGrid: "actual_snapshot_dates",
  returnMetric: "cashflow_adjusted_time_weighted_return",
  preInceptionFill: "forbidden",
  lookAhead: "forbidden",
  missingEvidence: "fail_closed",
  persistence: "none",
} as const);

export const HISTORICAL_COUNTERFACTUAL_POLICY_GATES = Object.freeze([
  "closed_market_trade_execution",
  "long_only_scenario_insolvency",
] as const);

export const LEGACY_COUNTERFACTUAL_PARITY_REJECTIONS = Object.freeze([
  "current_holdings_backcast_as_historical_actual",
  "hypothetical_initial_amount_without_trade_replay",
  "synthetic_series_stitched_to_actual_continuation",
  "full_window_optimizer_presented_as_investable",
  "ticker_only_instrument_identity",
  "fixed_or_fallback_fx_rate",
  "silent_common_history_trimming",
] as const);

export type CounterfactualDateRangeEvidence = Readonly<{
  rowCount: number;
  distinctDates: number;
  startDate: string | null;
  endDate: string | null;
  duplicateDateGroups: number;
  invalidRows: number;
  reconciliationMismatchRows?: number;
}>;

export type CounterfactualTradeEvidence = Readonly<{
  rowCount: number;
  unresolvedAmountRows: number;
  unknownAccountRows: number;
  correctionRows: number;
}>;

export type CounterfactualScenarioEvidence = Readonly<{
  instrumentKey: string;
  currency: string;
  prices: CounterfactualDateRangeEvidence;
}>;

export type CounterfactualReadinessInput = Readonly<{
  account: string;
  snapshots: CounterfactualDateRangeEvidence;
  trades: CounterfactualTradeEvidence;
  scenario: CounterfactualScenarioEvidence;
  fx: CounterfactualDateRangeEvidence;
}>;

export type CounterfactualReadinessBlocker =
  | "insufficient_actual_snapshots"
  | "actual_snapshot_date_collision"
  | "invalid_actual_snapshot_values"
  | "actual_snapshot_reconciliation_mismatch"
  | "unresolved_trade_amounts"
  | "unknown_trade_account"
  | "event_correction_policy_required"
  | "insufficient_scenario_prices"
  | "scenario_price_date_collision"
  | "invalid_scenario_prices"
  | "scenario_price_coverage_gap"
  | "insufficient_fx_history"
  | "fx_date_collision"
  | "invalid_fx_rows"
  | "fx_coverage_gap";

export function assessInvestmentLabCounterfactualReadiness(
  input: CounterfactualReadinessInput,
) {
  const blockers: CounterfactualReadinessBlocker[] = [];
  const { snapshots, trades, scenario, fx } = input;

  if (
    snapshots.rowCount < 2 ||
    snapshots.distinctDates < 2 ||
    !isDate(snapshots.startDate) ||
    !isDate(snapshots.endDate)
  ) {
    blockers.push("insufficient_actual_snapshots");
  }
  if (snapshots.duplicateDateGroups > 0) {
    blockers.push("actual_snapshot_date_collision");
  }
  if (snapshots.invalidRows > 0) {
    blockers.push("invalid_actual_snapshot_values");
  }
  if ((snapshots.reconciliationMismatchRows ?? 0) > 0) {
    blockers.push("actual_snapshot_reconciliation_mismatch");
  }
  if (trades.unresolvedAmountRows > 0) {
    blockers.push("unresolved_trade_amounts");
  }
  if (trades.unknownAccountRows > 0) {
    blockers.push("unknown_trade_account");
  }
  if (trades.correctionRows > 0) {
    blockers.push("event_correction_policy_required");
  }

  if (
    scenario.prices.rowCount < 2 ||
    scenario.prices.distinctDates < 2 ||
    !isDate(scenario.prices.startDate) ||
    !isDate(scenario.prices.endDate)
  ) {
    blockers.push("insufficient_scenario_prices");
  }
  if (scenario.prices.duplicateDateGroups > 0) {
    blockers.push("scenario_price_date_collision");
  }
  if (scenario.prices.invalidRows > 0) {
    blockers.push("invalid_scenario_prices");
  }
  if (!coversServiceRange(scenario.prices, snapshots, MAX_PRICE_CARRY_DAYS)) {
    blockers.push("scenario_price_coverage_gap");
  }

  if (scenario.currency.toUpperCase() !== "KRW") {
    if (
      fx.rowCount < 2 ||
      fx.distinctDates < 2 ||
      !isDate(fx.startDate) ||
      !isDate(fx.endDate)
    ) {
      blockers.push("insufficient_fx_history");
    }
    if (fx.duplicateDateGroups > 0) blockers.push("fx_date_collision");
    if (fx.invalidRows > 0) blockers.push("invalid_fx_rows");
    if (!coversServiceRange(fx, snapshots, MAX_FX_CARRY_DAYS)) {
      blockers.push("fx_coverage_gap");
    }
  }

  return Object.freeze({
    contract: "investment_lab_historical_counterfactual_v1",
    account: input.account,
    instrumentKey: scenario.instrumentKey,
    status:
      blockers.length === 0 ? "ready_for_engine_fixture" : "blocked",
    blockers: Object.freeze(blockers),
    coverageBasis: "service_date_range_with_bounded_prior_carry",
    productionEngineReady: false,
    unresolvedPolicyGates: HISTORICAL_COUNTERFACTUAL_POLICY_GATES,
    providerCalls: 0,
    databaseWrites: 0,
    userFacingRouteEnabled: false,
  } as const);
}

function coversServiceRange(
  evidence: CounterfactualDateRangeEvidence,
  required: CounterfactualDateRangeEvidence,
  maxCarryDays: number,
) {
  if (
    !isDate(evidence.startDate) ||
    !isDate(evidence.endDate) ||
    !isDate(required.startDate) ||
    !isDate(required.endDate)
  ) {
    return false;
  }

  const firstServiceDate = mapRiskEvidenceDateToServiceDate(evidence.startDate);
  const lastServiceDate = mapRiskEvidenceDateToServiceDate(evidence.endDate);
  const trailingGap =
    lastServiceDate >= required.endDate
      ? 0
      : riskCalendarDayDistance(lastServiceDate, required.endDate);

  return (
    firstServiceDate <= required.startDate && trailingGap <= maxCarryDays
  );
}

function isDate(value: string | null): value is string {
  return typeof value === "string" && isRiskDate(value);
}

const MAX_PRICE_CARRY_DAYS = 7;
const MAX_FX_CARRY_DAYS = 3;
