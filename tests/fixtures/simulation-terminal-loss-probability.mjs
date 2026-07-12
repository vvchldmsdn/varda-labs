import { SIMULATION_NORMALIZED_NAV_POLICY } from "../../src/lib/simulation-normalized-nav-policy.ts";

export const SYNTHETIC_TERMINAL_LOSS_SCENARIO_VECTOR_HASH =
  `sha256:${"7".repeat(64)}`;
export const SYNTHETIC_TERMINAL_LOSS_INPUT_MATRIX_HASH =
  `sha256:${"8".repeat(64)}`;
export const SYNTHETIC_TERMINAL_LOSS_DRAW_PLAN_HASH =
  `sha256:${"9".repeat(64)}`;

export const SYNTHETIC_TERMINAL_LOSS_PATH_NAVS = Object.freeze([
  Object.freeze([1, 1.1, 0.9]),
  Object.freeze([1, 0.8, 1]),
  Object.freeze([1, 1.2, 1.1]),
  Object.freeze([1, 0.9, 0.99]),
  Object.freeze([1, 1.5, 1.2]),
]);

export function syntheticTerminalLossProbabilityInput(options = {}) {
  const pathNavs = option(
    options,
    "pathNavs",
    SYNTHETIC_TERMINAL_LOSS_PATH_NAVS,
  );
  const scenarioId = option(options, "scenarioId", "synthetic-terminal-loss");
  const scenarioVersion = option(options, "scenarioVersion", "v1");
  const scenarioVectorHash = option(
    options,
    "scenarioVectorHash",
    SYNTHETIC_TERMINAL_LOSS_SCENARIO_VECTOR_HASH,
  );
  const inputMatrixHash = option(
    options,
    "inputMatrixHash",
    SYNTHETIC_TERMINAL_LOSS_INPUT_MATRIX_HASH,
  );
  const drawPlanHash = option(
    options,
    "drawPlanHash",
    SYNTHETIC_TERMINAL_LOSS_DRAW_PLAN_HASH,
  );
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
          syntheticTerminalLossPoint({
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
  };
}

export function syntheticTerminalLossPoint({
  nav,
  pathIndex = 0,
  provenanceVariant = "cap",
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

function option(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key)
    ? options[key]
    : fallback;
}
