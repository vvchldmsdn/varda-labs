import { SIMULATION_NORMALIZED_NAV_POLICY } from "../../src/lib/simulation-normalized-nav-policy.ts";

export const SYNTHETIC_SPAGHETTI_SCENARIO_VECTOR_HASH =
  `sha256:${"4".repeat(64)}`;
export const SYNTHETIC_SPAGHETTI_INPUT_MATRIX_HASH =
  `sha256:${"5".repeat(64)}`;
export const SYNTHETIC_SPAGHETTI_DRAW_PLAN_HASH =
  `sha256:${"6".repeat(64)}`;

export const SYNTHETIC_SPAGHETTI_PATH_NAVS = Object.freeze([
  Object.freeze([1, 0.8, 0.7, 0.9]),
  Object.freeze([1, 0.9, 1, 0.95]),
  Object.freeze([1, 1, 1.1, 1.2]),
  Object.freeze([1, 1.1, 1.05, 1.3]),
  Object.freeze([1, 1.2, 1.25, 1.4]),
  Object.freeze([1, 1.3, 1.4, 1.5]),
]);

export function syntheticSpaghettiPathSampleInput(options = {}) {
  const pathNavs = option(
    options,
    "pathNavs",
    SYNTHETIC_SPAGHETTI_PATH_NAVS,
  );
  const scenarioId = option(options, "scenarioId", "synthetic-spaghetti");
  const scenarioVersion = option(options, "scenarioVersion", "v1");
  const scenarioVectorHash = option(
    options,
    "scenarioVectorHash",
    SYNTHETIC_SPAGHETTI_SCENARIO_VECTOR_HASH,
  );
  const inputMatrixHash = option(
    options,
    "inputMatrixHash",
    SYNTHETIC_SPAGHETTI_INPUT_MATRIX_HASH,
  );
  const drawPlanHash = option(
    options,
    "drawPlanHash",
    SYNTHETIC_SPAGHETTI_DRAW_PLAN_HASH,
  );
  const sampleCount = option(options, "sampleCount", 3);
  const provenanceVariant = option(options, "provenanceVariant", "alpha");
  const horizon = (pathNavs[0]?.length ?? 1) - 1;
  const pathCount = pathNavs.length;
  const totalPointCount = pathCount * (horizon + 1);

  return {
    normalizedNav: {
      calculationStatus: "ready",
      runtimeTrustStatus: "not_established",
      policy: SIMULATION_NORMALIZED_NAV_POLICY,
      scenarioId,
      scenarioVersion,
      scenarioVectorHash,
      inputMatrixHash,
      drawPlanHash,
      horizon,
      pathCount,
      totalPointCount,
      totalNavCells: totalPointCount,
      paths: pathNavs.map((navs, pathIndex) => ({
        pathIndex,
        points: navs.map((nav, stepIndex) =>
          syntheticPoint({
            nav,
            pathIndex,
            provenanceVariant,
            stepIndex,
          }),
        ),
      })),
      blockers: [],
    },
    expectedBinding: {
      expectedScenarioVectorHash: scenarioVectorHash,
      expectedInputMatrixHash: inputMatrixHash,
      expectedDrawPlanHash: drawPlanHash,
    },
    sampleCount,
  };
}

export function syntheticSpaghettiPathNavs(pathCount, pointCount) {
  return Array.from({ length: pathCount }, (_, pathIndex) =>
    Array.from({ length: pointCount }, (_, stepIndex) =>
      stepIndex === 0
        ? 1
        : 1 + pathIndex / Math.max(pathCount, 1) / 10 + stepIndex / 1_000_000,
    ),
  );
}

function syntheticPoint({ nav, pathIndex, provenanceVariant, stepIndex }) {
  const sampled = stepIndex > 0;
  return {
    stepIndex,
    drawStepIndex: sampled ? stepIndex - 1 : null,
    sourceRowIndex: sampled ? pathIndex + stepIndex : null,
    previousServiceDate: sampled
      ? `${provenanceVariant}-previous-${pathIndex}-${stepIndex}`
      : null,
    serviceDate: sampled
      ? `${provenanceVariant}-service-${pathIndex}-${stepIndex}`
      : null,
    nav,
  };
}

function option(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key)
    ? options[key]
    : fallback;
}
