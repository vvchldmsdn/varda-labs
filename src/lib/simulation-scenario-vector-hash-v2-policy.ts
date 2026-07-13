export const SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION =
  "simulation_scenario_vector_hash_v2" as const;

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID =
  "gross_normalized_buy_and_hold_v1" as const;

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT =
  "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e" as const;

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_MAX_VECTOR_ROWS = 64;
export const SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS =
  10_000;

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_SCENARIO_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const SIMULATION_SCENARIO_VECTOR_HASH_V2_MARKET_PATTERN =
  /^[a-z][a-z0-9._:-]{0,19}$/;
export const SIMULATION_SCENARIO_VECTOR_HASH_V2_CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const SIMULATION_SCENARIO_VECTOR_HASH_V2_TICKER_PATTERN =
  /^[A-Z0-9][A-Z0-9._:-]{0,49}$/;

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_BLOCKER_ORDER = Object.freeze([
  "invalid_input_shape",
  "invalid_scenario_id",
  "invalid_scenario_version",
  "source_vector_empty",
  "source_vector_row_cap_exceeded",
  "invalid_instrument_identity",
  "duplicate_instrument_identity",
  "invalid_weight_bps",
  "source_vector_total_not_10000_bps",
] as const);

type ComparableSimulationScenarioVectorHashV2Row = Readonly<{
  market: string;
  currency: string;
  ticker: string;
}>;

export function compareSimulationScenarioVectorHashV2Rows(
  left: ComparableSimulationScenarioVectorHashV2Row,
  right: ComparableSimulationScenarioVectorHashV2Row,
) {
  return (
    compareAscii(left.market, right.market) ||
    compareAscii(left.currency, right.currency) ||
    compareAscii(left.ticker, right.ticker)
  );
}

function compareAscii(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
