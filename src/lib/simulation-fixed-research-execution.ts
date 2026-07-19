import { materializeSimulationGrossGrowth } from "./simulation-gross-growth.ts";
import { materializeSimulationNormalizedNav } from "./simulation-normalized-nav.ts";
import { summarizeSimulationNormalizedNavDistribution } from "./simulation-normalized-nav-distribution-summary.ts";
import { calculateSimulationPathMaxDrawdowns } from "./simulation-path-max-drawdown.ts";
import { summarizeSimulationPathMaxDrawdownDistribution } from "./simulation-path-max-drawdown-distribution-summary.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import { buildSimulationScenarioVectorReviewPacket } from "./simulation-scenario-vector-review-packet.ts";
import { sampleSimulationSpaghettiPaths } from "./simulation-spaghetti-path-sampling.ts";
import { buildStationaryBootstrapDrawPlan } from "./simulation-stationary-bootstrap.ts";
import { calculateSimulationTerminalLossProbability } from "./simulation-terminal-loss-probability.ts";

export const FIXED_RESEARCH_SIMULATION_POLICY = Object.freeze({
  version: "fixed_single_instrument_research_simulation_v1",
  admission: "explicit_end_query_and_complete_matrix_only",
  sourceReturnStepCount: 90,
  horizon: 63,
  horizonLabel: "approximately_three_market_months",
  pathCount: 500,
  expectedBlockLength: 5,
  seed: 0x56415244,
  randomComparison: "common_random_numbers_across_instruments",
  samplePathCount: 12,
  portfolioPath: "single_instrument_buy_and_hold_10000bps",
  displayBasis: "normalized_index_100",
  persistence: "forbidden",
  accountBinding: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type FixedResearchSimulationId = "kodex200" | "voo";

export type FixedResearchSimulationResult = ReturnType<
  typeof buildFixedResearchSimulation
>;

export function buildFixedResearchSimulation(input: {
  id: FixedResearchSimulationId;
  name: string;
  ticker: string;
  explicitEndServiceDate: string | null;
  matrix: SimulationReturnMatrixResult | null;
}) {
  const base = {
    id: input.id,
    name: input.name,
    ticker: input.ticker,
    policy: FIXED_RESEARCH_SIMULATION_POLICY,
    runtimeTrustStatus: "research_only" as const,
  };

  if (!input.explicitEndServiceDate) {
    return blockedResult(base, "explicit_end_required");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return blockedResult(base, "input_matrix_unavailable");
  }

  const matrix = input.matrix;
  const instrument = matrix.instruments[0];
  const matrixEndServiceDate = matrix.requestedServiceDates.at(-1) ?? null;
  if (
    matrix.instruments.length !== 1 ||
    !instrument ||
    instrument.ticker !== input.ticker ||
    matrix.matrix.length !==
      FIXED_RESEARCH_SIMULATION_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.explicitEndServiceDate
  ) {
    return blockedResult(base, "input_matrix_shape_mismatch");
  }

  const scenarioId = `research-single-${input.id}`;
  const scenarioVersion = "v1";
  const vectorPacket = buildSimulationScenarioVectorReviewPacket({
    scenarioId,
    scenarioVersion,
    matrixInstruments: [instrument],
    weights: [{ ...instrument, weightBps: 10_000 }],
  });
  if (
    vectorPacket.status !== "reviewable" ||
    !vectorPacket.canonicalVector ||
    !vectorPacket.scenarioVectorHash
  ) {
    return blockedResult(base, "research_vector_invalid");
  }

  const drawPlan = buildStationaryBootstrapDrawPlan({
    matrix,
    seed: FIXED_RESEARCH_SIMULATION_POLICY.seed,
    expectedBlockLength:
      FIXED_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
    horizon: FIXED_RESEARCH_SIMULATION_POLICY.horizon,
    pathCount: FIXED_RESEARCH_SIMULATION_POLICY.pathCount,
  });
  if (
    drawPlan.status !== "ready" ||
    !drawPlan.inputMatrixHash ||
    !drawPlan.drawPlanHash
  ) {
    return blockedResult(base, "draw_plan_blocked");
  }

  const grossGrowth = materializeSimulationGrossGrowth({ matrix, drawPlan });
  if (
    grossGrowth.status !== "ready" ||
    !grossGrowth.inputMatrixHash ||
    !grossGrowth.drawPlanHash
  ) {
    return blockedResult(base, "gross_growth_blocked");
  }

  const executionBinding = Object.freeze({
    expectedInputMatrixHash: grossGrowth.inputMatrixHash,
    expectedDrawPlanHash: grossGrowth.drawPlanHash,
  });
  const normalizedNav = materializeSimulationNormalizedNav({
    grossGrowth,
    scenarioVector: {
      portfolioPathPolicyId: vectorPacket.policy.portfolioPathPolicyId,
      gate0ApprovalCommit: vectorPacket.policy.gate0ApprovalCommit,
      scenarioId,
      scenarioVersion,
      canonicalVector: vectorPacket.canonicalVector,
      scenarioVectorHash: vectorPacket.scenarioVectorHash,
    },
    expectedBinding: executionBinding,
  });
  if (
    normalizedNav.calculationStatus !== "ready" ||
    !normalizedNav.scenarioVectorHash ||
    !normalizedNav.inputMatrixHash ||
    !normalizedNav.drawPlanHash
  ) {
    return blockedResult(base, "normalized_nav_blocked");
  }

  const downstreamBinding = Object.freeze({
    expectedScenarioVectorHash: normalizedNav.scenarioVectorHash,
    expectedInputMatrixHash: normalizedNav.inputMatrixHash,
    expectedDrawPlanHash: normalizedNav.drawPlanHash,
  });
  const distribution = summarizeSimulationNormalizedNavDistribution({
    normalizedNav,
    expectedBinding: downstreamBinding,
  });
  const spaghetti = sampleSimulationSpaghettiPaths({
    normalizedNav,
    expectedBinding: downstreamBinding,
    sampleCount: FIXED_RESEARCH_SIMULATION_POLICY.samplePathCount,
  });
  const pathMaxDrawdown = calculateSimulationPathMaxDrawdowns({
    normalizedNav,
    expectedBinding: downstreamBinding,
  });
  const drawdownDistribution =
    summarizeSimulationPathMaxDrawdownDistribution({
      pathMaxDrawdown,
      expectedBinding: downstreamBinding,
    });
  const terminalLoss = calculateSimulationTerminalLossProbability({
    normalizedNav,
    expectedBinding: downstreamBinding,
  });

  if (
    distribution.summaryStatus !== "ready" ||
    spaghetti.sampleStatus !== "ready" ||
    pathMaxDrawdown.drawdownStatus !== "ready" ||
    drawdownDistribution.summaryStatus !== "ready" ||
    terminalLoss.lossStatus !== "ready" ||
    !distribution.terminalSummary ||
    !drawdownDistribution.maxDrawdownQuantiles ||
    terminalLoss.lossProbability === null
  ) {
    return blockedResult(base, "summary_blocked");
  }

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    source: Object.freeze({
      endServiceDate: input.explicitEndServiceDate,
      returnStepCount: matrix.matrix.length,
      firstServiceDate: matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: matrixEndServiceDate,
    }),
    assumptions: Object.freeze({
      horizon: FIXED_RESEARCH_SIMULATION_POLICY.horizon,
      pathCount: FIXED_RESEARCH_SIMULATION_POLICY.pathCount,
      expectedBlockLength:
        FIXED_RESEARCH_SIMULATION_POLICY.expectedBlockLength,
      seed: FIXED_RESEARCH_SIMULATION_POLICY.seed,
      normalizedStartIndex: 100,
    }),
    terminal: Object.freeze({
      p10Index: distribution.terminalSummary.p10 * 100,
      p50Index: distribution.terminalSummary.p50 * 100,
      p90Index: distribution.terminalSummary.p90 * 100,
      p50ReturnPct: (distribution.terminalSummary.p50 - 1) * 100,
      lossProbabilityPct: terminalLoss.lossProbability * 100,
      maxDrawdownP50Pct:
        drawdownDistribution.maxDrawdownQuantiles.p50 * 100,
      maxDrawdownP90Pct:
        drawdownDistribution.maxDrawdownQuantiles.p90 * 100,
    }),
    bands: Object.freeze(
      distribution.stepBands.map((band) =>
        Object.freeze({
          stepIndex: band.stepIndex,
          p10: band.p10 * 100,
          p50: band.p50 * 100,
          p90: band.p90 * 100,
        }),
      ),
    ),
    samplePaths: Object.freeze(
      spaghetti.selectedPaths.map((path) =>
        Object.freeze({
          pathIndex: path.pathIndex,
          points: Object.freeze(
            path.points.map((point) =>
              Object.freeze({
                stepIndex: point.stepIndex,
                indexValue: point.nav * 100,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

function blockedResult(
  base: {
    id: FixedResearchSimulationId;
    name: string;
    ticker: string;
    policy: typeof FIXED_RESEARCH_SIMULATION_POLICY;
    runtimeTrustStatus: "research_only";
  },
  reason:
    | "explicit_end_required"
    | "input_matrix_unavailable"
    | "input_matrix_shape_mismatch"
    | "research_vector_invalid"
    | "draw_plan_blocked"
    | "gross_growth_blocked"
    | "normalized_nav_blocked"
    | "summary_blocked",
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source: null,
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}
