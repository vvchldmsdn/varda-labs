import type { SimulationOwnerParametricFactorResult } from "./simulation-owner-parametric-factor.ts";
import type { SimulationOwnerResearchExecutionResult } from "./simulation-owner-research-execution.ts";

export const SIMULATION_OWNER_MODEL_COMPARISON_POLICY = Object.freeze({
  version: "simulation_owner_model_comparison_v1",
  accountAuthority: "resolved_server_tenant_context",
  requiredPairing:
    "same_account_end_service_date_horizon_path_count_and_owner_weights",
  terminalInterval: "p10_p90",
  intervalOverlap: "intersection_over_union",
  modelCombination: "forbidden",
  winnerSelection: "forbidden",
  confidenceScore: "forbidden",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
  interpretation: "assumption_sensitivity_not_model_ranking",
} as const);

export type SimulationOwnerModelComparisonResult = ReturnType<
  typeof buildSimulationOwnerModelComparison
>;

type ReadyBootstrap = Extract<
  SimulationOwnerResearchExecutionResult,
  { status: "ready" }
>;
type ReadyFactor = Extract<
  SimulationOwnerParametricFactorResult,
  { status: "ready" }
>;

export function buildSimulationOwnerModelComparison(input: {
  bootstrap: SimulationOwnerResearchExecutionResult;
  factor: SimulationOwnerParametricFactorResult;
}) {
  const account = input.bootstrap.account;
  const base = Object.freeze({
    id: `owner-model-comparison-${account}`,
    account,
    policy: SIMULATION_OWNER_MODEL_COMPARISON_POLICY,
    modelStatuses: Object.freeze({
      bootstrap: Object.freeze({
        status: input.bootstrap.status,
        reason:
          input.bootstrap.status === "unavailable"
            ? input.bootstrap.reason
            : null,
      }),
      factor: Object.freeze({
        status: input.factor.status,
        reason:
          input.factor.status === "unavailable" ? input.factor.reason : null,
      }),
    }),
  });

  if (input.bootstrap.status !== "ready") {
    return unavailable(base, "bootstrap_unavailable");
  }
  if (input.factor.status !== "ready") {
    return unavailable(base, "factor_model_unavailable");
  }
  if (input.bootstrap.account !== input.factor.account) {
    return unavailable(base, "account_mismatch");
  }
  if (!sameExecutionWeights(input.bootstrap.executionWeights, input.factor.executionWeights)) {
    return unavailable(base, "weight_identity_mismatch");
  }

  return compareReadyModels(base, input.bootstrap, input.factor);
}

function sameExecutionWeights(
  left: ReadyBootstrap["executionWeights"],
  right: ReadyFactor["executionWeights"],
) {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        row.instrumentKey === other.instrumentKey &&
        row.market === other.market &&
        row.currency === other.currency &&
        row.ticker === other.ticker &&
        row.weightBps === other.weightBps
      );
    })
  );
}

function compareReadyModels(
  base: Readonly<{
    id: string;
    account: string;
    policy: typeof SIMULATION_OWNER_MODEL_COMPARISON_POLICY;
    modelStatuses: Readonly<{
      bootstrap: Readonly<{ status: "ready" | "unavailable"; reason: string | null }>;
      factor: Readonly<{ status: "ready" | "unavailable"; reason: string | null }>;
    }>;
  }>,
  bootstrap: ReadyBootstrap,
  factor: ReadyFactor,
) {
  if (bootstrap.assumptions.horizon !== factor.assumptions.horizon) {
    return unavailable(base, "horizon_mismatch");
  }
  if (bootstrap.assumptions.pathCount !== factor.assumptions.pathCount) {
    return unavailable(base, "path_count_mismatch");
  }
  if (bootstrap.source.endServiceDate !== factor.source.matrixEndServiceDate) {
    return unavailable(base, "end_date_mismatch");
  }
  if (
    bootstrap.bands.length !== factor.bands.length ||
    bootstrap.bands.some(
      (band, index) => band.stepIndex !== factor.bands[index]?.stepIndex,
    )
  ) {
    return unavailable(base, "band_shape_mismatch");
  }

  const bootstrapTerminal = bootstrap.terminal;
  const factorTerminal = factor.terminal;
  const values = [
    bootstrapTerminal.p10Index,
    bootstrapTerminal.p50Index,
    bootstrapTerminal.p90Index,
    bootstrapTerminal.p50ReturnPct,
    bootstrapTerminal.p5ReturnPct,
    bootstrapTerminal.lowerTailMeanReturnPct,
    bootstrapTerminal.lossProbabilityPct,
    bootstrapTerminal.maxDrawdownP50Pct,
    bootstrapTerminal.maxDrawdownP90Pct,
    factorTerminal.p10Index,
    factorTerminal.p50Index,
    factorTerminal.p90Index,
    factorTerminal.p50ReturnPct,
    factorTerminal.p5ReturnPct,
    factorTerminal.lowerTailMeanReturnPct,
    factorTerminal.lossProbabilityPct,
    factorTerminal.maxDrawdownP50Pct,
    factorTerminal.maxDrawdownP90Pct,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return unavailable(base, "nonfinite_summary");
  }

  const overlap = intervalOverlap(
    bootstrapTerminal.p10Index,
    bootstrapTerminal.p90Index,
    factorTerminal.p10Index,
    factorTerminal.p90Index,
  );
  const bootstrapDirection = direction(bootstrapTerminal.p50ReturnPct);
  const factorDirection = direction(factorTerminal.p50ReturnPct);
  const directionAgrees = bootstrapDirection === factorDirection;
  const agreement = resolveAgreement(directionAgrees, overlap.overlaps);

  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    pairing: Object.freeze({
      endServiceDate: bootstrap.source.endServiceDate,
      horizon: bootstrap.assumptions.horizon,
      pathCount: bootstrap.assumptions.pathCount,
      bootstrapObservationCount: bootstrap.source.returnStepCount,
      factorMatrixObservationCount: factor.source.matrixRowCount,
      factorAlignedObservationCount: factor.source.alignedObservationCount,
      factorGapObservationCount: factor.source.factorGapRowCount,
      factorObservationCoveragePct:
        factor.source.matrixRowCount > 0
          ? (factor.source.alignedObservationCount /
              factor.source.matrixRowCount) *
            100
          : 0,
    }),
    agreement: Object.freeze({
      code: agreement,
      directionAgrees,
      bootstrapMedianDirection: bootstrapDirection,
      factorMedianDirection: factorDirection,
      terminalP10P90Overlaps: overlap.overlaps,
      terminalP10P90OverlapPct: overlap.overlapPct,
    }),
    deltas: Object.freeze({
      factorMinusBootstrapP50ReturnPctPoints:
        factorTerminal.p50ReturnPct - bootstrapTerminal.p50ReturnPct,
      factorMinusBootstrapP5ReturnPctPoints:
        factorTerminal.p5ReturnPct - bootstrapTerminal.p5ReturnPct,
      factorMinusBootstrapLowerTailMeanReturnPctPoints:
        factorTerminal.lowerTailMeanReturnPct -
        bootstrapTerminal.lowerTailMeanReturnPct,
      factorMinusBootstrapLossProbabilityPctPoints:
        factorTerminal.lossProbabilityPct -
        bootstrapTerminal.lossProbabilityPct,
      factorMinusBootstrapMaxDrawdownP90PctPoints:
        factorTerminal.maxDrawdownP90Pct -
        bootstrapTerminal.maxDrawdownP90Pct,
    }),
    models: Object.freeze({
      bootstrap: modelProjection(
        `owner-bootstrap-comparison-${base.account}`,
        "과거 구간 재표본",
        bootstrap,
      ),
      factor: modelProjection(
        `owner-factor-comparison-${base.account}`,
        "환율·금리 요인",
        factor,
      ),
    }),
  });
}

function modelProjection(
  id: string,
  name: string,
  model: ReadyBootstrap | ReadyFactor,
) {
  return Object.freeze({
    id,
    name,
    assumptions: Object.freeze({ horizon: model.assumptions.horizon }),
    terminal: model.terminal,
    bands: model.bands,
    samplePaths: model.samplePaths,
  });
}

function intervalOverlap(
  leftMinimum: number,
  leftMaximum: number,
  rightMinimum: number,
  rightMaximum: number,
) {
  const intersection = Math.max(
    0,
    Math.min(leftMaximum, rightMaximum) -
      Math.max(leftMinimum, rightMinimum),
  );
  const union =
    Math.max(leftMaximum, rightMaximum) -
    Math.min(leftMinimum, rightMinimum);
  return Object.freeze({
    overlaps: intersection > 0,
    overlapPct:
      union > 0 ? (intersection / union) * 100 : leftMinimum === rightMinimum ? 100 : 0,
  });
}

function direction(value: number) {
  return value > 0 ? ("positive" as const) : value < 0 ? ("negative" as const) : ("flat" as const);
}

function resolveAgreement(directionAgrees: boolean, rangesOverlap: boolean) {
  if (directionAgrees && rangesOverlap) {
    return "direction_agrees_and_ranges_overlap" as const;
  }
  if (directionAgrees) return "direction_agrees_ranges_disjoint" as const;
  if (rangesOverlap) return "direction_differs_ranges_overlap" as const;
  return "direction_differs_ranges_disjoint" as const;
}

type UnavailableReason =
  | "bootstrap_unavailable"
  | "factor_model_unavailable"
  | "account_mismatch"
  | "weight_identity_mismatch"
  | "horizon_mismatch"
  | "path_count_mismatch"
  | "end_date_mismatch"
  | "band_shape_mismatch"
  | "nonfinite_summary";

function unavailable<T extends Readonly<Record<string, unknown>>>(
  base: T,
  reason: UnavailableReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    pairing: null,
    agreement: null,
    deltas: null,
    models: null,
  });
}
