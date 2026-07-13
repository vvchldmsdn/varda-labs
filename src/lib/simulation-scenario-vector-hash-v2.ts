import { createHash } from "node:crypto";

import {
  SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION,
  compareSimulationScenarioVectorHashV2Rows,
} from "./simulation-scenario-vector-hash-v2-policy.ts";
import type {
  SimulationScenarioVectorHashV2HashableResult,
  SimulationScenarioVectorHashV2InputRow,
  SimulationScenarioVectorHashV2InvalidResult,
  SimulationScenarioVectorHashV2Result,
} from "./simulation-scenario-vector-hash-v2-types.ts";
import { validateSimulationScenarioVectorHashV2Input } from "./simulation-scenario-vector-hash-v2-validation.ts";

export type {
  SimulationScenarioVectorHashV2Blocker,
  SimulationScenarioVectorHashV2HashableResult,
  SimulationScenarioVectorHashV2Input,
  SimulationScenarioVectorHashV2InputRow,
  SimulationScenarioVectorHashV2InvalidResult,
  SimulationScenarioVectorHashV2Result,
} from "./simulation-scenario-vector-hash-v2-types.ts";

export function createSimulationScenarioVectorHashV2(
  input: unknown,
): SimulationScenarioVectorHashV2Result {
  const validation = validateSimulationScenarioVectorHashV2Input(input);
  if (validation.status === "invalid") {
    return Object.freeze({
      status: "invalid",
      hashVersion: SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION,
      blockers: validation.blockers,
      rowCount: validation.rowCount,
      zeroWeightRowCount: validation.zeroWeightRowCount,
      totalWeightBps: validation.totalWeightBps,
      canonicalSerialization: null,
      scenarioVectorHash: null,
    }) satisfies SimulationScenarioVectorHashV2InvalidResult;
  }

  const canonicalSerialization = createCanonicalSerialization(
    validation.scenarioId,
    validation.scenarioVersion,
    validation.rows,
  );
  const scenarioVectorHash = `sha256:${createHash("sha256")
    .update(canonicalSerialization, "utf8")
    .digest("hex")}`;

  return Object.freeze({
    status: "hashable",
    hashVersion: SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION,
    portfolioPathPolicyId:
      SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID,
    gate0ApprovalCommit:
      SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT,
    scenarioId: validation.scenarioId,
    scenarioVersion: validation.scenarioVersion,
    rowCount: validation.rowCount,
    zeroWeightRowCount: validation.zeroWeightRowCount,
    totalWeightBps:
      SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS,
    canonicalSerialization,
    scenarioVectorHash,
  }) satisfies SimulationScenarioVectorHashV2HashableResult;
}

function createCanonicalSerialization(
  scenarioId: string,
  scenarioVersion: string,
  rows: readonly SimulationScenarioVectorHashV2InputRow[],
) {
  const sortedRows = new Array<SimulationScenarioVectorHashV2InputRow>(
    rows.length,
  );
  for (let index = 0; index < rows.length; index += 1) {
    sortedRows[index] = rows[index];
  }
  Array.prototype.sort.call(
    sortedRows,
    compareSimulationScenarioVectorHashV2Rows,
  );

  const canonicalVector = new Array<Readonly<Record<string, unknown>>>(
    sortedRows.length,
  );
  for (let index = 0; index < sortedRows.length; index += 1) {
    const row = sortedRows[index];
    const canonicalRow: Record<string, unknown> = Object.create(null);
    canonicalRow.market = row.market;
    canonicalRow.currency = row.currency;
    canonicalRow.ticker = row.ticker;
    canonicalRow.weightBps = row.weightBps;
    canonicalVector[index] = Object.freeze(canonicalRow);
  }
  Object.defineProperty(canonicalVector, "toJSON", {
    value: undefined,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.freeze(canonicalVector);

  const canonicalRoot: Record<string, unknown> = Object.create(null);
  canonicalRoot.hashVersion = SIMULATION_SCENARIO_VECTOR_HASH_V2_VERSION;
  canonicalRoot.portfolioPathPolicyId =
    SIMULATION_SCENARIO_VECTOR_HASH_V2_PORTFOLIO_PATH_POLICY_ID;
  canonicalRoot.gate0ApprovalCommit =
    SIMULATION_SCENARIO_VECTOR_HASH_V2_GATE0_APPROVAL_COMMIT;
  canonicalRoot.scenarioId = scenarioId;
  canonicalRoot.scenarioVersion = scenarioVersion;
  canonicalRoot.vector = canonicalVector;
  Object.freeze(canonicalRoot);

  const serialized = JSON.stringify(canonicalRoot);
  if (typeof serialized !== "string") {
    throw new TypeError("V2 canonical serialization did not produce a string");
  }
  return serialized;
}
