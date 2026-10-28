import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  addSimulationPeriodIssue,
  normalizeSimulationPeriodCandidates,
  normalizeSimulationPeriodFxRows,
  normalizeSimulationPeriodPriceRows,
  sortSimulationPeriodIssues,
  uniqueSortedDates,
} from "./simulation-period-request-normalization.ts";
import type {
  SimulationPeriodCandidateAvailability,
  SimulationPeriodIssue,
  SimulationPeriodRequestInput,
} from "./simulation-period-request-types.ts";

export type {
  SimulationPeriodCandidateAvailability,
  SimulationPeriodCandidateInput,
  SimulationPeriodIssue,
  SimulationPeriodIssueReason,
  SimulationPeriodRequestInput,
} from "./simulation-period-request-types.ts";

export const SIMULATION_PERIOD_REQUEST_POLICY = Object.freeze({
  version: "simulation_period_request_resolver_v1",
  requestMode: "exact_end_service_date_and_return_step_count",
  pointCountRule: "return_step_count_plus_one",
  axisPolicy: "candidate_price_and_required_fx_service_date_union",
  evidenceDateMapping: "stored_close_date_plus_one_kst_service_date",
  endpointPolicy: "exact_observed_no_rollback",
  nearestPriorPolicy: "reference_only",
  calendarDayEnumeration: "forbidden",
  instrumentIntersection: "forbidden",
  carryPolicy: "deferred_to_simulation_return_matrix_v1",
  shorteningPolicy: "forbidden",
  futureObservationPolicy: "ignored",
  maxReturnStepCount: 10_000,
} as const);

export function resolveSimulationPeriodRequest(
  input: SimulationPeriodRequestInput,
) {
  const issues: SimulationPeriodIssue[] = [];
  const endServiceDate = String(input.endServiceDate ?? "").trim();
  if (!isRiskDate(endServiceDate)) {
    addSimulationPeriodIssue(
      issues,
      "blocked",
      "invalid_end_service_date",
    );
  }
  if (
    !Number.isSafeInteger(input.returnStepCount) ||
    input.returnStepCount < 1 ||
    input.returnStepCount > SIMULATION_PERIOD_REQUEST_POLICY.maxReturnStepCount
  ) {
    addSimulationPeriodIssue(
      issues,
      "blocked",
      "invalid_return_step_count",
    );
  }

  const universe = normalizeSimulationPeriodCandidates(input.candidates);
  issues.push(...universe.issues);
  const requestBlocked = issues.some((issue) => issue.severity === "blocked");
  if (requestBlocked) {
    return buildResult({
      status: "blocked",
      endServiceDate: isRiskDate(endServiceDate) ? endServiceDate : null,
      returnStepCount: validReturnStepCount(input.returnStepCount),
      candidates: universe.candidates.map((candidate) => ({
        ...candidate,
        status: "missing" as const,
        observationCount: 0,
        firstServiceDate: null,
        lastServiceDate: null,
      })),
      resolvedServiceDates: [],
      nearestPriorObservedServiceDate: null,
      priceAxisDates: [],
      fxAxisDates: [],
      unionAxisDates: [],
      acceptedPriceObservationCount: 0,
      acceptedFxObservationCount: 0,
      ignoredExternalPriceRowCount: 0,
      ignoredFuturePriceRowCount: 0,
      ignoredFutureFxRowCount: 0,
      ignoredNotRequiredFxRowCount: 0,
      issues,
    });
  }

  const prices = normalizeSimulationPeriodPriceRows({
    rows: input.priceRows,
    candidates: universe.candidates,
    endServiceDate,
  });
  const requiresFx = universe.candidates.some(
    (candidate) => candidate.currency === "USD",
  );
  const fx = normalizeSimulationPeriodFxRows({
    rows: input.fxRows,
    required: requiresFx,
    endServiceDate,
  });
  issues.push(...prices.issues, ...fx.issues);

  const candidateAvailability: SimulationPeriodCandidateAvailability[] =
    universe.candidates.map((candidate) => {
      const observations =
        prices.observationsByInstrument.get(candidate.instrumentKey) ?? [];
      if (observations.length === 0) {
        addSimulationPeriodIssue(
          issues,
          "incomplete",
          "missing_candidate_price",
          candidate.instrumentKey,
        );
      }
      return Object.freeze({
        ...candidate,
        status:
          observations.length > 0
            ? ("observed" as const)
            : ("missing" as const),
        observationCount: observations.length,
        firstServiceDate: observations[0]?.serviceDate ?? null,
        lastServiceDate: observations.at(-1)?.serviceDate ?? null,
      });
    });
  if (requiresFx && fx.observations.length === 0) {
    addSimulationPeriodIssue(
      issues,
      "incomplete",
      "missing_fx_observation",
    );
  }

  const unionAxisDates = uniqueSortedDates([
    ...prices.axisDates,
    ...fx.axisDates,
  ]);
  const nearestPriorObservedServiceDate =
    [...unionAxisDates].reverse().find((date) => date < endServiceDate) ?? null;
  const endObserved = unionAxisDates.includes(endServiceDate);
  if (!endObserved) {
    addSimulationPeriodIssue(
      issues,
      "blocked",
      "end_service_date_not_observed",
      null,
      [endServiceDate],
    );
  }

  const requiredPointCount = input.returnStepCount + 1;
  const endIndex = unionAxisDates.indexOf(endServiceDate);
  const startIndex = endIndex - requiredPointCount + 1;
  let resolvedServiceDates: readonly string[] = [];
  if (endObserved && startIndex >= 0) {
    resolvedServiceDates = Object.freeze(
      unionAxisDates.slice(startIndex, endIndex + 1),
    );
  } else if (endObserved) {
    addSimulationPeriodIssue(
      issues,
      "incomplete",
      "insufficient_axis_points",
    );
  }

  const sortedIssues = sortSimulationPeriodIssues(issues);
  const status = sortedIssues.some((issue) => issue.severity === "blocked")
    ? ("blocked" as const)
    : sortedIssues.some((issue) => issue.severity === "incomplete")
      ? ("incomplete" as const)
      : ("ready" as const);
  const safeResolvedServiceDates =
    status === "blocked" ? Object.freeze([] as string[]) : resolvedServiceDates;

  return buildResult({
    status,
    endServiceDate,
    returnStepCount: input.returnStepCount,
    candidates: candidateAvailability,
    resolvedServiceDates: safeResolvedServiceDates,
    nearestPriorObservedServiceDate,
    priceAxisDates: prices.axisDates,
    fxAxisDates: fx.axisDates,
    unionAxisDates,
    acceptedPriceObservationCount: prices.acceptedObservationCount,
    acceptedFxObservationCount: fx.acceptedObservationCount,
    ignoredExternalPriceRowCount: prices.ignoredExternalRowCount,
    ignoredFuturePriceRowCount: prices.ignoredFutureRowCount,
    ignoredFutureFxRowCount: fx.ignoredFutureRowCount,
    ignoredNotRequiredFxRowCount: fx.ignoredNotRequiredRowCount,
    issues: sortedIssues,
  });
}

function buildResult({
  status,
  endServiceDate,
  returnStepCount,
  candidates,
  resolvedServiceDates,
  nearestPriorObservedServiceDate,
  priceAxisDates,
  fxAxisDates,
  unionAxisDates,
  acceptedPriceObservationCount,
  acceptedFxObservationCount,
  ignoredExternalPriceRowCount,
  ignoredFuturePriceRowCount,
  ignoredFutureFxRowCount,
  ignoredNotRequiredFxRowCount,
  issues,
}: {
  status: "ready" | "incomplete" | "blocked";
  endServiceDate: string | null;
  returnStepCount: number | null;
  candidates: readonly SimulationPeriodCandidateAvailability[];
  resolvedServiceDates: readonly string[];
  nearestPriorObservedServiceDate: string | null;
  priceAxisDates: readonly string[];
  fxAxisDates: readonly string[];
  unionAxisDates: readonly string[];
  acceptedPriceObservationCount: number;
  acceptedFxObservationCount: number;
  ignoredExternalPriceRowCount: number;
  ignoredFuturePriceRowCount: number;
  ignoredFutureFxRowCount: number;
  ignoredNotRequiredFxRowCount: number;
  issues: readonly SimulationPeriodIssue[];
}) {
  const requiredPointCount =
    returnStepCount === null ? null : returnStepCount + 1;
  const axisResolved =
    requiredPointCount !== null &&
    resolvedServiceDates.length === requiredPointCount;

  return Object.freeze({
    status,
    axisStatus: axisResolved ? ("resolved" as const) : ("unresolved" as const),
    phase0BStatus:
      axisResolved && status !== "blocked"
        ? ("eligible_for_evidence_review" as const)
        : ("blocked" as const),
    policy: SIMULATION_PERIOD_REQUEST_POLICY,
    request: Object.freeze({
      endServiceDate,
      returnStepCount,
      requiredPointCount,
    }),
    endpoint: Object.freeze({
      requestedEndServiceDate: endServiceDate,
      resolvedEndServiceDate: axisResolved ? endServiceDate : null,
      nearestPriorObservedServiceDate,
    }),
    resolvedServiceDates: Object.freeze([...resolvedServiceDates]),
    candidates: Object.freeze(candidates.map((row) => Object.freeze(row))),
    axisSources: Object.freeze({
      acceptedPriceObservationCount,
      acceptedFxObservationCount,
      priceAxisPointCount: priceAxisDates.length,
      fxAxisPointCount: fxAxisDates.length,
      unionAxisPointCount: unionAxisDates.length,
      ignoredExternalPriceRowCount,
      ignoredFuturePriceRowCount,
      ignoredFutureFxRowCount,
      ignoredNotRequiredFxRowCount,
    }),
    issues: Object.freeze([...issues]),
  });
}

function validReturnStepCount(value: number) {
  return Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= SIMULATION_PERIOD_REQUEST_POLICY.maxReturnStepCount
    ? value
    : null;
}
