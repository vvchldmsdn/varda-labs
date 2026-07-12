import {
  SIMULATION_GROSS_GROWTH_POLICY,
} from "./simulation-gross-growth.ts";
import {
  SIMULATION_NORMALIZED_NAV_POLICY,
} from "./simulation-normalized-nav-policy.ts";
import type {
  SimulationNormalizedNavBlocker,
  SimulationNormalizedNavBlockerReason,
  SimulationNormalizedNavInput,
  SimulationNormalizedNavValidationResult,
  ValidatedSimulationNormalizedNavInput,
} from "./simulation-normalized-nav-types.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";
import { buildSimulationScenarioVectorReviewPacket } from "./simulation-scenario-vector-review-packet.ts";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

const BLOCKER_ORDER: readonly SimulationNormalizedNavBlockerReason[] = [
  "input_gross_growth_not_ready",
  "input_gross_growth_policy_mismatch",
  "input_gross_growth_shape_invalid",
  "input_gross_growth_hash_invalid",
  "expected_execution_binding_invalid",
  "input_matrix_hash_mismatch",
  "draw_plan_hash_mismatch",
  "scenario_policy_mismatch",
  "scenario_metadata_invalid",
  "scenario_vector_invalid",
  "scenario_vector_not_canonical",
  "scenario_vector_hash_mismatch",
  "instrument_order_mismatch",
  "nav_output_too_large",
  "invalid_growth_factor",
  "invalid_weighted_term",
  "invalid_nav",
];

const BLOCKER_ORDER_INDEX = new Map(
  BLOCKER_ORDER.map((reason, index) => [reason, index]),
);

export function validateSimulationNormalizedNavInput(
  input: SimulationNormalizedNavInput,
): SimulationNormalizedNavValidationResult {
  const reasons = new Set<SimulationNormalizedNavBlockerReason>();
  const grossGrowth = input?.grossGrowth;
  const scenario = validateScenarioEvidence(input?.scenarioVector, reasons);
  const expectedBinding = input?.expectedBinding;

  if (!isRecord(grossGrowth)) {
    reasons.add("input_gross_growth_not_ready");
    reasons.add("input_gross_growth_shape_invalid");
    return blocked(reasons);
  }

  if (
    grossGrowth.status !== "ready" ||
    !Array.isArray(grossGrowth.blockers) ||
    grossGrowth.blockers.length !== 0
  ) {
    reasons.add("input_gross_growth_not_ready");
  }

  if (!isExactPolicy(grossGrowth.policy, SIMULATION_GROSS_GROWTH_POLICY)) {
    reasons.add("input_gross_growth_policy_mismatch");
  }

  const inputMatrixHash = grossGrowth.inputMatrixHash;
  const drawPlanHash = grossGrowth.drawPlanHash;
  if (!isSha256(inputMatrixHash) || !isSha256(drawPlanHash)) {
    reasons.add("input_gross_growth_hash_invalid");
  }

  const expectedBindingValid =
    isRecord(expectedBinding) &&
    isSha256(expectedBinding.expectedInputMatrixHash) &&
    isSha256(expectedBinding.expectedDrawPlanHash);
  if (!expectedBindingValid) {
    reasons.add("expected_execution_binding_invalid");
  } else {
    if (inputMatrixHash !== expectedBinding.expectedInputMatrixHash) {
      reasons.add("input_matrix_hash_mismatch");
    }
    if (drawPlanHash !== expectedBinding.expectedDrawPlanHash) {
      reasons.add("draw_plan_hash_mismatch");
    }
  }

  const counts = validateGrossGrowthShape(grossGrowth, reasons);
  if (
    scenario &&
    (!Array.isArray(grossGrowth.instrumentKeys) ||
      !sameStringArray(grossGrowth.instrumentKeys, scenario.instrumentKeys))
  ) {
    reasons.add("instrument_order_mismatch");
  }

  if (reasons.size > 0 || !scenario || !counts) {
    return blocked(reasons);
  }

  return Object.freeze({
    validated: Object.freeze({
      grossGrowth:
        grossGrowth as ValidatedSimulationNormalizedNavInput["grossGrowth"],
      scenarioId: scenario.scenarioId,
      scenarioVersion: scenario.scenarioVersion,
      scenarioVectorHash: scenario.scenarioVectorHash,
      weightsBps: Object.freeze([...scenario.weightsBps]),
      totalPointCount: counts.totalPointCount,
      totalNavCells: counts.totalPointCount,
    }),
    blockers: Object.freeze([]),
  });
}

function validateScenarioEvidence(
  evidence: SimulationNormalizedNavInput["scenarioVector"] | undefined,
  reasons: Set<SimulationNormalizedNavBlockerReason>,
) {
  if (!isRecord(evidence)) {
    reasons.add("scenario_metadata_invalid");
    reasons.add("scenario_vector_invalid");
    return null;
  }

  if (
    evidence.portfolioPathPolicyId !==
      SIMULATION_NORMALIZED_NAV_POLICY.portfolioPathPolicyId ||
    evidence.gate0ApprovalCommit !==
      SIMULATION_NORMALIZED_NAV_POLICY.gate0ApprovalCommit
  ) {
    reasons.add("scenario_policy_mismatch");
  }

  if (!Array.isArray(evidence.canonicalVector)) {
    reasons.add("scenario_vector_invalid");
    return null;
  }

  const rows = evidence.canonicalVector;
  if (!rows.every(isScenarioRowShape)) {
    reasons.add("scenario_vector_invalid");
    return null;
  }

  const scenarioId =
    typeof evidence.scenarioId === "string" ? evidence.scenarioId : "";
  const scenarioVersion =
    typeof evidence.scenarioVersion === "string"
      ? evidence.scenarioVersion
      : "";
  const packet = buildSimulationScenarioVectorReviewPacket({
    scenarioId,
    scenarioVersion,
    matrixInstruments: rows.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
    })),
    weights: rows.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      weightBps: row.weightBps,
    })),
  });

  const metadataInvalid = packet.blockers.some(
    (blocker) =>
      blocker.reason === "invalid_scenario_id" ||
      blocker.reason === "invalid_scenario_version",
  );
  if (
    metadataInvalid ||
    packet.scenarioId !== scenarioId ||
    packet.scenarioVersion !== scenarioVersion
  ) {
    reasons.add("scenario_metadata_invalid");
  }
  if (packet.status !== "reviewable" || !packet.canonicalVector) {
    if (!metadataInvalid) reasons.add("scenario_vector_invalid");
    return null;
  }

  if (!sameScenarioRows(rows, packet.canonicalVector)) {
    reasons.add("scenario_vector_not_canonical");
  }
  if (
    !isSha256(evidence.scenarioVectorHash) ||
    evidence.scenarioVectorHash !== packet.scenarioVectorHash
  ) {
    reasons.add("scenario_vector_hash_mismatch");
  }

  return {
    scenarioId,
    scenarioVersion,
    scenarioVectorHash: evidence.scenarioVectorHash,
    instrumentKeys: packet.canonicalVector.map(
      (row) => `${row.market}|${row.currency}|${row.ticker}`,
    ),
    weightsBps: packet.canonicalVector.map((row) => row.weightBps),
  };
}

function validateGrossGrowthShape(
  grossGrowth: Record<string, unknown>,
  reasons: Set<SimulationNormalizedNavBlockerReason>,
) {
  let shapeInvalid = false;
  let invalidGrowthFactor = false;

  const instrumentKeys = grossGrowth.instrumentKeys;
  const horizon = grossGrowth.horizon;
  const pathCount = grossGrowth.pathCount;
  const instrumentCount = grossGrowth.instrumentCount;
  const totalPointCount = grossGrowth.totalPointCount;
  const totalGrowthFactorCells = grossGrowth.totalGrowthFactorCells;
  const paths = grossGrowth.paths;

  if (
    !Array.isArray(instrumentKeys) ||
    instrumentKeys.length === 0 ||
    !instrumentKeys.every(
      (key) => typeof key === "string" && key.length > 0,
    ) ||
    new Set(instrumentKeys).size !== instrumentKeys.length ||
    !isPositiveSafeInteger(horizon) ||
    !isPositiveSafeInteger(pathCount) ||
    !isPositiveSafeInteger(instrumentCount) ||
    instrumentCount !== instrumentKeys.length
  ) {
    shapeInvalid = true;
  }

  const calculatedPointCount =
    isPositiveSafeInteger(horizon) && isPositiveSafeInteger(pathCount)
      ? pathCount * (horizon + 1)
      : Number.NaN;
  const calculatedGrowthFactorCells =
    Number.isSafeInteger(calculatedPointCount) &&
    isPositiveSafeInteger(instrumentCount)
      ? calculatedPointCount * instrumentCount
      : Number.NaN;

  if (
    !Number.isSafeInteger(calculatedPointCount) ||
    !Number.isSafeInteger(calculatedGrowthFactorCells) ||
    totalPointCount !== calculatedPointCount ||
    totalGrowthFactorCells !== calculatedGrowthFactorCells ||
    calculatedGrowthFactorCells >
      SIMULATION_GROSS_GROWTH_POLICY.maxGrowthFactorCells
  ) {
    shapeInvalid = true;
  }

  if (
    !Number.isSafeInteger(calculatedPointCount) ||
    calculatedPointCount > SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints
  ) {
    reasons.add("nav_output_too_large");
  }

  if (!Array.isArray(paths) || paths.length !== pathCount) {
    shapeInvalid = true;
  } else if (
    Array.isArray(instrumentKeys) &&
    isPositiveSafeInteger(horizon)
  ) {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths[pathIndex];
      if (
        !isRecord(path) ||
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

        if (!validPointProvenance(point, stepIndex)) {
          shapeInvalid = true;
        }
        if (
          !Array.isArray(point.grossGrowthFactors) ||
          point.grossGrowthFactors.length !== instrumentKeys.length
        ) {
          shapeInvalid = true;
          continue;
        }

        for (
          let factorIndex = 0;
          factorIndex < point.grossGrowthFactors.length;
          factorIndex += 1
        ) {
          const factor = point.grossGrowthFactors[factorIndex];
          if (
            !isRecord(factor) ||
            factor.instrumentKey !== instrumentKeys[factorIndex]
          ) {
            shapeInvalid = true;
            continue;
          }
          if (
            typeof factor.value !== "number" ||
            !Number.isFinite(factor.value) ||
            factor.value <= 0 ||
            (stepIndex === 0 && factor.value !== 1)
          ) {
            invalidGrowthFactor = true;
          }
        }
      }
    }
  }

  if (shapeInvalid) reasons.add("input_gross_growth_shape_invalid");
  if (invalidGrowthFactor) reasons.add("invalid_growth_factor");

  if (
    shapeInvalid ||
    invalidGrowthFactor ||
    !Number.isSafeInteger(calculatedPointCount) ||
    calculatedPointCount > SIMULATION_NORMALIZED_NAV_POLICY.maxNavPoints
  ) {
    return null;
  }
  return { totalPointCount: calculatedPointCount };
}

function validPointProvenance(
  point: Record<string, unknown>,
  stepIndex: number,
) {
  if (stepIndex === 0) {
    return (
      point.drawStepIndex === null &&
      point.sourceRowIndex === null &&
      point.previousServiceDate === null &&
      point.serviceDate === null
    );
  }

  return (
    point.drawStepIndex === stepIndex - 1 &&
    Number.isSafeInteger(point.sourceRowIndex) &&
    (point.sourceRowIndex as number) >= 0 &&
    typeof point.previousServiceDate === "string" &&
    typeof point.serviceDate === "string" &&
    isRiskDate(point.previousServiceDate) &&
    isRiskDate(point.serviceDate) &&
    point.previousServiceDate < point.serviceDate
  );
}

function isScenarioRowShape(value: unknown): value is Readonly<{
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}> {
  return (
    isRecord(value) &&
    typeof value.market === "string" &&
    typeof value.currency === "string" &&
    typeof value.ticker === "string" &&
    typeof value.weightBps === "number"
  );
}

function sameScenarioRows(
  left: readonly Readonly<{
    market: string;
    currency: string;
    ticker: string;
    weightBps: number;
  }>[] ,
  right: readonly Readonly<{
    market: string;
    currency: string;
    ticker: string;
    weightBps: number;
  }>[],
) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.market === right[index].market &&
        row.currency === right[index].currency &&
        row.ticker === right[index].ticker &&
        row.weightBps === right[index].weightBps,
    )
  );
}

function sameStringArray(left: readonly unknown[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
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

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function blocked(
  reasons: ReadonlySet<SimulationNormalizedNavBlockerReason>,
): SimulationNormalizedNavValidationResult {
  return Object.freeze({
    validated: null,
    blockers: sortBlockers(reasons),
  });
}

function sortBlockers(
  reasons: ReadonlySet<SimulationNormalizedNavBlockerReason>,
): readonly SimulationNormalizedNavBlocker[] {
  return Object.freeze(
    [...reasons]
      .sort(
        (left, right) =>
          (BLOCKER_ORDER_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (BLOCKER_ORDER_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER),
      )
      .map((reason) => Object.freeze({ reason })),
  );
}
