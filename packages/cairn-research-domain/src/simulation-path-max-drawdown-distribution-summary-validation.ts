import {
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
} from "./simulation-path-max-drawdown-distribution-summary-policy.ts";
import type {
  SimulationPathMaxDrawdownDistributionSummaryBlocker,
  SimulationPathMaxDrawdownDistributionSummaryBlockerReason,
  SimulationPathMaxDrawdownDistributionSummaryInput,
  SimulationPathMaxDrawdownDistributionSummaryValidationResult,
} from "./simulation-path-max-drawdown-distribution-summary-types.ts";
import { SIMULATION_PATH_MAX_DRAWDOWN_POLICY } from "./simulation-path-max-drawdown-policy.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DESCRIPTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const INPUT_KEYS = ["pathMaxDrawdown", "expectedBinding"];
const PATH_MAX_DRAWDOWN_RESULT_KEYS = [
  "drawdownStatus",
  "runtimeTrustStatus",
  "policy",
  "scenarioId",
  "scenarioVersion",
  "scenarioVectorHash",
  "inputMatrixHash",
  "drawPlanHash",
  "horizon",
  "pathCount",
  "totalPointCount",
  "pathDrawdowns",
  "blockers",
];
const EXPECTED_BINDING_KEYS = [
  "expectedScenarioVectorHash",
  "expectedInputMatrixHash",
  "expectedDrawPlanHash",
];
const PATH_DRAWDOWN_ROW_KEYS = ["pathIndex", "maxDrawdown"];

export function validateSimulationPathMaxDrawdownDistributionSummaryInput(
  input: SimulationPathMaxDrawdownDistributionSummaryInput,
): SimulationPathMaxDrawdownDistributionSummaryValidationResult {
  const reasons = new Set<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>();
  const wrapper: unknown = input;

  if (!isRecord(wrapper)) {
    reasons.add("input_drawdown_not_ready");
    reasons.add("expected_binding_invalid");
    reasons.add("input_drawdown_shape_invalid");
    return blocked(reasons);
  }

  const wrapperKeys = new Set(Object.keys(wrapper));
  if (!hasExactKeys(wrapper, INPUT_KEYS)) {
    reasons.add("input_drawdown_shape_invalid");
  }

  const pathMaxDrawdown = readDeclaredValue(
    wrapper,
    wrapperKeys,
    "pathMaxDrawdown",
  );
  const expectedBinding = readDeclaredValue(
    wrapper,
    wrapperKeys,
    "expectedBinding",
  );
  const validatedBinding = validateExpectedBinding(expectedBinding, reasons);

  if (!isRecord(pathMaxDrawdown)) {
    reasons.add("input_drawdown_not_ready");
    reasons.add("input_drawdown_shape_invalid");
    return blocked(reasons);
  }

  if (!hasRequiredKeys(pathMaxDrawdown, PATH_MAX_DRAWDOWN_RESULT_KEYS)) {
    reasons.add("input_drawdown_not_ready");
    reasons.add("input_drawdown_shape_invalid");
    return blocked(reasons);
  }

  const artifactHasExactKeys = hasExactKeys(
    pathMaxDrawdown,
    PATH_MAX_DRAWDOWN_RESULT_KEYS,
  );
  const artifact = snapshotOwnEnumerableValues(
    pathMaxDrawdown,
    PATH_MAX_DRAWDOWN_RESULT_KEYS,
  );
  if (!artifact) {
    reasons.add("input_drawdown_not_ready");
    reasons.add("input_drawdown_shape_invalid");
    return blocked(reasons);
  }

  const inputBlockerCount = readArrayLength(artifact.blockers);

  if (
    artifact.drawdownStatus !== "ready" ||
    inputBlockerCount === null ||
    inputBlockerCount !== 0
  ) {
    reasons.add("input_drawdown_not_ready");
  }
  if (
    artifact.runtimeTrustStatus !==
    SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus
  ) {
    reasons.add("input_drawdown_runtime_trust_invalid");
  }
  if (
    !isExactPolicy(
      artifact.policy,
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
    )
  ) {
    reasons.add("input_drawdown_policy_mismatch");
  }

  if (validatedBinding) {
    compareHash(
      artifact.scenarioVectorHash,
      validatedBinding.expectedScenarioVectorHash,
      "scenario_vector_hash_mismatch",
      reasons,
    );
    compareHash(
      artifact.inputMatrixHash,
      validatedBinding.expectedInputMatrixHash,
      "input_matrix_hash_mismatch",
      reasons,
    );
    compareHash(
      artifact.drawPlanHash,
      validatedBinding.expectedDrawPlanHash,
      "draw_plan_hash_mismatch",
      reasons,
    );
  }

  const shape = validatePathMaxDrawdownShape(
    artifact,
    artifactHasExactKeys,
    inputBlockerCount,
    reasons,
  );
  const scenarioId = artifact.scenarioId;
  const scenarioVersion = artifact.scenarioVersion;
  if (
    typeof scenarioId !== "string" ||
    typeof scenarioVersion !== "string" ||
    !DESCRIPTOR_PATTERN.test(scenarioId) ||
    !DESCRIPTOR_PATTERN.test(scenarioVersion)
  ) {
    reasons.add("input_drawdown_shape_invalid");
  }

  if (
    reasons.size > 0 ||
    !validatedBinding ||
    !shape ||
    typeof scenarioId !== "string" ||
    typeof scenarioVersion !== "string" ||
    !isSha256(artifact.scenarioVectorHash) ||
    !isSha256(artifact.inputMatrixHash) ||
    !isSha256(artifact.drawPlanHash)
  ) {
    return blocked(reasons);
  }

  return Object.freeze({
    validated: Object.freeze({
      scenarioId,
      scenarioVersion,
      scenarioVectorHash: artifact.scenarioVectorHash,
      inputMatrixHash: artifact.inputMatrixHash,
      drawPlanHash: artifact.drawPlanHash,
      horizon: shape.horizon,
      pathCount: shape.pathCount,
      totalPointCount: shape.totalPointCount,
      drawdownValues: shape.drawdownValues,
    }),
    blockers: Object.freeze([]),
  });
}

function validateExpectedBinding(
  value: unknown,
  reasons: Set<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
) {
  if (!isRecord(value) || !hasExactKeys(value, EXPECTED_BINDING_KEYS)) {
    reasons.add("expected_binding_invalid");
    return null;
  }

  const binding = snapshotOwnEnumerableValues(value, EXPECTED_BINDING_KEYS);
  if (
    !binding ||
    !isSha256(binding.expectedScenarioVectorHash) ||
    !isSha256(binding.expectedInputMatrixHash) ||
    !isSha256(binding.expectedDrawPlanHash)
  ) {
    reasons.add("expected_binding_invalid");
    return null;
  }

  return Object.freeze({
    expectedScenarioVectorHash: binding.expectedScenarioVectorHash,
    expectedInputMatrixHash: binding.expectedInputMatrixHash,
    expectedDrawPlanHash: binding.expectedDrawPlanHash,
  });
}

function compareHash(
  actual: unknown,
  expected: string,
  reason: Extract<
    SimulationPathMaxDrawdownDistributionSummaryBlockerReason,
    | "scenario_vector_hash_mismatch"
    | "input_matrix_hash_mismatch"
    | "draw_plan_hash_mismatch"
  >,
  reasons: Set<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
) {
  if (!isSha256(actual) || actual !== expected) reasons.add(reason);
}

function validatePathMaxDrawdownShape(
  pathMaxDrawdown: Record<string, unknown>,
  artifactHasExactKeys: boolean,
  inputBlockerCount: number | null,
  reasons: Set<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
): {
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  drawdownValues: number[];
} | null {
  let shapeInvalid = !artifactHasExactKeys;
  let invalidDrawdown = false;
  const horizon = pathMaxDrawdown.horizon;
  const pathCount = pathMaxDrawdown.pathCount;
  const totalPointCount = pathMaxDrawdown.totalPointCount;
  const pathDrawdowns = pathMaxDrawdown.pathDrawdowns;

  const validHorizon = isPositiveSafeInteger(horizon);
  const validPathCount = isPositiveSafeInteger(pathCount);
  if (!validHorizon || !validPathCount) shapeInvalid = true;

  const calculatedPointCount =
    validHorizon && validPathCount ? pathCount * (horizon + 1) : Number.NaN;
  if (
    !Number.isSafeInteger(calculatedPointCount) ||
    totalPointCount !== calculatedPointCount
  ) {
    shapeInvalid = true;
  }

  const tooLarge =
    (validPathCount &&
      pathCount >
        SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.maxInputPathDrawdownRows) ||
    (Number.isSafeInteger(calculatedPointCount) &&
      calculatedPointCount >
        SIMULATION_PATH_MAX_DRAWDOWN_POLICY.maxInputNavPoints);
  if (tooLarge) reasons.add("input_drawdown_too_large");

  if (inputBlockerCount === null) shapeInvalid = true;
  const pathDrawdownCount = readArrayLength(pathDrawdowns);
  if (pathDrawdownCount === null || pathDrawdownCount !== pathCount) {
    shapeInvalid = true;
  }

  let drawdownValues: number[] | null = null;
  if (
    Array.isArray(pathDrawdowns) &&
    pathDrawdownCount !== null &&
    pathDrawdownCount === pathCount &&
    validHorizon &&
    validPathCount &&
    Number.isSafeInteger(calculatedPointCount) &&
    !tooLarge
  ) {
    drawdownValues = new Array<number>(pathCount);
    for (let pathIndex = 0; pathIndex < pathDrawdownCount; pathIndex += 1) {
      const row = readArrayValue(pathDrawdowns, pathIndex);
      if (
        !isRecord(row) ||
        !hasExactKeys(row, PATH_DRAWDOWN_ROW_KEYS)
      ) {
        shapeInvalid = true;
        continue;
      }

      const rowSnapshot = snapshotOwnEnumerableValues(
        row,
        PATH_DRAWDOWN_ROW_KEYS,
      );
      if (!rowSnapshot) {
        shapeInvalid = true;
        continue;
      }

      const rowPathIndex = rowSnapshot.pathIndex;
      const maxDrawdown = rowSnapshot.maxDrawdown;
      if (rowPathIndex !== pathIndex) shapeInvalid = true;
      if (
        typeof maxDrawdown !== "number" ||
        !Number.isFinite(maxDrawdown) ||
        maxDrawdown < 0 ||
        maxDrawdown >= 1 ||
        Object.is(maxDrawdown, -0)
      ) {
        invalidDrawdown = true;
        continue;
      }
      drawdownValues[pathIndex] = maxDrawdown;
    }
  }

  if (shapeInvalid) reasons.add("input_drawdown_shape_invalid");
  if (invalidDrawdown) reasons.add("invalid_drawdown");

  if (
    shapeInvalid ||
    invalidDrawdown ||
    tooLarge ||
    !drawdownValues ||
    !Number.isSafeInteger(calculatedPointCount)
  ) {
    return null;
  }

  return {
    horizon: horizon as number,
    pathCount: pathCount as number,
    totalPointCount: calculatedPointCount,
    drawdownValues,
  };
}

function isExactPolicy(
  actual: unknown,
  expected: Readonly<Record<string, unknown>>,
) {
  try {
    if (!isRecord(actual)) return false;
    const expectedKeys = Object.keys(expected);
    if (!hasExactKeys(actual, expectedKeys)) return false;
    const policy = snapshotOwnEnumerableValues(actual, expectedKeys);
    return (
      policy !== null &&
      expectedKeys.every((key) => policy[key] === expected[key])
    );
  } catch {
    return false;
  }
}

function readDeclaredValue(
  value: Record<string, unknown>,
  enumerableKeys: ReadonlySet<string>,
  key: string,
) {
  if (!enumerableKeys.has(key)) return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function snapshotOwnEnumerableValues(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const snapshot: Record<string, unknown> = {};
  try {
    for (const key of keys) snapshot[key] = value[key];
  } catch {
    return null;
  }
  return snapshot;
}

function readArrayLength(value: unknown) {
  if (!Array.isArray(value)) return null;
  try {
    const length = value.length;
    return Number.isSafeInteger(length) ? length : null;
  } catch {
    return null;
  }
}

function readArrayValue(value: unknown[], index: number) {
  try {
    return value[index];
  } catch {
    return undefined;
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function hasRequiredKeys(value: Record<string, unknown>, required: string[]) {
  const actual = new Set(Object.keys(value));
  return required.every((key) => actual.has(key));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blocked(
  reasons: ReadonlySet<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
): SimulationPathMaxDrawdownDistributionSummaryValidationResult {
  return Object.freeze({
    validated: null,
    blockers: orderBlockers(reasons),
  });
}

function orderBlockers(
  reasons: ReadonlySet<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
): readonly SimulationPathMaxDrawdownDistributionSummaryBlocker[] {
  return Object.freeze(
    SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER.filter(
      (reason) => reasons.has(reason),
    ).map((reason) => Object.freeze({ reason })),
  );
}
