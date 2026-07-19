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

export type SimulationResearchExecutionBlockerReason =
  | "research_vector_invalid"
  | "draw_plan_blocked"
  | "gross_growth_blocked"
  | "normalized_nav_blocked"
  | "summary_blocked";

export type SimulationResearchExecutionCoreResult = ReturnType<
  typeof executeSimulationResearchPaths
>;

type ResearchWeight = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export function executeSimulationResearchPaths(input: {
  matrix: SimulationReturnMatrixResult;
  scenarioId: string;
  scenarioVersion: string;
  weights: readonly ResearchWeight[];
  seed: number;
  expectedBlockLength: number;
  horizon: number;
  pathCount: number;
  samplePathCount: number;
}) {
  const vectorPacket = buildSimulationScenarioVectorReviewPacket({
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion,
    matrixInstruments: input.matrix.instruments,
    weights: input.weights,
  });
  if (
    vectorPacket.status !== "reviewable" ||
    !vectorPacket.canonicalVector ||
    !vectorPacket.scenarioVectorHash
  ) {
    return blockedResult("research_vector_invalid");
  }

  const drawPlan = buildStationaryBootstrapDrawPlan({
    matrix: input.matrix,
    seed: input.seed,
    expectedBlockLength: input.expectedBlockLength,
    horizon: input.horizon,
    pathCount: input.pathCount,
  });
  if (
    drawPlan.status !== "ready" ||
    !drawPlan.inputMatrixHash ||
    !drawPlan.drawPlanHash
  ) {
    return blockedResult("draw_plan_blocked");
  }

  const grossGrowth = materializeSimulationGrossGrowth({
    matrix: input.matrix,
    drawPlan,
  });
  if (
    grossGrowth.status !== "ready" ||
    !grossGrowth.inputMatrixHash ||
    !grossGrowth.drawPlanHash
  ) {
    return blockedResult("gross_growth_blocked");
  }

  const normalizedNav = materializeSimulationNormalizedNav({
    grossGrowth,
    scenarioVector: {
      portfolioPathPolicyId: vectorPacket.policy.portfolioPathPolicyId,
      gate0ApprovalCommit: vectorPacket.policy.gate0ApprovalCommit,
      scenarioId: input.scenarioId,
      scenarioVersion: input.scenarioVersion,
      canonicalVector: vectorPacket.canonicalVector,
      scenarioVectorHash: vectorPacket.scenarioVectorHash,
    },
    expectedBinding: {
      expectedInputMatrixHash: grossGrowth.inputMatrixHash,
      expectedDrawPlanHash: grossGrowth.drawPlanHash,
    },
  });
  if (
    normalizedNav.calculationStatus !== "ready" ||
    !normalizedNav.scenarioVectorHash ||
    !normalizedNav.inputMatrixHash ||
    !normalizedNav.drawPlanHash
  ) {
    return blockedResult("normalized_nav_blocked");
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
    sampleCount: input.samplePathCount,
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
    return blockedResult("summary_blocked");
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    assumptions: Object.freeze({
      horizon: input.horizon,
      pathCount: input.pathCount,
      expectedBlockLength: input.expectedBlockLength,
      seed: input.seed,
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

function blockedResult(reason: SimulationResearchExecutionBlockerReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
  });
}
