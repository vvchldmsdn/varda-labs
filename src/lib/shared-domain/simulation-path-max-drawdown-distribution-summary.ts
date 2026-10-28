import {
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
} from "./simulation-path-max-drawdown-distribution-summary-policy.ts";
import type {
  SimulationPathMaxDrawdownDistributionSummaryBlockedResult,
  SimulationPathMaxDrawdownDistributionSummaryBlocker,
  SimulationPathMaxDrawdownDistributionSummaryInput,
  SimulationPathMaxDrawdownDistributionSummaryResult,
  SimulationPathMaxDrawdownQuantiles,
} from "./simulation-path-max-drawdown-distribution-summary-types.ts";
import { validateSimulationPathMaxDrawdownDistributionSummaryInput } from "./simulation-path-max-drawdown-distribution-summary-validation.ts";

export type {
  SimulationPathMaxDrawdownDistributionSummaryBlockedResult,
  SimulationPathMaxDrawdownDistributionSummaryBlocker,
  SimulationPathMaxDrawdownDistributionSummaryBlockerReason,
  SimulationPathMaxDrawdownDistributionSummaryExpectedBinding,
  SimulationPathMaxDrawdownDistributionSummaryInput,
  SimulationPathMaxDrawdownDistributionSummaryReadyResult,
  SimulationPathMaxDrawdownDistributionSummaryResult,
  SimulationPathMaxDrawdownQuantiles,
} from "./simulation-path-max-drawdown-distribution-summary-types.ts";
export {
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
} from "./simulation-path-max-drawdown-distribution-summary-policy.ts";

export function summarizeSimulationPathMaxDrawdownDistribution(
  input: SimulationPathMaxDrawdownDistributionSummaryInput,
): SimulationPathMaxDrawdownDistributionSummaryResult {
  const validation =
    validateSimulationPathMaxDrawdownDistributionSummaryInput(input);
  if (!validation.validated) return blockedResult(validation.blockers);

  const validated = validation.validated;
  const sortedDrawdowns = validated.drawdownValues;
  sortedDrawdowns.sort((left, right) => left - right);

  const p50 = type7Quantile(sortedDrawdowns, 0.5);
  const p90 = type7Quantile(sortedDrawdowns, 0.9);
  if (p50 === null || p90 === null || p50 > p90) {
    return blockedResult(
      Object.freeze([Object.freeze({ reason: "invalid_quantile" })]),
    );
  }

  const maxDrawdownQuantiles: SimulationPathMaxDrawdownQuantiles =
    Object.freeze({ p50, p90 });

  return Object.freeze({
    summaryStatus: "ready",
    runtimeTrustStatus:
      SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
    scenarioId: validated.scenarioId,
    scenarioVersion: validated.scenarioVersion,
    scenarioVectorHash: validated.scenarioVectorHash,
    inputMatrixHash: validated.inputMatrixHash,
    drawPlanHash: validated.drawPlanHash,
    horizon: validated.horizon,
    pathCount: validated.pathCount,
    totalPointCount: validated.totalPointCount,
    maxDrawdownQuantiles,
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
  const canonicalQuantile = quantile === 0 ? 0 : quantile;

  return Number.isFinite(h) &&
    Number.isFinite(fraction) &&
    Number.isFinite(delta) &&
    Number.isFinite(scaledDelta) &&
    Number.isFinite(canonicalQuantile) &&
    canonicalQuantile >= 0 &&
    canonicalQuantile < 1 &&
    !Object.is(canonicalQuantile, -0)
    ? canonicalQuantile
    : null;
}

function blockedResult(
  blockers: readonly SimulationPathMaxDrawdownDistributionSummaryBlocker[],
): SimulationPathMaxDrawdownDistributionSummaryBlockedResult {
  return Object.freeze({
    summaryStatus: "blocked",
    runtimeTrustStatus:
      SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.runtimeTrustStatus,
    policy: SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
    scenarioId: null,
    scenarioVersion: null,
    scenarioVectorHash: null,
    inputMatrixHash: null,
    drawPlanHash: null,
    horizon: 0,
    pathCount: 0,
    totalPointCount: 0,
    maxDrawdownQuantiles: null,
    blockers,
  });
}
