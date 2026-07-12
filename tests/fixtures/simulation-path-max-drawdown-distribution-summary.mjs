import { SIMULATION_PATH_MAX_DRAWDOWN_POLICY } from "../../src/lib/simulation-path-max-drawdown-policy.ts";

export const SYNTHETIC_DRAWDOWN_SUMMARY_SCENARIO_VECTOR_HASH =
  `sha256:${"a".repeat(64)}`;
export const SYNTHETIC_DRAWDOWN_SUMMARY_INPUT_MATRIX_HASH =
  `sha256:${"b".repeat(64)}`;
export const SYNTHETIC_DRAWDOWN_SUMMARY_DRAW_PLAN_HASH =
  `sha256:${"c".repeat(64)}`;

export const SYNTHETIC_DRAWDOWN_SUMMARY_VALUES = Object.freeze([
  0,
  0.1,
  0.2,
  0.3,
  0.4,
]);

export function syntheticPathMaxDrawdownDistributionSummaryInput(
  options = {},
) {
  const drawdowns = option(
    options,
    "drawdowns",
    SYNTHETIC_DRAWDOWN_SUMMARY_VALUES,
  );
  const horizon = option(options, "horizon", 2);
  const scenarioId = option(
    options,
    "scenarioId",
    "synthetic-drawdown-summary",
  );
  const scenarioVersion = option(options, "scenarioVersion", "v1");
  const scenarioVectorHash = option(
    options,
    "scenarioVectorHash",
    SYNTHETIC_DRAWDOWN_SUMMARY_SCENARIO_VECTOR_HASH,
  );
  const inputMatrixHash = option(
    options,
    "inputMatrixHash",
    SYNTHETIC_DRAWDOWN_SUMMARY_INPUT_MATRIX_HASH,
  );
  const drawPlanHash = option(
    options,
    "drawPlanHash",
    SYNTHETIC_DRAWDOWN_SUMMARY_DRAW_PLAN_HASH,
  );
  const pathDrawdowns = drawdowns.map((maxDrawdown, pathIndex) => ({
    pathIndex,
    maxDrawdown,
  }));

  return buildInput({
    drawPlanHash,
    horizon,
    inputMatrixHash,
    pathDrawdowns,
    scenarioId,
    scenarioVectorHash,
    scenarioVersion,
  });
}

export function syntheticUniformPathMaxDrawdownDistributionSummaryInput({
  pathCount,
  maxDrawdown = 0,
  materializeRows = true,
}) {
  const pathDrawdowns = new Array(pathCount);
  if (materializeRows) {
    for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
      pathDrawdowns[pathIndex] = { pathIndex, maxDrawdown };
    }
  }

  return buildInput({
    drawPlanHash: SYNTHETIC_DRAWDOWN_SUMMARY_DRAW_PLAN_HASH,
    horizon: 1,
    inputMatrixHash: SYNTHETIC_DRAWDOWN_SUMMARY_INPUT_MATRIX_HASH,
    pathDrawdowns,
    scenarioId: "synthetic-drawdown-summary-boundary",
    scenarioVectorHash: SYNTHETIC_DRAWDOWN_SUMMARY_SCENARIO_VECTOR_HASH,
    scenarioVersion: "v1",
  });
}

function buildInput({
  drawPlanHash,
  horizon,
  inputMatrixHash,
  pathDrawdowns,
  scenarioId,
  scenarioVectorHash,
  scenarioVersion,
}) {
  const pathCount = pathDrawdowns.length;
  return {
    pathMaxDrawdown: {
      drawdownStatus: "ready",
      runtimeTrustStatus: "not_established",
      policy: SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
      scenarioId,
      scenarioVersion,
      scenarioVectorHash,
      inputMatrixHash,
      drawPlanHash,
      horizon,
      pathCount,
      totalPointCount: pathCount * (horizon + 1),
      pathDrawdowns,
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
