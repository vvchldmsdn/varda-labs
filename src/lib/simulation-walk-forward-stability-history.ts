import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";
import { buildSimulationWalkForwardMinimumVolatility } from "./simulation-walk-forward-min-volatility.ts";

export const SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY = Object.freeze({
  version: "walk_forward_minimum_volatility_stability_history_v1",
  endpointCount: 7,
  endpointPolicy: "explicit_end_and_previous_six_calendar_service_dates",
  executionPolicy: "reuse_walk_forward_minimum_volatility_research_v1",
  overlapDisclosure: "overlapping_windows_not_independent_trials",
  missingEndpointPolicy: "preserve_ready_rows_and_mark_only_missing_row_unavailable",
  hyperparameterSelection: "forbidden",
  endpointRanking: "forbidden",
  accountBinding: "forbidden",
  recommendation: "forbidden",
  persistence: "forbidden",
} as const);

export type SimulationWalkForwardStabilityHistoryResult = ReturnType<
  typeof buildSimulationWalkForwardStabilityHistory
>;

export type SimulationWalkForwardStabilityHistoryReason =
  | "explicit_end_required"
  | "endpoint_set_mismatch"
  | "some_endpoints_unavailable"
  | "all_endpoints_unavailable";

export function buildSimulationWalkForwardStabilityHistory(input: {
  explicitEndServiceDate: string | null;
  endpoints: readonly Readonly<{
    serviceDate: string;
    matrix: SimulationReturnMatrixResult | null;
  }>[];
}) {
  if (!input.explicitEndServiceDate) {
    return unavailable("explicit_end_required");
  }
  if (!isExpectedEndpointSet(input.explicitEndServiceDate, input.endpoints)) {
    return unavailable("endpoint_set_mismatch");
  }

  const rows = Object.freeze(
    input.endpoints.map((endpoint) => {
      const result = buildSimulationWalkForwardMinimumVolatility({
        explicitEndServiceDate: endpoint.serviceDate,
        matrix: endpoint.matrix,
      });
      if (result.status === "unavailable") {
        return Object.freeze({
          serviceDate: endpoint.serviceDate,
          status: "unavailable" as const,
          reason: result.reason,
          outOfSampleReturnPct: null,
          annualizedVolatilityPct: null,
          equalWeightAnnualizedVolatilityPct: null,
          annualizedVolatilityDifferencePctPoints: null,
          maxDrawdownPct: null,
          foldKodexWeightBps: Object.freeze([] as number[]),
        });
      }

      return Object.freeze({
        serviceDate: endpoint.serviceDate,
        status: "ready" as const,
        reason: null,
        outOfSampleReturnPct: result.paths.minimumVolatility.totalReturnPct,
        annualizedVolatilityPct:
          result.paths.minimumVolatility.annualizedVolatilityPct,
        equalWeightAnnualizedVolatilityPct:
          result.paths.equalWeight.annualizedVolatilityPct,
        annualizedVolatilityDifferencePctPoints:
          result.comparison.annualizedVolatilityDifferencePctPoints,
        maxDrawdownPct: result.paths.minimumVolatility.maxDrawdownPct,
        foldKodexWeightBps: Object.freeze(
          result.folds.map((fold) => fold.weights[0].weightBps),
        ),
      });
    }),
  );
  const readyEndpointCount = rows.filter(
    (row) => row.status === "ready",
  ).length;
  const unavailableEndpointCount = rows.length - readyEndpointCount;
  const status =
    readyEndpointCount === rows.length
      ? ("ready" as const)
      : readyEndpointCount > 0
        ? ("partial" as const)
        : ("unavailable" as const);
  const reason =
    status === "ready"
      ? null
      : status === "partial"
        ? ("some_endpoints_unavailable" as const)
        : ("all_endpoints_unavailable" as const);

  return Object.freeze({
    status,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY,
    summary: Object.freeze({
      endpointCount: rows.length,
      readyEndpointCount,
      unavailableEndpointCount,
    }),
    rows,
  });
}

function isExpectedEndpointSet(
  explicitEndServiceDate: string,
  endpoints: readonly Readonly<{ serviceDate: string }>[],
) {
  const policy = SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY;
  return (
    isRiskDate(explicitEndServiceDate) &&
    endpoints.length === policy.endpointCount &&
    endpoints.every(
      (endpoint, index) =>
        endpoint.serviceDate === shiftRiskDate(explicitEndServiceDate, -index),
    )
  );
}

function unavailable(reason: SimulationWalkForwardStabilityHistoryReason) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    runtimeTrustStatus: "research_only" as const,
    policy: SIMULATION_WALK_FORWARD_STABILITY_HISTORY_POLICY,
    summary: Object.freeze({
      endpointCount: 0,
      readyEndpointCount: 0,
      unavailableEndpointCount: 0,
    }),
    rows: Object.freeze([]),
  });
}
