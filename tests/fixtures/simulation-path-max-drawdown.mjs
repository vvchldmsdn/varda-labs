import { SIMULATION_NORMALIZED_NAV_POLICY } from "../../src/lib/simulation-normalized-nav-policy.ts";

export const SYNTHETIC_MAX_DRAWDOWN_SCENARIO_VECTOR_HASH =
  `sha256:${"a".repeat(64)}`;
export const SYNTHETIC_MAX_DRAWDOWN_INPUT_MATRIX_HASH =
  `sha256:${"b".repeat(64)}`;
export const SYNTHETIC_MAX_DRAWDOWN_DRAW_PLAN_HASH =
  `sha256:${"c".repeat(64)}`;

export const SYNTHETIC_MAX_DRAWDOWN_PATH_NAVS = Object.freeze([
  Object.freeze([1, 1.2, 0.9, 1.1]),
  Object.freeze([1, 0.8, 1.1, 0.55]),
  Object.freeze([1, 1.1, 1.3, 1.4]),
  Object.freeze([1, 0.9, 0.7, 0.8]),
]);

export function syntheticPathMaxDrawdownInput(options = {}) {
  const pathNavs = option(
    options,
    "pathNavs",
    SYNTHETIC_MAX_DRAWDOWN_PATH_NAVS,
  );
  const scenarioId = option(options, "scenarioId", "synthetic-max-drawdown");
  const scenarioVersion = option(options, "scenarioVersion", "v1");
  const scenarioVectorHash = option(
    options,
    "scenarioVectorHash",
    SYNTHETIC_MAX_DRAWDOWN_SCENARIO_VECTOR_HASH,
  );
  const inputMatrixHash = option(
    options,
    "inputMatrixHash",
    SYNTHETIC_MAX_DRAWDOWN_INPUT_MATRIX_HASH,
  );
  const drawPlanHash = option(
    options,
    "drawPlanHash",
    SYNTHETIC_MAX_DRAWDOWN_DRAW_PLAN_HASH,
  );
  const provenanceVariant = option(options, "provenanceVariant", "alpha");
  const horizon = (pathNavs[0]?.length ?? 1) - 1;
  const pathCount = pathNavs.length;
  const totalPointCount = pathCount * (horizon + 1);

  return buildInput({
    drawPlanHash,
    horizon,
    inputMatrixHash,
    pathCount,
    paths: pathNavs.map((navs, pathIndex) => ({
      pathIndex,
      points: navs.map((nav, stepIndex) =>
        syntheticPathMaxDrawdownPoint({
          nav,
          pathIndex,
          provenanceVariant,
          stepIndex,
        }),
      ),
    })),
    scenarioId,
    scenarioVectorHash,
    scenarioVersion,
    totalPointCount,
  });
}

export function syntheticSharedTwoPointMaxDrawdownInput({
  pathCount,
  secondNav = 1,
}) {
  const sharedPoints = Object.freeze([
    Object.freeze(
      syntheticPathMaxDrawdownPoint({ nav: 1, stepIndex: 0 }),
    ),
    Object.freeze(
      syntheticPathMaxDrawdownPoint({ nav: secondNav, stepIndex: 1 }),
    ),
  ]);
  const paths = Array.from({ length: pathCount }, (_, pathIndex) => ({
    pathIndex,
    points: sharedPoints,
  }));

  return buildInput({
    drawPlanHash: SYNTHETIC_MAX_DRAWDOWN_DRAW_PLAN_HASH,
    horizon: 1,
    inputMatrixHash: SYNTHETIC_MAX_DRAWDOWN_INPUT_MATRIX_HASH,
    pathCount,
    paths,
    scenarioId: "synthetic-max-drawdown-boundary",
    scenarioVectorHash: SYNTHETIC_MAX_DRAWDOWN_SCENARIO_VECTOR_HASH,
    scenarioVersion: "v1",
    totalPointCount: pathCount * 2,
  });
}

export function syntheticPathMaxDrawdownPoint({
  nav,
  pathIndex = 0,
  provenanceVariant = "synthetic",
  stepIndex,
}) {
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

function buildInput({
  drawPlanHash,
  horizon,
  inputMatrixHash,
  pathCount,
  paths,
  scenarioId,
  scenarioVectorHash,
  scenarioVersion,
  totalPointCount,
}) {
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
      paths,
      blockers: [],
    },
    expectedBinding: {
      expectedScenarioVectorHash: scenarioVectorHash,
      expectedInputMatrixHash: inputMatrixHash,
      expectedDrawPlanHash: drawPlanHash,
    },
  };
}

function option(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key)
    ? options[key]
    : fallback;
}
