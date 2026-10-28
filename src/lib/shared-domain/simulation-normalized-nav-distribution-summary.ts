import {
  SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY,
} from "./simulation-normalized-nav-distribution-summary-policy.ts";
import type {
  SimulationNormalizedNavDistributionBand,
  SimulationNormalizedNavDistributionSummaryBlockedResult,
  SimulationNormalizedNavDistributionSummaryBlocker,
  SimulationNormalizedNavDistributionSummaryInput,
  SimulationNormalizedNavDistributionSummaryResult,
} from "./simulation-normalized-nav-distribution-summary-types.ts";
import { validateSimulationNormalizedNavDistributionSummaryInput } from "./simulation-normalized-nav-distribution-summary-validation.ts";

export type {
  SimulationNormalizedNavDistributionBand,
  SimulationNormalizedNavDistributionSummaryBlockedResult,
  SimulationNormalizedNavDistributionSummaryBlocker,
  SimulationNormalizedNavDistributionSummaryBlockerReason,
  SimulationNormalizedNavDistributionSummaryExpectedBinding,
  SimulationNormalizedNavDistributionSummaryInput,
  SimulationNormalizedNavDistributionSummaryReadyResult,
  SimulationNormalizedNavDistributionSummaryResult,
} from "./simulation-normalized-nav-distribution-summary-types.ts";
export {
  SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
  SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY,
} from "./simulation-normalized-nav-distribution-summary-policy.ts";

export function summarizeSimulationNormalizedNavDistribution(
  input: SimulationNormalizedNavDistributionSummaryInput,
): SimulationNormalizedNavDistributionSummaryResult {
  const validation =
    validateSimulationNormalizedNavDistributionSummaryInput(input);
  if (!validation.validated) return blockedResult(validation.blockers);

  const validated = validation.validated;
  const stepBands: SimulationNormalizedNavDistributionBand[] = [];
  const stepValues = new Array<number>(validated.pathCount);

  for (let stepIndex = 0; stepIndex <= validated.horizon; stepIndex += 1) {
    if (stepIndex === 0) {
      stepBands.push(freezeBand({ stepIndex, p10: 1, p50: 1, p90: 1 }));
      continue;
    }

    for (let pathIndex = 0; pathIndex < validated.pathCount; pathIndex += 1) {
      stepValues[pathIndex] =
        validated.normalizedNav.paths[pathIndex].points[stepIndex].nav;
    }
    stepValues.sort((left, right) => left - right);

    const p10 = type7Quantile(stepValues, 0.1);
    const p50 = type7Quantile(stepValues, 0.5);
    const p90 = type7Quantile(stepValues, 0.9);
    if (
      p10 === null ||
      p50 === null ||
      p90 === null ||
      p10 > p50 ||
      p50 > p90
    ) {
      return blockedResult(
        Object.freeze([Object.freeze({ reason: "invalid_quantile" })]),
      );
    }
    stepBands.push(freezeBand({ stepIndex, p10, p50, p90 }));
  }

  const frozenBands = Object.freeze(stepBands);
  const finalBand = frozenBands[validated.horizon];
  const terminalSummary = freezeBand({ ...finalBand });

  return Object.freeze({
    summaryStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    horizon: validated.horizon,
    pathCount: validated.pathCount,
    totalPointCount: validated.totalPointCount,
    stepBands: frozenBands,
    terminalSummary,
    blockers: Object.freeze([]) as readonly [],
  });
}

function type7Quantile(sortedValues: readonly number[], probability: number) {
  const h = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(h);
  const fraction = h - lowerIndex;
  const upperIndex = Math.min(lowerIndex + 1, sortedValues.length - 1);
  const lower = sortedValues[lowerIndex];
  const upper = sortedValues[upperIndex];
  const delta = upper - lower;
  const scaledDelta = fraction * delta;
  const quantile = lower + scaledDelta;

  return Number.isFinite(h) &&
    Number.isFinite(fraction) &&
    Number.isFinite(delta) &&
    Number.isFinite(scaledDelta) &&
    Number.isFinite(quantile) &&
    quantile > 0
    ? quantile
    : null;
}

function freezeBand(
  band: SimulationNormalizedNavDistributionBand,
): SimulationNormalizedNavDistributionBand {
  return Object.freeze({ ...band });
}

function blockedResult(
  blockers: readonly SimulationNormalizedNavDistributionSummaryBlocker[],
): SimulationNormalizedNavDistributionSummaryBlockedResult {
  return Object.freeze({
    summaryStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY,
    scenarioId: null,
    scenarioVersion: null,
    scenarioVectorHash: null,
    inputMatrixHash: null,
    drawPlanHash: null,
    horizon: 0,
    pathCount: 0,
    totalPointCount: 0,
    stepBands: Object.freeze([]) as readonly [],
    terminalSummary: null,
    blockers,
  });
}
