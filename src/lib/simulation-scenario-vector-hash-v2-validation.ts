import {
  SIMULATION_SCENARIO_VECTOR_HASH_V2_BLOCKER_ORDER,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_CURRENCY_PATTERN,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_MARKET_PATTERN,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_MAX_VECTOR_ROWS,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_SCENARIO_PATTERN,
  SIMULATION_SCENARIO_VECTOR_HASH_V2_TICKER_PATTERN,
} from "./simulation-scenario-vector-hash-v2-policy.ts";
import type {
  SimulationScenarioVectorHashV2Blocker,
  SimulationScenarioVectorHashV2InputRow,
} from "./simulation-scenario-vector-hash-v2-types.ts";

const OUTER_FIELDS = Object.freeze([
  "scenarioId",
  "scenarioVersion",
  "vector",
] as const);
const ROW_FIELDS = Object.freeze([
  "market",
  "currency",
  "ticker",
  "weightBps",
] as const);

type ValidatedInput = Readonly<{
  status: "valid";
  scenarioId: string;
  scenarioVersion: string;
  rows: readonly SimulationScenarioVectorHashV2InputRow[];
  rowCount: number;
  zeroWeightRowCount: number;
  totalWeightBps: 10_000;
}>;

type InvalidInput = Readonly<{
  status: "invalid";
  blockers: readonly SimulationScenarioVectorHashV2Blocker[];
  rowCount: number | null;
  zeroWeightRowCount: number | null;
  totalWeightBps: number | null;
}>;

export type SimulationScenarioVectorHashV2ValidationResult =
  | ValidatedInput
  | InvalidInput;

type ExactRecordSnapshot = Readonly<Record<string, unknown>>;

type VectorSnapshotResult =
  | Readonly<{ status: "valid"; values: readonly unknown[]; rowCount: number }>
  | Readonly<{ status: "invalid_shape"; rowCount: number | null }>
  | Readonly<{ status: "row_cap_exceeded" }>;

export function validateSimulationScenarioVectorHashV2Input(
  input: unknown,
): SimulationScenarioVectorHashV2ValidationResult {
  const outer = snapshotExactRecord(input, OUTER_FIELDS);
  if (!outer) {
    return invalidResult(["invalid_input_shape"], null, null, null);
  }

  const blockers = new Set<SimulationScenarioVectorHashV2Blocker>();
  if (!isValidScenarioDescriptor(outer.scenarioId)) {
    blockers.add("invalid_scenario_id");
  }
  if (!isValidScenarioDescriptor(outer.scenarioVersion)) {
    blockers.add("invalid_scenario_version");
  }

  const vector = snapshotDenseOrdinaryArray(outer.vector);
  if (vector.status === "row_cap_exceeded") {
    blockers.add("source_vector_row_cap_exceeded");
    return invalidResult(blockers, null, null, null);
  }
  if (vector.status === "invalid_shape") {
    blockers.add("invalid_input_shape");
    return invalidResult(blockers, vector.rowCount, null, null);
  }

  const { rowCount } = vector;
  if (rowCount === 0) blockers.add("source_vector_empty");

  const rows: SimulationScenarioVectorHashV2InputRow[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = snapshotExactRecord(vector.values[index], ROW_FIELDS);
    if (!row) {
      blockers.add("invalid_input_shape");
      return invalidResult(blockers, rowCount, null, null);
    }
    rows.push(
      Object.freeze({
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
        weightBps: row.weightBps,
      }) as SimulationScenarioVectorHashV2InputRow,
    );
  }

  let hasInvalidIdentity = false;
  let hasDuplicateIdentity = false;
  const identities = new Set<string>();
  for (const row of rows) {
    if (!isValidInstrumentIdentity(row)) {
      hasInvalidIdentity = true;
      continue;
    }
    const identity = `${row.market}\u0000${row.currency}\u0000${row.ticker}`;
    if (identities.has(identity)) hasDuplicateIdentity = true;
    identities.add(identity);
  }
  if (hasInvalidIdentity) blockers.add("invalid_instrument_identity");
  if (hasDuplicateIdentity) blockers.add("duplicate_instrument_identity");

  let hasInvalidWeight = false;
  let totalWeightBps = 0;
  let zeroWeightRowCount = 0;
  for (const row of rows) {
    if (!isValidWeight(row.weightBps)) {
      hasInvalidWeight = true;
      continue;
    }
    totalWeightBps += row.weightBps;
    if (row.weightBps === 0) zeroWeightRowCount += 1;
  }

  if (hasInvalidWeight) {
    blockers.add("invalid_weight_bps");
  } else if (
    totalWeightBps !==
    SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS
  ) {
    blockers.add("source_vector_total_not_10000_bps");
  }

  if (blockers.size > 0) {
    return invalidResult(
      blockers,
      rowCount,
      hasInvalidWeight ? null : zeroWeightRowCount,
      hasInvalidWeight ? null : totalWeightBps,
    );
  }

  return Object.freeze({
    status: "valid",
    scenarioId: outer.scenarioId as string,
    scenarioVersion: outer.scenarioVersion as string,
    rows: Object.freeze(rows),
    rowCount,
    zeroWeightRowCount,
    totalWeightBps:
      SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS,
  });
}

function snapshotExactRecord(
  value: unknown,
  fields: readonly string[],
): ExactRecordSnapshot | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return null;
    }

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== fields.length ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          !fields.includes(key),
      )
    ) {
      return null;
    }

    const snapshot: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return null;
      }
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotDenseOrdinaryArray(value: unknown): VectorSnapshotResult {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return Object.freeze({ status: "invalid_shape", rowCount: null });
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      !Object.hasOwn(lengthDescriptor, "value") ||
      !Number.isInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return Object.freeze({ status: "invalid_shape", rowCount: null });
    }
    const rowCount = lengthDescriptor.value as number;
    if (rowCount > SIMULATION_SCENARIO_VECTOR_HASH_V2_MAX_VECTOR_ROWS) {
      return Object.freeze({ status: "row_cap_exceeded" });
    }

    const keys = Reflect.ownKeys(value);
    if (keys.length !== rowCount + 1) {
      return Object.freeze({ status: "invalid_shape", rowCount });
    }
    const expectedKeys = new Set<string>(["length"]);
    for (let index = 0; index < rowCount; index += 1) {
      expectedKeys.add(String(index));
    }
    if (
      keys.some(
        (key) => typeof key !== "string" || !expectedKeys.has(key),
      )
    ) {
      return Object.freeze({ status: "invalid_shape", rowCount });
    }

    const values = new Array<unknown>(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true
      ) {
        return Object.freeze({ status: "invalid_shape", rowCount });
      }
      values[index] = descriptor.value;
    }
    return Object.freeze({
      status: "valid",
      values: Object.freeze(values),
      rowCount,
    });
  } catch {
    return Object.freeze({ status: "invalid_shape", rowCount: null });
  }
}

function isValidScenarioDescriptor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIMULATION_SCENARIO_VECTOR_HASH_V2_SCENARIO_PATTERN.test(value)
  );
}

function isValidInstrumentIdentity(
  row: SimulationScenarioVectorHashV2InputRow,
) {
  return (
    typeof row.market === "string" &&
    SIMULATION_SCENARIO_VECTOR_HASH_V2_MARKET_PATTERN.test(row.market) &&
    typeof row.currency === "string" &&
    SIMULATION_SCENARIO_VECTOR_HASH_V2_CURRENCY_PATTERN.test(row.currency) &&
    typeof row.ticker === "string" &&
    SIMULATION_SCENARIO_VECTOR_HASH_V2_TICKER_PATTERN.test(row.ticker)
  );
}

function isValidWeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0 &&
    value <= SIMULATION_SCENARIO_VECTOR_HASH_V2_REQUIRED_WEIGHT_TOTAL_BPS
  );
}

function invalidResult(
  blockers: Iterable<SimulationScenarioVectorHashV2Blocker>,
  rowCount: number | null,
  zeroWeightRowCount: number | null,
  totalWeightBps: number | null,
): InvalidInput {
  const blockerSet = new Set(blockers);
  const orderedBlockers = SIMULATION_SCENARIO_VECTOR_HASH_V2_BLOCKER_ORDER.filter(
    (blocker) => blockerSet.has(blocker),
  );
  return Object.freeze({
    status: "invalid",
    blockers: Object.freeze(orderedBlockers),
    rowCount,
    zeroWeightRowCount,
    totalWeightBps,
  });
}
