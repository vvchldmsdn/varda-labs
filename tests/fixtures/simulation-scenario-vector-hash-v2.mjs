export const SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_CANONICAL_JSON =
  '{"hashVersion":"simulation_scenario_vector_hash_v2","portfolioPathPolicyId":"gross_normalized_buy_and_hold_v1","gate0ApprovalCommit":"652b9ea9c9b48f51dc4c68e8f148132ca8893d7e","scenarioId":"synthetic-punctuation-order","scenarioVersion":"v2-fixture-1","vector":[{"market":"us","currency":"USD","ticker":"A.B","weightBps":5000},{"market":"us","currency":"USD","ticker":"A:B","weightBps":5000}]}';

export const SIMULATION_SCENARIO_VECTOR_HASH_V2_PINNED_DIGEST =
  "sha256:80282313cbdf944335ad0136fe9fa7120bacd8e95dcc159fd8472f215d9aabc1";

export function createSimulationScenarioVectorHashV2PunctuationInput() {
  return {
    scenarioId: "synthetic-punctuation-order",
    scenarioVersion: "v2-fixture-1",
    vector: [
      { market: "us", currency: "USD", ticker: "A:B", weightBps: 5_000 },
      { market: "us", currency: "USD", ticker: "A.B", weightBps: 5_000 },
    ],
  };
}
