import {
  buildSimulationRegimeFactorSourceSummaries,
  normalizeSimulationRegimeFactorRows,
  resolveSimulationRegimeFactorVector,
} from "./simulation-regime-factor-series.ts";
import {
  SIMULATION_REGIME_FACTOR_DEFINITIONS,
  type SimulationRegimeFactorObservation,
} from "./simulation-regime-bootstrap-policy.ts";
import {
  simulateFactorResidualModel,
  SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY,
} from "./simulation-factor-residual-model.ts";
import { summarizeSimulationNavPaths } from "./simulation-nav-path-summary.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY = Object.freeze({
  version: "simulation_owner_parametric_factor_research_v1",
  accountAuthority: "resolved_server_tenant_context",
  sourceReturnKind: "krw_investor_simple_return",
  modeledReturnKind: "log_return",
  factorAsOfPolicy: "latest_release_date_strictly_before_state_date",
  factorMaximumCarryDays: 7,
  factorTransforms: Object.freeze({
    usdkrw: "log_level_change",
    us_10y_yield: "percentage_point_change",
    us_10y2y_curve: "percentage_point_change",
  }),
  pathCount: 500,
  samplePathCount: 12,
  seed: 0x46414354,
  modelPolicyVersion: SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.version,
  pointInTimeAvailability: "not_established",
  vintageAuthority: "not_established",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  fallback: "forbidden",
  interpretation: "retrospective_research_distribution_not_forecast",
} as const);

export type SimulationOwnerParametricFactorResult = ReturnType<
  typeof buildSimulationOwnerParametricFactorResearch
>;

type OwnerWeight = Readonly<{
  instrumentKey: string;
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
}>;

export function buildSimulationOwnerParametricFactorResearch(input: {
  account: string;
  matrix: SimulationReturnMatrixResult | null;
  weights: readonly OwnerWeight[];
  horizon: number | null;
  factorRows: readonly SimulationRegimeFactorObservation[];
  ownerExecutionReady: boolean;
}) {
  const base = Object.freeze({
    id: `owner-factor-residual-${input.account}`,
    name: "환율·금리 요인 모형",
    account: input.account,
    policy: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY,
  });
  if (
    !input.ownerExecutionReady ||
    !input.matrix ||
    input.matrix.status !== "ready" ||
    input.horizon === null
  ) {
    return unavailable(base, "owner_research_unavailable", input.matrix);
  }
  if (
    input.weights.length !== input.matrix.instruments.length ||
    input.weights.reduce((sum, row) => sum + row.weightBps, 0) !== 10_000 ||
    input.weights.some(
      (row, index) =>
        row.instrumentKey !== input.matrix?.instruments[index]?.instrumentKey ||
        row.weightBps < 0,
    )
  ) {
    return unavailable(base, "weight_identity_mismatch", input.matrix);
  }

  const factorSeries = normalizeSimulationRegimeFactorRows(input.factorRows);
  if (!factorSeries) {
    return unavailable(base, "invalid_factor_evidence", input.matrix);
  }
  const alignedRows: Array<
    Readonly<{
      serviceDate: string;
      assetLogReturns: readonly number[];
      factorChanges: readonly number[];
    }>
  > = [];
  let factorGapRowCount = 0;
  for (const matrixRow of input.matrix.matrix) {
    const previous = resolveSimulationRegimeFactorVector(
      factorSeries,
      matrixRow.previousServiceDate,
      true,
    );
    const current = resolveSimulationRegimeFactorVector(
      factorSeries,
      matrixRow.serviceDate,
      true,
    );
    if (previous.status !== "ready" || current.status !== "ready") {
      factorGapRowCount += 1;
      continue;
    }
    const previousLevels = factorLevels(previous.values);
    const currentLevels = factorLevels(current.values);
    const factorChanges = transformFactorLevels(previousLevels, currentLevels);
    const cellByKey = new Map(
      matrixRow.cells.map((cell) => [cell.instrumentKey, cell]),
    );
    const assetLogReturns = input.matrix.instruments.map((instrument) => {
      const value = cellByKey.get(instrument.instrumentKey)?.value;
      return typeof value === "number" && Number.isFinite(value) && value > -1
        ? Math.log1p(value)
        : Number.NaN;
    });
    if (
      !factorChanges ||
      assetLogReturns.some((value) => !Number.isFinite(value))
    ) {
      factorGapRowCount += 1;
      continue;
    }
    alignedRows.push(
      Object.freeze({
        serviceDate: matrixRow.serviceDate,
        assetLogReturns: Object.freeze(assetLogReturns),
        factorChanges: Object.freeze(factorChanges),
      }),
    );
  }

  const source = buildSource(input.matrix, alignedRows, factorGapRowCount);
  if (
    alignedRows.length <
    SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.minimumObservationCount
  ) {
    return unavailable(
      base,
      "insufficient_factor_overlap",
      input.matrix,
      source,
      buildSimulationRegimeFactorSourceSummaries(
        factorSeries,
        input.matrix.requestedServiceDates.at(-1) ?? "",
        input.matrix.matrix.map((row) => row.serviceDate),
      ),
    );
  }

  const model = simulateFactorResidualModel({
    assetKeys: input.matrix.instruments.map((row) => row.instrumentKey),
    factorKeys: SIMULATION_REGIME_FACTOR_DEFINITIONS.map(
      (row) => row.factorKey,
    ),
    observations: alignedRows,
    weights: input.weights.map((row) => row.weightBps / 10_000),
    horizon: input.horizon,
    pathCount: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.pathCount,
    seed: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.seed,
  });
  if (model.status !== "ready") {
    return unavailable(
      base,
      model.reason,
      input.matrix,
      source,
      buildSimulationRegimeFactorSourceSummaries(
        factorSeries,
        input.matrix.requestedServiceDates.at(-1) ?? "",
        input.matrix.matrix.map((row) => row.serviceDate),
      ),
    );
  }
  const summary = summarizeSimulationNavPaths({
    paths: model.paths,
    horizon: input.horizon,
    samplePathCount: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.samplePathCount,
  });
  if (summary.status !== "ready") {
    return unavailable(
      base,
      "path_summary_unavailable",
      input.matrix,
      source,
    );
  }

  const instrumentByKey = new Map(
    input.matrix.instruments.map((row) => [row.instrumentKey, row]),
  );
  return Object.freeze({
    ...base,
    status: "ready" as const,
    reason: null,
    assumptions: Object.freeze({
      horizon: input.horizon,
      pathCount: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.pathCount,
      seed: SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.seed,
      studentTDegreesOfFreedom:
        SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.studentTDegreesOfFreedom,
      ewmaDecay: SIMULATION_FACTOR_RESIDUAL_MODEL_POLICY.ewmaDecay,
    }),
    terminal: summary.terminal,
    bands: summary.bands,
    samplePaths: summary.samplePaths,
    executionWeights: Object.freeze(
      input.weights.map((row) => Object.freeze({ ...row })),
    ),
    source,
    factorSources: buildSimulationRegimeFactorSourceSummaries(
      factorSeries,
      input.matrix.requestedServiceDates.at(-1) ?? "",
      input.matrix.matrix.map((row) => row.serviceDate),
    ),
    diagnostics: model.diagnostics,
    exposures: Object.freeze(
      model.exposures.map((exposure) => {
        const instrument = instrumentByKey.get(exposure.assetKey);
        return Object.freeze({
          instrumentKey: exposure.assetKey,
          ticker: instrument?.ticker ?? exposure.assetKey,
          market: instrument?.market ?? "unknown",
          currency: instrument?.currency ?? "unknown",
          rSquared: exposure.rSquared,
          standardizedBetas: exposure.standardizedBetas,
        });
      }),
    ),
  });
}

function factorLevels(values: readonly number[]) {
  return [values[0], values[2], values[4]] as const;
}

function transformFactorLevels(
  previous: readonly [number, number, number],
  current: readonly [number, number, number],
) {
  if (
    previous[0] <= 0 ||
    current[0] <= 0 ||
    [...previous, ...current].some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const changes = [
    Math.log(current[0] / previous[0]),
    current[1] - previous[1],
    current[2] - previous[2],
  ];
  return changes.every(Number.isFinite) ? changes : null;
}

function buildSource(
  matrix: SimulationReturnMatrixResult,
  alignedRows: readonly Readonly<{ serviceDate: string }>[],
  factorGapRowCount: number,
) {
  return Object.freeze({
    matrixRowCount: matrix.matrix.length,
    alignedObservationCount: alignedRows.length,
    factorGapRowCount,
    firstAlignedServiceDate: alignedRows[0]?.serviceDate ?? null,
    lastAlignedServiceDate: alignedRows.at(-1)?.serviceDate ?? null,
    matrixEndServiceDate: matrix.requestedServiceDates.at(-1) ?? null,
  });
}

type UnavailableReason =
  | "owner_research_unavailable"
  | "weight_identity_mismatch"
  | "invalid_factor_evidence"
  | "insufficient_factor_overlap"
  | "invalid_input"
  | "insufficient_observations"
  | "factor_covariance_not_positive_definite"
  | "residual_covariance_not_positive_definite"
  | "simulation_nonfinite"
  | "path_summary_unavailable";

function unavailable(
  base: Readonly<{
    id: string;
    name: string;
    account: string;
    policy: typeof SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY;
  }>,
  reason: UnavailableReason,
  matrix: SimulationReturnMatrixResult | null,
  source?: ReturnType<typeof buildSource>,
  factorSources: ReturnType<
    typeof buildSimulationRegimeFactorSourceSummaries
  > = Object.freeze([]),
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
    source:
      source ??
      Object.freeze({
        matrixRowCount: matrix?.matrix.length ?? 0,
        alignedObservationCount: 0,
        factorGapRowCount: matrix?.matrix.length ?? 0,
        firstAlignedServiceDate: null,
        lastAlignedServiceDate: null,
        matrixEndServiceDate:
          matrix?.requestedServiceDates.at(-1) ?? null,
      }),
    factorSources,
    diagnostics: null,
    exposures: Object.freeze([]),
  });
}
