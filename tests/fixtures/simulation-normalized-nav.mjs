import { SIMULATION_GROSS_GROWTH_POLICY } from "../../src/lib/simulation-gross-growth.ts";
import { SIMULATION_NORMALIZED_NAV_POLICY } from "../../src/lib/simulation-normalized-nav-policy.ts";
import {
  canonicalizeSimulationScenarioVector,
  hashSimulationScenarioVector,
} from "../../src/lib/simulation-scenario-vector-review-serialization.ts";

export const SYNTHETIC_INPUT_MATRIX_HASH = `sha256:${"1".repeat(64)}`;
export const SYNTHETIC_DRAW_PLAN_HASH = `sha256:${"2".repeat(64)}`;

export const SYNTHETIC_STANDARD_VECTOR = Object.freeze([
  Object.freeze({
    market: "alpha",
    currency: "KRW",
    ticker: "SYN_A",
    weightBps: 6_000,
  }),
  Object.freeze({
    market: "omega",
    currency: "USD",
    ticker: "SYN_B",
    weightBps: 4_000,
  }),
]);

export function syntheticNormalizedNavInput(options = {}) {
  const vector = options.vector ?? SYNTHETIC_STANDARD_VECTOR;
  const pathFactorRows = options.pathFactorRows ?? [
    [
      [1.1, 0.9],
      [1.21, 0.99],
    ],
    [
      [0.8, 1.2],
      [0.88, 1.08],
    ],
  ];
  const scenarioId = options.scenarioId ?? "synthetic-nav";
  const scenarioVersion = options.scenarioVersion ?? "v1";
  const canonicalVector = vector.map((row) => ({ ...row }));
  const scenarioVectorHash = hashSimulationScenarioVector(
    canonicalizeSimulationScenarioVector({
      scenarioId,
      scenarioVersion,
      vector: canonicalVector,
    }),
  );
  const instrumentKeys = canonicalVector.map(
    (row) => `${row.market}|${row.currency}|${row.ticker}`,
  );
  const horizon = pathFactorRows[0]?.length ?? 0;
  const pathCount = pathFactorRows.length;
  const instrumentCount = instrumentKeys.length;
  const totalPointCount = pathCount * (horizon + 1);

  return {
    grossGrowth: {
      status: "ready",
      policy: SIMULATION_GROSS_GROWTH_POLICY,
      inputMatrixHash: SYNTHETIC_INPUT_MATRIX_HASH,
      drawPlanHash: SYNTHETIC_DRAW_PLAN_HASH,
      instrumentKeys,
      horizon,
      pathCount,
      instrumentCount,
      totalPointCount,
      totalGrowthFactorCells: totalPointCount * instrumentCount,
      paths: pathFactorRows.map((factorRows, pathIndex) => ({
        pathIndex,
        points: [
          point(0, instrumentKeys, instrumentKeys.map(() => 1)),
          ...factorRows.map((values, index) =>
            point(index + 1, instrumentKeys, values),
          ),
        ],
      })),
      blockers: [],
    },
    scenarioVector: {
      portfolioPathPolicyId:
        SIMULATION_NORMALIZED_NAV_POLICY.portfolioPathPolicyId,
      gate0ApprovalCommit:
        SIMULATION_NORMALIZED_NAV_POLICY.gate0ApprovalCommit,
      scenarioId,
      scenarioVersion,
      canonicalVector,
      scenarioVectorHash,
    },
    expectedBinding: {
      expectedInputMatrixHash: SYNTHETIC_INPUT_MATRIX_HASH,
      expectedDrawPlanHash: SYNTHETIC_DRAW_PLAN_HASH,
    },
  };
}

export function syntheticMagnitudeSkewInput() {
  return syntheticNormalizedNavInput({
    scenarioId: "synthetic-magnitude-skew",
    vector: [
      {
        market: "alpha",
        currency: "KRW",
        ticker: "SYN_A",
        weightBps: 5_000,
      },
      {
        market: "beta",
        currency: "USD",
        ticker: "SYN_B",
        weightBps: 2_500,
      },
      {
        market: "gamma",
        currency: "KRW",
        ticker: "SYN_C",
        weightBps: 2_500,
      },
    ],
    pathFactorRows: [[
      [2e16, 4, 4],
    ]],
  });
}

function point(stepIndex, instrumentKeys, values) {
  const sampled = stepIndex > 0;
  return {
    stepIndex,
    drawStepIndex: sampled ? stepIndex - 1 : null,
    sourceRowIndex: sampled ? stepIndex - 1 : null,
    previousServiceDate: sampled ? syntheticDate(stepIndex) : null,
    serviceDate: sampled ? syntheticDate(stepIndex + 1) : null,
    grossGrowthFactors: instrumentKeys.map((instrumentKey, index) => ({
      instrumentKey,
      value: values[index],
    })),
  };
}

function syntheticDate(day) {
  return `2026-01-${String(day).padStart(2, "0")}`;
}
