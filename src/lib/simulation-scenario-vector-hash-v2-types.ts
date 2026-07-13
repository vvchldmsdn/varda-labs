export type SimulationScenarioVectorHashV2InputRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export type SimulationScenarioVectorHashV2Input = Readonly<{
  scenarioId: string;
  scenarioVersion: string;
  vector: readonly SimulationScenarioVectorHashV2InputRow[];
}>;

export type SimulationScenarioVectorHashV2Blocker =
  | "invalid_input_shape"
  | "invalid_scenario_id"
  | "invalid_scenario_version"
  | "source_vector_empty"
  | "source_vector_row_cap_exceeded"
  | "invalid_instrument_identity"
  | "duplicate_instrument_identity"
  | "invalid_weight_bps"
  | "source_vector_total_not_10000_bps";

export type SimulationScenarioVectorHashV2HashableResult = Readonly<{
  status: "hashable";
  hashVersion: "simulation_scenario_vector_hash_v2";
  portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1";
  gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e";
  scenarioId: string;
  scenarioVersion: string;
  rowCount: number;
  zeroWeightRowCount: number;
  totalWeightBps: 10_000;
  canonicalSerialization: string;
  scenarioVectorHash: string;
}>;

export type SimulationScenarioVectorHashV2InvalidResult = Readonly<{
  status: "invalid";
  hashVersion: "simulation_scenario_vector_hash_v2";
  blockers: readonly SimulationScenarioVectorHashV2Blocker[];
  rowCount: number | null;
  zeroWeightRowCount: number | null;
  totalWeightBps: number | null;
  canonicalSerialization: null;
  scenarioVectorHash: null;
}>;

export type SimulationScenarioVectorHashV2Result =
  | SimulationScenarioVectorHashV2HashableResult
  | SimulationScenarioVectorHashV2InvalidResult;
