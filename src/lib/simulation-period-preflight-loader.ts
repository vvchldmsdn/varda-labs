import { shiftRiskDate } from "./portfolio-risk-calendar.ts";
import {
  planSimulationPeriodPreflightScan,
  type SimulationPeriodPreflightRequest,
} from "./simulation-period-preflight-plan.ts";
import {
  SIMULATION_PERIOD_REQUEST_POLICY,
  resolveSimulationPeriodRequest,
} from "./simulation-period-request-resolver.ts";
import type {
  SimulationPeriodCandidateAvailability,
  SimulationPeriodIssue,
} from "./simulation-period-request-types.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "./simulation-return-matrix.ts";
import {
  loadSimulationReturnMatrixUniverseEvidence,
  type SimulationReturnMatrixReadRepository,
} from "./simulation-return-matrix-read-loader.ts";

export type { SimulationPeriodPreflightRequest } from "./simulation-period-preflight-plan.ts";

export async function loadSimulationPeriodPreflight(
  repository: SimulationReturnMatrixReadRepository,
  request: SimulationPeriodPreflightRequest,
) {
  const plan = planSimulationPeriodPreflightScan(request);
  if (plan.status === "blocked" || !plan.queryRange) {
    return buildPreflightResult({
      status: "axis_blocked",
      plan,
      axis: blockedAxisProjection(plan),
      matrixEvidence: null,
      scanOutcome: "request_blocked",
    });
  }

  const priceRowsPromise = repository.loadPriceRows({
    instruments: plan.candidates,
    sourceDateFrom: plan.queryRange.sourceDateFrom,
    sourceDateTo: plan.queryRange.sourceDateTo,
  });
  const fxRowsPromise = plan.requiresFx
    ? repository.loadFxRows({
        sourceDateFrom: plan.queryRange.sourceDateFrom,
        sourceDateTo: plan.queryRange.sourceDateTo,
      })
    : Promise.resolve([]);
  const [priceRows, fxRows] = await Promise.all([
    priceRowsPromise,
    fxRowsPromise,
  ]);
  const resolution = resolveSimulationPeriodRequest({
    candidates: request.candidates,
    endServiceDate: plan.endServiceDate,
    returnStepCount: plan.returnStepCount,
    priceRows,
    fxRows,
  });
  const axis = projectAxisResolution(resolution);

  if (resolution.phase0BStatus !== "eligible_for_evidence_review") {
    const insufficientWithinBound = resolution.issues.some(
      (issue) => issue.reason === "insufficient_axis_points",
    );
    return buildPreflightResult({
      status:
        resolution.status === "blocked"
          ? "axis_blocked"
          : "axis_incomplete",
      plan,
      axis,
      matrixEvidence: null,
      scanOutcome: insufficientWithinBound
        ? "insufficient_axis_within_scan_bound"
        : "axis_not_resolved",
    });
  }

  const matrixEvidence = await loadSimulationReturnMatrixUniverseEvidence(
    repository,
    {
      requestedServiceDates: resolution.resolvedServiceDates,
      instruments: request.candidates,
    },
  );
  return buildPreflightResult({
    status:
      matrixEvidence.status === "ready"
        ? "matrix_ready"
        : matrixEvidence.status === "blocked"
          ? "matrix_blocked"
          : "matrix_incomplete",
    plan,
    axis,
    matrixEvidence,
    scanOutcome: "axis_resolved",
  });
}

export async function loadSimulationPeriodPreflightBatch(
  repository: SimulationReturnMatrixReadRepository,
  requests: readonly SimulationPeriodPreflightRequest[],
) {
  if (requests.length === 0) return Object.freeze([]);

  const plans = requests.map(planSimulationPeriodPreflightScan);
  const queryablePlans = plans.filter(
    (plan) => plan.status === "queryable" && plan.queryRange,
  );
  if (queryablePlans.length === 0) {
    return Promise.all(
      requests.map((request) =>
        loadSimulationPeriodPreflight(EMPTY_READ_REPOSITORY, request),
      ),
    );
  }

  const axisSourceDateFrom = queryablePlans.reduce(
    (earliest, plan) =>
      plan.queryRange!.sourceDateFrom < earliest
        ? plan.queryRange!.sourceDateFrom
        : earliest,
    queryablePlans[0].queryRange!.sourceDateFrom,
  );
  const sourceDateFrom = shiftRiskDate(
    axisSourceDateFrom,
    -SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
  );
  const sourceDateTo = queryablePlans.reduce(
    (latest, plan) =>
      plan.queryRange!.sourceDateTo > latest
        ? plan.queryRange!.sourceDateTo
        : latest,
    queryablePlans[0].queryRange!.sourceDateTo,
  );
  const instruments = uniqueCandidates(
    queryablePlans.flatMap((plan) => plan.candidates),
  );
  const requiresFx = queryablePlans.some((plan) => plan.requiresFx);
  const [priceRows, fxRows] = await Promise.all([
    repository.loadPriceRows({
      instruments,
      sourceDateFrom,
      sourceDateTo,
    }),
    requiresFx
      ? repository.loadFxRows({ sourceDateFrom, sourceDateTo })
      : Promise.resolve([]),
  ]);
  const snapshotRepository = createSnapshotRepository(priceRows, fxRows);

  return Promise.all(
    requests.map((request) =>
      loadSimulationPeriodPreflight(snapshotRepository, request),
    ),
  );
}

const EMPTY_READ_REPOSITORY: SimulationReturnMatrixReadRepository = {
  async loadPriceRows() {
    return [];
  },
  async loadFxRows() {
    return [];
  },
};

function createSnapshotRepository(
  priceRows: Awaited<
    ReturnType<SimulationReturnMatrixReadRepository["loadPriceRows"]>
  >,
  fxRows: Awaited<
    ReturnType<SimulationReturnMatrixReadRepository["loadFxRows"]>
  >,
): SimulationReturnMatrixReadRepository {
  return {
    async loadPriceRows({ instruments, sourceDateFrom, sourceDateTo }) {
      const identities = new Set(
        instruments.map(
          (row) =>
            `${row.market.toLowerCase()}|${row.currency.toUpperCase()}|${row.ticker.toUpperCase()}`,
        ),
      );
      return priceRows.filter(
        (row) =>
          identities.has(
            `${row.market.toLowerCase()}|${row.currency.toUpperCase()}|${row.ticker.toUpperCase()}`,
          ) &&
          row.priceDate >= sourceDateFrom &&
          row.priceDate <= sourceDateTo,
      );
    },
    async loadFxRows({ sourceDateFrom, sourceDateTo }) {
      return fxRows.filter(
        (row) =>
          row.rateDate >= sourceDateFrom && row.rateDate <= sourceDateTo,
      );
    },
  };
}

function uniqueCandidates(
  candidates: readonly Readonly<{
    displayName?: string | null;
    market: string;
    currency: "KRW" | "USD";
    ticker: string;
  }>[],
) {
  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const key = `${candidate.market}|${candidate.currency}|${candidate.ticker}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return Object.freeze([...unique.values()]);
}

function buildPreflightResult({
  status,
  plan,
  axis,
  matrixEvidence,
  scanOutcome,
}: {
  status:
    | "axis_blocked"
    | "axis_incomplete"
    | "matrix_blocked"
    | "matrix_incomplete"
    | "matrix_ready";
  plan: ReturnType<typeof planSimulationPeriodPreflightScan>;
  axis: ReturnType<typeof projectAxisResolution>;
  matrixEvidence: Awaited<
    ReturnType<typeof loadSimulationReturnMatrixUniverseEvidence>
  > | null;
  scanOutcome:
    | "request_blocked"
    | "axis_not_resolved"
    | "insufficient_axis_within_scan_bound"
    | "axis_resolved";
}) {
  return Object.freeze({
    status,
    axisStatus:
      axis.resolvedServiceDates.length > 0
        ? ("axis_ready" as const)
        : status === "axis_incomplete"
          ? ("axis_incomplete" as const)
          : ("axis_blocked" as const),
    matrixStatus: matrixEvidence?.status ?? "not_run",
    scenarioVectorReviewStatus:
      matrixEvidence?.vectorReviewStatus ?? "blocked_until_matrix_ready",
    scan: Object.freeze({
      policy: plan.policy,
      outcome: scanOutcome,
      axisDiscovery: Object.freeze({
        status: plan.queryRange ? "completed" : "not_started",
        queryRange: plan.queryRange,
        priceRead: Boolean(plan.queryRange),
        fxRead: Boolean(plan.queryRange && plan.requiresFx),
      }),
      coverage: Object.freeze({
        status: matrixEvidence ? "completed" : "not_started",
        queryRange: matrixEvidence?.queryRange ?? null,
      }),
      automaticRetryPerformed: false,
    }),
    axis,
    matrixEvidence,
  });
}

function projectAxisResolution(
  resolution: ReturnType<typeof resolveSimulationPeriodRequest>,
) {
  return Object.freeze({
    status:
      resolution.axisStatus === "resolved"
        ? ("axis_ready" as const)
        : resolution.status === "incomplete"
          ? ("axis_incomplete" as const)
          : ("axis_blocked" as const),
    policyVersion: resolution.policy.version,
    request: resolution.request,
    endpoint: resolution.endpoint,
    resolvedServiceDates: resolution.resolvedServiceDates,
    candidates: resolution.candidates,
    axisSources: resolution.axisSources,
    issues: resolution.issues,
  });
}

function blockedAxisProjection(
  plan: ReturnType<typeof planSimulationPeriodPreflightScan>,
) {
  const candidates: SimulationPeriodCandidateAvailability[] =
    plan.candidates.map((candidate) => ({
      ...candidate,
      status: "missing",
      observationCount: 0,
      firstServiceDate: null,
      lastServiceDate: null,
    }));
  return Object.freeze({
    status: "axis_blocked" as const,
    policyVersion: SIMULATION_PERIOD_REQUEST_POLICY.version,
    request: Object.freeze({
      endServiceDate: plan.endServiceDate,
      returnStepCount: plan.returnStepCount,
      requiredPointCount: plan.requiredPointCount,
    }),
    endpoint: Object.freeze({
      requestedEndServiceDate: plan.endServiceDate,
      resolvedEndServiceDate: null,
      nearestPriorObservedServiceDate: null,
    }),
    resolvedServiceDates: Object.freeze([] as string[]),
    candidates: Object.freeze(candidates.map((row) => Object.freeze(row))),
    axisSources: Object.freeze({
      acceptedPriceObservationCount: 0,
      acceptedFxObservationCount: 0,
      priceAxisPointCount: 0,
      fxAxisPointCount: 0,
      unionAxisPointCount: 0,
      ignoredExternalPriceRowCount: 0,
      ignoredFuturePriceRowCount: 0,
      ignoredFutureFxRowCount: 0,
      ignoredNotRequiredFxRowCount: 0,
    }),
    issues: plan.issues as readonly SimulationPeriodIssue[],
  });
}
