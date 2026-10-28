import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";
import {
  SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER,
  SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY,
} from "./simulation-spaghetti-path-sampling-policy.ts";
import type {
  SimulationSpaghettiPathSampleBlocker,
  SimulationSpaghettiPathSampleBlockerReason,
  SimulationSpaghettiPathSampleInput,
  SimulationSpaghettiPathSampleValidationResult,
  ValidatedSimulationSpaghettiPathSampleInput,
} from "./simulation-spaghetti-path-sampling-types.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DESCRIPTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const NORMALIZED_NAV_RESULT_KEYS = [
  "calculationStatus",
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
  "totalNavCells",
  "paths",
  "blockers",
];

type ValidatedCounts = Readonly<{
  horizon: number;
  pathCount: number;
  totalInputPointCount: number;
}>;

export function validateSimulationSpaghettiPathSampleInput(
  input: SimulationSpaghettiPathSampleInput,
): SimulationSpaghettiPathSampleValidationResult {
  const reasons = new Set<SimulationSpaghettiPathSampleBlockerReason>();
  const normalizedNav: unknown = input?.normalizedNav;
  const expectedBinding: unknown = input?.expectedBinding;
  const requestedSampleCount: unknown = input?.sampleCount;
  const validatedBinding = validateExpectedBinding(expectedBinding, reasons);
  const sampleCount = validateSampleCount(requestedSampleCount, reasons);

  if (
    sampleCount !== null &&
    sampleCount > SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxSelectedPaths
  ) {
    reasons.add("sample_count_exceeds_limit");
  }

  if (!isRecord(normalizedNav)) {
    reasons.add("input_nav_not_ready");
    reasons.add("input_nav_shape_invalid");
    return blocked(reasons);
  }

  if (!hasRequiredKeys(normalizedNav, NORMALIZED_NAV_RESULT_KEYS)) {
    reasons.add("input_nav_not_ready");
    reasons.add("input_nav_shape_invalid");
    return blocked(reasons);
  }

  if (
    normalizedNav.calculationStatus !== "ready" ||
    !Array.isArray(normalizedNav.blockers) ||
    normalizedNav.blockers.length !== 0
  ) {
    reasons.add("input_nav_not_ready");
  }
  if (
    normalizedNav.runtimeTrustStatus !==
    SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.runtimeTrustStatus
  ) {
    reasons.add("input_nav_runtime_trust_invalid");
  }
  if (!isExactPolicy(normalizedNav.policy, SIMULATION_NORMALIZED_NAV_POLICY)) {
    reasons.add("input_nav_policy_mismatch");
  }

  if (validatedBinding) {
    compareHash(
      normalizedNav.scenarioVectorHash,
      validatedBinding.expectedScenarioVectorHash,
      "scenario_vector_hash_mismatch",
      reasons,
    );
    compareHash(
      normalizedNav.inputMatrixHash,
      validatedBinding.expectedInputMatrixHash,
      "input_matrix_hash_mismatch",
      reasons,
    );
    compareHash(
      normalizedNav.drawPlanHash,
      validatedBinding.expectedDrawPlanHash,
      "draw_plan_hash_mismatch",
      reasons,
    );
  }

  const counts = validateNormalizedNavShape(normalizedNav, reasons);
  const scenarioId = normalizedNav.scenarioId;
  const scenarioVersion = normalizedNav.scenarioVersion;
  if (
    typeof scenarioId !== "string" ||
    typeof scenarioVersion !== "string" ||
    !DESCRIPTOR_PATTERN.test(scenarioId) ||
    !DESCRIPTOR_PATTERN.test(scenarioVersion)
  ) {
    reasons.add("input_nav_shape_invalid");
  }

  let totalOutputPointCount: number | null = null;
  let selectedPathIndices: readonly number[] | null = null;
  if (sampleCount !== null && counts) {
    if (sampleCount > counts.pathCount) {
      reasons.add("sample_count_exceeds_path_count");
    }

    const calculatedOutputPointCount = sampleCount * (counts.horizon + 1);
    if (
      !Number.isSafeInteger(calculatedOutputPointCount) ||
      calculatedOutputPointCount >
        SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxOutputPoints
    ) {
      reasons.add("sample_output_too_large");
    } else {
      totalOutputPointCount = calculatedOutputPointCount;
    }

    if (
      reasons.size === 0 &&
      sampleCount <= counts.pathCount &&
      sampleCount <=
        SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxSelectedPaths &&
      totalOutputPointCount !== null
    ) {
      selectedPathIndices = selectCanonicalPathIndices(
        counts.pathCount,
        sampleCount,
      );
      if (!selectedPathIndices) reasons.add("invalid_selection");
    }
  }

  if (
    reasons.size > 0 ||
    !validatedBinding ||
    !counts ||
    sampleCount === null ||
    totalOutputPointCount === null ||
    !selectedPathIndices ||
    typeof scenarioId !== "string" ||
    typeof scenarioVersion !== "string" ||
    !isSha256(normalizedNav.scenarioVectorHash) ||
    !isSha256(normalizedNav.inputMatrixHash) ||
    !isSha256(normalizedNav.drawPlanHash)
  ) {
    return blocked(reasons);
  }

  return Object.freeze({
    validated: Object.freeze({
      normalizedNav:
        normalizedNav as ValidatedSimulationSpaghettiPathSampleInput["normalizedNav"],
      scenarioId,
      scenarioVersion,
      scenarioVectorHash: normalizedNav.scenarioVectorHash,
      inputMatrixHash: normalizedNav.inputMatrixHash,
      drawPlanHash: normalizedNav.drawPlanHash,
      horizon: counts.horizon,
      inputPathCount: counts.pathCount,
      sampleCount,
      totalInputPointCount: counts.totalInputPointCount,
      totalOutputPointCount,
      selectedPathIndices,
    }),
    blockers: Object.freeze([]),
  });
}

function validateExpectedBinding(
  value: unknown,
  reasons: Set<SimulationSpaghettiPathSampleBlockerReason>,
) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "expectedScenarioVectorHash",
      "expectedInputMatrixHash",
      "expectedDrawPlanHash",
    ]) ||
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

function validateSampleCount(
  value: unknown,
  reasons: Set<SimulationSpaghettiPathSampleBlockerReason>,
) {
  if (!isPositiveSafeInteger(value)) {
    reasons.add("sample_count_invalid");
    return null;
  }
  return value;
}

function compareHash(
  actual: unknown,
  expected: string,
  reason: Extract<
    SimulationSpaghettiPathSampleBlockerReason,
    | "scenario_vector_hash_mismatch"
    | "input_matrix_hash_mismatch"
    | "draw_plan_hash_mismatch"
  >,
  reasons: Set<SimulationSpaghettiPathSampleBlockerReason>,
) {
  if (!isSha256(actual) || actual !== expected) reasons.add(reason);
}

function validateNormalizedNavShape(
  normalizedNav: Record<string, unknown>,
  reasons: Set<SimulationSpaghettiPathSampleBlockerReason>,
): ValidatedCounts | null {
  let shapeInvalid = !hasExactKeys(
    normalizedNav,
    NORMALIZED_NAV_RESULT_KEYS,
  );
  let invalidNav = false;
  const horizon = normalizedNav.horizon;
  const pathCount = normalizedNav.pathCount;
  const totalPointCount = normalizedNav.totalPointCount;
  const totalNavCells = normalizedNav.totalNavCells;
  const paths = normalizedNav.paths;

  const dimensionsValid =
    isPositiveSafeInteger(horizon) && isPositiveSafeInteger(pathCount);
  if (!dimensionsValid) shapeInvalid = true;

  const calculatedPointCount = dimensionsValid
    ? pathCount * (horizon + 1)
    : Number.NaN;
  if (
    !Number.isSafeInteger(calculatedPointCount) ||
    totalPointCount !== calculatedPointCount ||
    totalNavCells !== calculatedPointCount
  ) {
    shapeInvalid = true;
  }
  if (
    Number.isSafeInteger(calculatedPointCount) &&
    calculatedPointCount >
      SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxInputNavPoints
  ) {
    reasons.add("input_nav_too_large");
  }

  if (!Array.isArray(normalizedNav.blockers)) shapeInvalid = true;

  if (!Array.isArray(paths) || paths.length !== pathCount) {
    shapeInvalid = true;
  } else if (
    dimensionsValid &&
    Number.isSafeInteger(calculatedPointCount) &&
    calculatedPointCount <=
      SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxInputNavPoints
  ) {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths[pathIndex];
      if (
        !isRecord(path) ||
        !hasExactKeys(path, ["pathIndex", "points"]) ||
        path.pathIndex !== pathIndex ||
        !Array.isArray(path.points) ||
        path.points.length !== horizon + 1
      ) {
        shapeInvalid = true;
        continue;
      }

      for (let stepIndex = 0; stepIndex < path.points.length; stepIndex += 1) {
        const point = path.points[stepIndex];
        if (!isRecord(point) || point.stepIndex !== stepIndex) {
          shapeInvalid = true;
          continue;
        }
        if (
          typeof point.nav !== "number" ||
          !Number.isFinite(point.nav) ||
          point.nav <= 0 ||
          (stepIndex === 0 && point.nav !== 1)
        ) {
          invalidNav = true;
        }
      }
    }
  }

  if (shapeInvalid) reasons.add("input_nav_shape_invalid");
  if (invalidNav) reasons.add("invalid_nav");

  return Number.isSafeInteger(calculatedPointCount) && dimensionsValid
    ? Object.freeze({
        horizon,
        pathCount,
        totalInputPointCount: calculatedPointCount,
      })
    : null;
}

function selectCanonicalPathIndices(pathCount: number, sampleCount: number) {
  if (sampleCount === 1) {
    const selectedIndex = Math.floor((pathCount - 1) / 2);
    return isValidSelection([selectedIndex], pathCount, sampleCount)
      ? Object.freeze([selectedIndex])
      : null;
  }

  const selectedIndices: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const numerator = index * (pathCount - 1);
    const denominator = sampleCount - 1;
    const quotient = numerator / denominator;
    const selectedIndex = Math.floor(quotient);
    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      !Number.isFinite(quotient) ||
      !Number.isSafeInteger(selectedIndex)
    ) {
      return null;
    }
    selectedIndices.push(selectedIndex);
  }

  return isValidSelection(selectedIndices, pathCount, sampleCount)
    ? Object.freeze(selectedIndices)
    : null;
}

function isValidSelection(
  selectedIndices: readonly number[],
  pathCount: number,
  sampleCount: number,
) {
  if (selectedIndices.length !== sampleCount) return false;
  for (let index = 0; index < selectedIndices.length; index += 1) {
    const selectedIndex = selectedIndices[index];
    if (
      !Number.isSafeInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= pathCount ||
      (index > 0 && selectedIndex <= selectedIndices[index - 1])
    ) {
      return false;
    }
  }
  return (
    sampleCount === 1 ||
    (selectedIndices[0] === 0 &&
      selectedIndices[selectedIndices.length - 1] === pathCount - 1)
  );
}

function isExactPolicy(
  actual: unknown,
  expected: Readonly<Record<string, unknown>>,
) {
  if (!isRecord(actual)) return false;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
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
  return required.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
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
  reasons: ReadonlySet<SimulationSpaghettiPathSampleBlockerReason>,
): SimulationSpaghettiPathSampleValidationResult {
  return Object.freeze({
    validated: null,
    blockers: orderBlockers(reasons),
  });
}

function orderBlockers(
  reasons: ReadonlySet<SimulationSpaghettiPathSampleBlockerReason>,
): readonly SimulationSpaghettiPathSampleBlocker[] {
  return Object.freeze(
    SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER.filter((reason) =>
      reasons.has(reason),
    ).map((reason) => Object.freeze({ reason })),
  );
}
