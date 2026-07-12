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

  const pathMaxDrawdown = wrapperKeys.has("pathMaxDrawdown")
    ? wrapper.pathMaxDrawdown
    : undefined;
  const expectedBinding = wrapperKeys.has("expectedBinding")
    ? wrapper.expectedBinding
    : undefined;
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

  if (
    pathMaxDrawdown.drawdownStatus !== "ready" ||
    !Array.isArray(pathMaxDrawdown.blockers) ||
    pathMaxDrawdown.blockers.length !== 0
  ) {
    reasons.add("input_drawdown_not_ready");
  }
  if (
    pathMaxDrawdown.runtimeTrustStatus !==
    SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus
  ) {
    reasons.add("input_drawdown_runtime_trust_invalid");
  }
  if (
    !isExactPolicy(
      pathMaxDrawdown.policy,
      SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
    )
  ) {
    reasons.add("input_drawdown_policy_mismatch");
  }

  if (validatedBinding) {
    compareHash(
      pathMaxDrawdown.scenarioVectorHash,
      validatedBinding.expectedScenarioVectorHash,
      "scenario_vector_hash_mismatch",
      reasons,
    );
    compareHash(
      pathMaxDrawdown.inputMatrixHash,
      validatedBinding.expectedInputMatrixHash,
      "input_matrix_hash_mismatch",
      reasons,
    );
    compareHash(
      pathMaxDrawdown.drawPlanHash,
      validatedBinding.expectedDrawPlanHash,
      "draw_plan_hash_mismatch",
      reasons,
    );
  }

  const shape = validatePathMaxDrawdownShape(pathMaxDrawdown, reasons);
  const scenarioId = pathMaxDrawdown.scenarioId;
  const scenarioVersion = pathMaxDrawdown.scenarioVersion;
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
    !isSha256(pathMaxDrawdown.scenarioVectorHash) ||
    !isSha256(pathMaxDrawdown.inputMatrixHash) ||
    !isSha256(pathMaxDrawdown.drawPlanHash)
  ) {
    return blocked(reasons);
  }

  return Object.freeze({
    validated: Object.freeze({
      scenarioId,
      scenarioVersion,
      scenarioVectorHash: pathMaxDrawdown.scenarioVectorHash,
      inputMatrixHash: pathMaxDrawdown.inputMatrixHash,
      drawPlanHash: pathMaxDrawdown.drawPlanHash,
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
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EXPECTED_BINDING_KEYS) ||
    !isSha256(value.expectedScenarioVectorHash) ||
    !isSha256(value.expectedInputMatrixHash) ||
    !isSha256(value.expectedDrawPlanHash)
  ) {
    reasons.add("expected_binding_invalid");
    return null;
  }

  return Object.freeze({
    expectedScenarioVectorHash: value.expectedScenarioVectorHash,
    expectedInputMatrixHash: value.expectedInputMatrixHash,
    expectedDrawPlanHash: value.expectedDrawPlanHash,
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
  reasons: Set<SimulationPathMaxDrawdownDistributionSummaryBlockerReason>,
): {
  horizon: number;
  pathCount: number;
  totalPointCount: number;
  drawdownValues: number[];
} | null {
  let shapeInvalid = !hasExactKeys(
    pathMaxDrawdown,
    PATH_MAX_DRAWDOWN_RESULT_KEYS,
  );
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

  if (!Array.isArray(pathMaxDrawdown.blockers)) shapeInvalid = true;
  if (!Array.isArray(pathDrawdowns) || pathDrawdowns.length !== pathCount) {
    shapeInvalid = true;
  }

  let drawdownValues: number[] | null = null;
  if (
    Array.isArray(pathDrawdowns) &&
    pathDrawdowns.length === pathCount &&
    validHorizon &&
    validPathCount &&
    Number.isSafeInteger(calculatedPointCount) &&
    !tooLarge
  ) {
    drawdownValues = new Array<number>(pathCount);
    for (let pathIndex = 0; pathIndex < pathDrawdowns.length; pathIndex += 1) {
      const row = pathDrawdowns[pathIndex];
      if (
        !isRecord(row) ||
        !hasExactKeys(row, PATH_DRAWDOWN_ROW_KEYS)
      ) {
        shapeInvalid = true;
        continue;
      }

      const rowKeys = new Set(Object.keys(row));
      const rowPathIndex = rowKeys.has("pathIndex")
        ? row.pathIndex
        : undefined;
      const maxDrawdown = rowKeys.has("maxDrawdown")
        ? row.maxDrawdown
        : undefined;
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
  if (!isRecord(actual)) return false;
  const expectedKeys = Object.keys(expected);
  if (!hasExactKeys(actual, expectedKeys)) return false;
  return expectedKeys.every((key) => actual[key] === expected[key]);
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
