import { SIMULATION_NORMALIZED_NAV_POLICY } from "../../src/lib/simulation-normalized-nav-policy.ts";

export const SYNTHETIC_SUMMARY_SCENARIO_VECTOR_HASH =
  `sha256:${"a".repeat(64)}`;
export const SYNTHETIC_SUMMARY_INPUT_MATRIX_HASH =
  `sha256:${"b".repeat(64)}`;
export const SYNTHETIC_SUMMARY_DRAW_PLAN_HASH =
  `sha256:${"c".repeat(64)}`;

export const SYNTHETIC_SUMMARY_PATH_NAVS = Object.freeze([
  Object.freeze([1, 0.8, 0.5]),
  Object.freeze([1, 0.9, 0.75]),
  Object.freeze([1, 1, 1]),
  Object.freeze([1, 1.1, 1.25]),
  Object.freeze([1, 1.2, 1.5]),
]);

export function syntheticDistributionSummaryInput(options = {}) {
  const pathNavs = options.pathNavs ?? SYNTHETIC_SUMMARY_PATH_NAVS;
  const scenarioId = options.scenarioId ?? "synthetic-distribution";
  const scenarioVersion = options.scenarioVersion ?? "v1";
  const scenarioVectorHash =
    options.scenarioVectorHash ?? SYNTHETIC_SUMMARY_SCENARIO_VECTOR_HASH;
  const inputMatrixHash =
    options.inputMatrixHash ?? SYNTHETIC_SUMMARY_INPUT_MATRIX_HASH;
  const drawPlanHash =
    options.drawPlanHash ?? SYNTHETIC_SUMMARY_DRAW_PLAN_HASH;
  const horizon = (pathNavs[0]?.length ?? 1) - 1;
  const pathCount = pathNavs.length;
  const totalPointCount = pathCount * (horizon + 1);
  const provenanceVariant = options.provenanceVariant ?? "alpha";

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
  };
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
