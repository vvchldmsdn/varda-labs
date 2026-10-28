import { isRiskDate, shiftRiskDate } from "./portfolio-risk-calendar.ts";
import {
  addSimulationPeriodIssue,
  normalizeSimulationPeriodCandidates,
  sortSimulationPeriodIssues,
} from "./simulation-period-request-normalization.ts";
import { SIMULATION_PERIOD_REQUEST_POLICY } from "./simulation-period-request-resolver.ts";
import type {
  SimulationPeriodCandidateInput,
  SimulationPeriodIssue,
} from "./simulation-period-request-types.ts";

export const SIMULATION_PERIOD_PREFLIGHT_SCAN_POLICY = Object.freeze({
  version: "simulation_period_preflight_scan_v1",
  axisScanDaysFormula: "ceil((return_step_count_plus_one)*2)+30",
  sourceUpperPolicy: "end_service_date_minus_one_calendar_day",
  sourceLowerPolicy: "source_upper_minus_axis_scan_days",
  axisReadPolicy: "one_parallel_price_and_required_fx_read",
  coverageReadPolicy: "one_phase0b_read_after_exact_axis_only",
  automaticRetry: "forbidden",
  automaticRangeExpansion: "forbidden",
  explicitLongerScanPolicy: "separate_versioned_request_required",
} as const);

export type SimulationPeriodPreflightRequest = Readonly<{
  candidates: readonly SimulationPeriodCandidateInput[];
  endServiceDate: string;
  returnStepCount: number;
}>;

export function planSimulationPeriodPreflightScan(
  request: SimulationPeriodPreflightRequest,
) {
  const issues: SimulationPeriodIssue[] = [];
  const endServiceDate = String(request.endServiceDate ?? "").trim();
  const validEndServiceDate = isRiskDate(endServiceDate)
    ? endServiceDate
    : null;
  if (!validEndServiceDate) {
    addSimulationPeriodIssue(
      issues,
      "blocked",
      "invalid_end_service_date",
    );
  }
  const validReturnStepCount =
    Number.isSafeInteger(request.returnStepCount) &&
    request.returnStepCount >= 1 &&
    request.returnStepCount <=
      SIMULATION_PERIOD_REQUEST_POLICY.maxReturnStepCount
      ? request.returnStepCount
      : null;
  if (validReturnStepCount === null) {
    addSimulationPeriodIssue(
      issues,
      "blocked",
      "invalid_return_step_count",
    );
  }

  const universe = normalizeSimulationPeriodCandidates(request.candidates);
  issues.push(...universe.issues);
  const sortedIssues = sortSimulationPeriodIssues(issues);
  if (
    sortedIssues.some((issue) => issue.severity === "blocked") ||
    !validEndServiceDate ||
    validReturnStepCount === null
  ) {
    return Object.freeze({
      status: "blocked" as const,
      policy: SIMULATION_PERIOD_PREFLIGHT_SCAN_POLICY,
      endServiceDate: validEndServiceDate,
      returnStepCount: validReturnStepCount,
      requiredPointCount:
        validReturnStepCount === null ? null : validReturnStepCount + 1,
      candidates: universe.candidates,
      requiresFx: false,
      queryRange: null,
      issues: sortedIssues,
    });
  }

  const requiredPointCount = validReturnStepCount + 1;
  const axisScanDays = Math.ceil(requiredPointCount * 2) + 30;
  const sourceDateTo = shiftRiskDate(validEndServiceDate, -1);
  const sourceDateFrom = shiftRiskDate(sourceDateTo, -axisScanDays);
  const requiresFx = universe.candidates.some(
    (candidate) => candidate.currency === "USD",
  );

  return Object.freeze({
    status: "queryable" as const,
    policy: SIMULATION_PERIOD_PREFLIGHT_SCAN_POLICY,
    endServiceDate: validEndServiceDate,
    returnStepCount: validReturnStepCount,
    requiredPointCount,
    candidates: universe.candidates,
    requiresFx,
    queryRange: Object.freeze({
      axisScanDays,
      sourceDateFrom,
      sourceDateTo,
    }),
    issues: sortedIssues,
  });
}
