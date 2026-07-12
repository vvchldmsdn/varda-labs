import { SIMULATION_NORMALIZED_NAV_POLICY } from "./simulation-normalized-nav-policy.ts";
import type { SimulationNormalizedNavResult } from "./simulation-normalized-nav-types.ts";
import {
  SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER,
  type SimulationPathRiskInputBlockerReason,
} from "./simulation-path-risk-input-policy.ts";

export type SimulationPathRiskInputBlocker = Readonly<{
  reason: SimulationPathRiskInputBlockerReason;
}>;

export type SimulationPathRiskExpectedBinding = Readonly<{
  expectedScenarioVectorHash: string;
  expectedInputMatrixHash: string;
  expectedDrawPlanHash: string;
}>;

export type SimulationPathRiskInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  expectedBinding: SimulationPathRiskExpectedBinding;
}>;

export type ValidatedSimulationPathRiskInput = Readonly<{
  normalizedNav: SimulationNormalizedNavResult;
  scenarioId: string;
  scenarioVersion: string;
  scenarioVectorHash: string;
  inputMatrixHash: string;
  drawPlanHash: string;
  horizon: number;
  pathCount: number;
  totalPointCount: number;
}>;

export type SimulationPathRiskInputValidationResult = Readonly<{
  validated: ValidatedSimulationPathRiskInput | null;
  blockers: readonly SimulationPathRiskInputBlocker[];
}>;

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
  totalPointCount: number;
}>;

export function validateSimulationPathRiskInput(
  input: SimulationPathRiskInput,
): SimulationPathRiskInputValidationResult {
  const reasons = new Set<SimulationPathRiskInputBlockerReason>();
  const normalizedNav: unknown = input?.normalizedNav;
  const expectedBinding: unknown = input?.expectedBinding;
  const validatedBinding = validateExpectedBinding(expectedBinding, reasons);

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
    SIMULATION_NORMALIZED_NAV_POLICY.runtimeTrustStatus
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

  if (
    reasons.size > 0 ||
    !validatedBinding ||
    !counts ||
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
      normalizedNav: normalizedNav as SimulationNormalizedNavResult,
      scenarioId,
      scenarioVersion,
      scenarioVectorHash: normalizedNav.scenarioVectorHash,
      inputMatrixHash: normalizedNav.inputMatrixHash,
      drawPlanHash: normalizedNav.drawPlanHash,
      horizon: counts.horizon,
      pathCount: counts.pathCount,
      totalPointCount: counts.totalPointCount,
    }),
    blockers: Object.freeze([]),
  });
}

function validateExpectedBinding(
  value: unknown,
  reasons: Set<SimulationPathRiskInputBlockerReason>,
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

function compareHash(
  actual: unknown,
  expected: string,
  reason: Extract<
    SimulationPathRiskInputBlockerReason,
    | "scenario_vector_hash_mismatch"
    | "input_matrix_hash_mismatch"
    | "draw_plan_hash_mismatch"
  >,
  reasons: Set<SimulationPathRiskInputBlockerReason>,
) {
  if (!isSha256(actual) || actual !== expected) reasons.add(reason);
}

function validateNormalizedNavShape(
  normalizedNav: Record<string, unknown>,
  reasons: Set<SimulationPathRiskInputBlockerReason>,
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
    calculatedPointCount > SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints
  ) {
    reasons.add("input_nav_too_large");
  }

  if (!Array.isArray(normalizedNav.blockers)) shapeInvalid = true;

  if (!Array.isArray(paths) || paths.length !== pathCount) {
    shapeInvalid = true;
  } else if (
    dimensionsValid &&
    Number.isSafeInteger(calculatedPointCount) &&
    calculatedPointCount <= SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints
  ) {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths[pathIndex];
      if (
        !isRecord(path) ||
        !hasExactPathKeys(path) ||
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
        totalPointCount: calculatedPointCount,
      })
    : null;
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

function hasExactPathKeys(value: Record<string, unknown>) {
  let ownKeyCount = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    ownKeyCount += 1;
    if (key !== "pathIndex" && key !== "points") return false;
  }
  return ownKeyCount === 2;
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
  reasons: ReadonlySet<SimulationPathRiskInputBlockerReason>,
): SimulationPathRiskInputValidationResult {
  return Object.freeze({
    validated: null,
    blockers: orderBlockers(reasons),
  });
}

function orderBlockers(
  reasons: ReadonlySet<SimulationPathRiskInputBlockerReason>,
): readonly SimulationPathRiskInputBlocker[] {
  return Object.freeze(
    SIMULATION_PATH_RISK_INPUT_BLOCKER_ORDER.filter((reason) =>
      reasons.has(reason),
    ).map((reason) => Object.freeze({ reason })),
  );
}
