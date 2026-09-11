import { isRiskDate, riskCalendarDayDistance } from "./portfolio-risk-calendar.ts";
import { SIMULATION_REGIME_FACTOR_DEFINITIONS, type SimulationRegimeFactorObservation } from "./simulation-regime-bootstrap-policy.ts";
import {
  SIMULATION_ECONOMIC_STATE_MODEL_POLICY, evaluateEconomicStatePaths,
  simulateEconomicStateModel, type EconomicFactorState, type EconomicStateObservation,
} from "./simulation-economic-state-model.ts";
import { summarizeSimulationNavPaths } from "./simulation-nav-path-summary.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY = Object.freeze({
  version: "simulation_owner_economic_state_research_v1",
  modelPolicyVersion: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.version,
  accountAuthority: "resolved_server_tenant_context",
  sourceReturnKind: "krw_investor_simple_return",
  modeledReturnKind: "log_return",
  factorAsOfPolicy: "latest_release_date_strictly_before_state_date",
  factorMaximumCarryDays: 7,
  freshnessBasis: "maximum_age_of_release_factor_and_period_end_dates",
  factorTransforms: Object.freeze({ usdkrw: "log_level_change", us_10y_yield: "percentage_point_change", us_10y2y_curve: "percentage_point_change" }),
  pathCount: 1000,
  samplePathCount: 12,
  seed: 0x45434f4e,
  minimumObservationCount: 45,
  maximumObservationCount: 90,
  pointInTimeAvailability: "not_established",
  vintageAuthority: "not_established",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  fallback: "forbidden",
  preparedPaths: "server_computation_only_omit_from_client_dto",
  interpretation: "conditional_research_distribution_not_validated_forecast",
} as const);

type OwnerWeight = Readonly<{ instrumentKey: string; market: string; currency: string; ticker: string; weightBps: number }>;
type FactorKey = (typeof SIMULATION_REGIME_FACTOR_DEFINITIONS)[number]["factorKey"];
type LevelObservation = Readonly<{ factorKey: FactorKey; factorDate: string; periodEndDate: string; releaseDate: string; value: number }>;
type FactorSeries = Map<FactorKey, LevelObservation[]>;
type AlignedObservation = EconomicStateObservation & Readonly<{ serviceDate: string }>;

export type SimulationOwnerEconomicResearchInput = Readonly<{
  account: string;
  matrix: SimulationReturnMatrixResult | null;
  weights: readonly OwnerWeight[];
  horizon: number | null;
  factorRows: readonly SimulationRegimeFactorObservation[];
  ownerExecutionReady: boolean;
  /** Caller supplies the current service date for current-state research, or the
   * training cutoff for retrospective validation. Omitted means matrix end. */
  stateAsOfServiceDate?: string;
  includeDisplayPaths?: boolean;
}>;
export type SimulationOwnerEconomicResearchResult = ReturnType<typeof buildSimulationOwnerEconomicResearch>;
export type ReadySimulationOwnerEconomicResearch = Extract<SimulationOwnerEconomicResearchResult, { status: "ready" }>;

export function buildSimulationOwnerEconomicResearch(input: SimulationOwnerEconomicResearchInput) {
  const policy = SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY;
  const base = Object.freeze({ id: `owner-economic-state-${input.account}`, name: "현재 경제 상태 조건부 모형", account: input.account, policy });
  const asOf = input.stateAsOfServiceDate ?? input.matrix?.requestedServiceDates.at(-1) ?? "";
  if (!input.ownerExecutionReady || !input.matrix || input.matrix.status !== "ready" || input.horizon === null) {
    return unavailable(base, "owner_research_unavailable", buildSource(input.matrix, [], 0, asOf));
  }
  const matrix = input.matrix;
  if (!isRiskDate(asOf)) return unavailable(base, "invalid_state_as_of_date", buildSource(matrix, [], 0, asOf));
  if (
    input.weights.length !== matrix.instruments.length ||
    input.weights.reduce((sum, row) => sum + row.weightBps, 0) !== 10_000 ||
    input.weights.some((row, index) => {
      const instrument = matrix.instruments[index];
      return !Number.isInteger(row.weightBps) || row.weightBps < 0 ||
        row.instrumentKey !== instrument?.instrumentKey || row.market !== instrument?.market ||
        row.currency !== instrument?.currency || row.ticker !== instrument?.ticker;
    })
  ) return unavailable(base, "weight_identity_mismatch", buildSource(matrix, [], 0, asOf));
  const series = normalizeLevelRows(input.factorRows, asOf);
  if (!series) return unavailable(base, "invalid_factor_evidence", buildSource(matrix, [], 0, asOf));
  const stateDates = matrix.matrix.filter((row) => row.serviceDate <= asOf).map((row) => row.serviceDate);
  const factorSources = sourceSummaries(series, asOf, stateDates);
  const initial = resolveLevels(series, asOf);
  if (initial.status !== "ready") {
    return unavailable(base, initial.status === "stale" ? "current_factor_state_stale" : "current_factor_state_missing", buildSource(matrix, [], 0, asOf), factorSources);
  }
  const currentFactors = Object.freeze(initial.rows.map((row, index) => Object.freeze({
    factorKey: row.factorKey, label: SIMULATION_REGIME_FACTOR_DEFINITIONS[index].label,
    unit: factorUnit(index), value: row.value, transformedValue: initial.state[index],
    asOfServiceDate: asOf, factorDate: row.factorDate, periodEndDate: row.periodEndDate,
    releaseDate: row.releaseDate, carryDays: observationAge(row, asOf),
  })));
  const eligibleRows = matrix.matrix.filter((row) => row.serviceDate <= asOf).slice(-policy.maximumObservationCount);
  const aligned: AlignedObservation[] = [];
  let factorGapRowCount = 0;
  for (let index = 0; index < eligibleRows.length; index += 1) {
    const row = eligibleRows[index];
    if (!isRiskDate(row.serviceDate) || !isRiskDate(row.previousServiceDate) || row.previousServiceDate >= row.serviceDate ||
      (index > 0 && row.serviceDate <= eligibleRows[index - 1].serviceDate)) {
      return unavailable(base, "invalid_input", buildSource(matrix, aligned, factorGapRowCount, asOf), factorSources);
    }
    const previous = resolveLevels(series, row.previousServiceDate);
    const current = resolveLevels(series, row.serviceDate);
    if (previous.status !== "ready" || current.status !== "ready") {
      factorGapRowCount += 1;
      continue;
    }
    const cells = new Map(row.cells.map((cell) => [cell.instrumentKey, cell]));
    if (cells.size !== matrix.instruments.length || row.cells.length !== matrix.instruments.length) {
      return unavailable(base, "invalid_input", buildSource(matrix, aligned, factorGapRowCount, asOf), factorSources);
    }
    const assetLogReturns = matrix.instruments.map((instrument) => {
      const cell = cells.get(instrument.instrumentKey);
      const value = cell?.value;
      return cell?.previous.status === "ready" && cell.current.status === "ready" && typeof value === "number" && Number.isFinite(value) && value > -1 ? Math.log1p(value) : Number.NaN;
    });
    if (assetLogReturns.some((value) => !Number.isFinite(value))) {
      return unavailable(base, "invalid_input", buildSource(matrix, aligned, factorGapRowCount, asOf), factorSources);
    }
    aligned.push(Object.freeze({ serviceDate: row.serviceDate, previousFactorState: previous.state,
      factorChanges: Object.freeze(current.state.map((value, i) => value - previous.state[i])) as EconomicFactorState,
      assetLogReturns: Object.freeze(assetLogReturns),
    }));
  }
  const source = buildSource(matrix, aligned, factorGapRowCount, asOf);
  if (aligned.length < policy.minimumObservationCount) return unavailable(base, "insufficient_factor_overlap", source, factorSources);
  const model = simulateEconomicStateModel({
    assetKeys: matrix.instruments.map((row) => row.instrumentKey), observations: aligned,
    initialFactorState: initial.state, horizon: input.horizon, pathCount: policy.pathCount, seed: policy.seed,
  });
  if (model.status !== "ready") return unavailable(base, model.reason, source, factorSources);
  const evaluated = evaluateEconomicStatePaths({ prepared: model.prepared, weights: input.weights.map((row) => row.weightBps / 10_000) });
  if (evaluated.status !== "ready") return unavailable(base, "path_summary_unavailable", source, factorSources);
  const summary = summarizeSimulationNavPaths({ paths: evaluated.paths, horizon: input.horizon, samplePathCount: policy.samplePathCount,
    includeDisplayPaths: input.includeDisplayPaths });
  if (summary.status !== "ready") return unavailable(base, "path_summary_unavailable", source, factorSources);
  return Object.freeze({
    ...base, status: "ready" as const, reason: null,
    assumptions: Object.freeze({
      horizon: input.horizon, pathCount: policy.pathCount, seed: policy.seed,
      studentTDegreesOfFreedom: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.studentTDegreesOfFreedom,
      ewmaDecay: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.ewmaDecay,
      maximumLocalBlend: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.maximumLocalBlend,
      conditioning: SIMULATION_ECONOMIC_STATE_MODEL_POLICY.conditioning,
      stateAsOfServiceDate: asOf,
    }),
    terminal: summary.terminal, bands: summary.bands, samplePaths: summary.samplePaths,
    displayPaths: summary.displayPaths,
    prepared: model.prepared,
    executionWeights: Object.freeze(input.weights.map((row) => Object.freeze({ ...row }))),
    source, factorSources, currentFactors, factorBands: model.factorBands, diagnostics: model.diagnostics,
    remediation: null,
    exposures: Object.freeze(model.exposures.map((row, index) => Object.freeze({
      instrumentKey: row.assetKey, ticker: matrix.instruments[index].ticker,
      market: matrix.instruments[index].market, currency: matrix.instruments[index].currency,
      intercept: row.intercept, betas: row.betas, rSquared: row.rSquared, standardizedBetas: row.standardizedBetas,
    }))),
  });
}

// Only levels are needed here. A missing precomputed volatility statistic must
// not reject otherwise admitted levels: model covariance is fitted from changes.
function normalizeLevelRows(rows: readonly SimulationRegimeFactorObservation[], asOf: string): FactorSeries | null {
  const series: FactorSeries = new Map(SIMULATION_REGIME_FACTOR_DEFINITIONS.map((row) => [row.factorKey, []]));
  for (const row of rows) {
    if (!series.has(row.factorKey as FactorKey)) continue;
    if (!isRiskDate(row.releaseDate)) return null;
    if (row.releaseDate >= asOf) continue;
    if (!isRiskDate(row.factorDate) || !isRiskDate(row.periodEndDate) || row.factorDate > row.releaseDate || row.periodEndDate > row.releaseDate ||
      (typeof row.value === "string" && row.value.trim() === "")) return null;
    const value = typeof row.value === "number" ? row.value : Number(row.value);
    if (!Number.isFinite(value) || (row.factorKey === "usdkrw" && value <= 0)) return null;
    series.get(row.factorKey as FactorKey)!.push(Object.freeze({ factorKey: row.factorKey as FactorKey, factorDate: row.factorDate, periodEndDate: row.periodEndDate, releaseDate: row.releaseDate, value }));
  }
  for (const values of series.values()) {
    values.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
    if (values.some((row, index) => index > 0 && row.releaseDate === values[index - 1].releaseDate)) return null;
  }
  return series;
}

function latestBefore(rows: readonly LevelObservation[], stateDate: string) {
  let low = 0;
  let high = rows.length - 1;
  let found: LevelObservation | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].releaseDate < stateDate) { found = rows[middle]; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}

function observationAge(row: LevelObservation, date: string) {
  return Math.max(riskCalendarDayDistance(row.releaseDate, date), riskCalendarDayDistance(row.factorDate, date), riskCalendarDayDistance(row.periodEndDate, date));
}

function resolveLevels(series: FactorSeries, date: string) {
  const rows: LevelObservation[] = [];
  for (const definition of SIMULATION_REGIME_FACTOR_DEFINITIONS) {
    const current = latestBefore(series.get(definition.factorKey) ?? [], date);
    if (!current) return { status: "missing" as const, state: null, rows: null };
    if (observationAge(current, date) > SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY.factorMaximumCarryDays) return { status: "stale" as const, state: null, rows: null };
    rows.push(current);
  }
  return { status: "ready" as const, rows,
    state: Object.freeze([Math.log(rows[0].value), rows[1].value, rows[2].value]) as EconomicFactorState,
  };
}

function sourceSummaries(series: FactorSeries, date: string, stateDates: readonly string[]) {
  return Object.freeze(SIMULATION_REGIME_FACTOR_DEFINITIONS.map((definition) => {
    const rows = series.get(definition.factorKey) ?? [];
    const current = latestBefore(rows, date);
    return Object.freeze({
      factorKey: definition.factorKey, label: definition.label,
      latestReleaseDate: rows.at(-1)?.releaseDate ?? null, currentReleaseDate: current?.releaseDate ?? null,
      currentCarryDays: current ? observationAge(current, date) : null,
      alignedStateCount: stateDates.filter((stateDate) => {
        const row = latestBefore(rows, stateDate);
        return row && observationAge(row, stateDate) <= SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY.factorMaximumCarryDays;
      }).length,
      availabilityTimestampStatus: "not_preserved" as const, vintageStatus: "not_preserved" as const,
    });
  }));
}

function factorUnit(index: number) {
  return index === 0 ? "KRW_per_USD" as const : index === 1 ? "percent" as const : "percentage_points" as const;
}

function buildSource(matrix: SimulationReturnMatrixResult | null, aligned: readonly Readonly<{ serviceDate: string }>[], gaps: number, asOf: string) {
  return Object.freeze({
    matrixRowCount: matrix?.matrix.length ?? 0, alignedObservationCount: aligned.length,
    requiredAlignedObservationCount: SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY.minimumObservationCount,
    observationShortfall: Math.max(0, SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY.minimumObservationCount - aligned.length),
    factorGapRowCount: gaps, firstAlignedServiceDate: aligned[0]?.serviceDate ?? null,
    lastAlignedServiceDate: aligned.at(-1)?.serviceDate ?? null,
    matrixEndServiceDate: matrix?.requestedServiceDates.at(-1) ?? null,
    stateAsOfServiceDate: asOf,
    excludedFutureMatrixRowCount: matrix?.matrix.filter((row) => row.serviceDate > asOf).length ?? 0,
  });
}

type UnavailableReason = "owner_research_unavailable" | "invalid_state_as_of_date" | "weight_identity_mismatch" | "invalid_factor_evidence" |
  "current_factor_state_stale" | "current_factor_state_missing" | "insufficient_factor_overlap" | "invalid_input" | "insufficient_observations" |
  "factor_covariance_not_positive_definite" | "residual_covariance_not_positive_definite" | "simulation_nonfinite" | "path_summary_unavailable";

function unavailable(base: Readonly<{ id: string; name: string; account: string; policy: typeof SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY }>, reason: UnavailableReason,
  source: ReturnType<typeof buildSource>, factorSources: ReturnType<typeof sourceSummaries> = Object.freeze([])) {
  return Object.freeze({
    ...base, status: "unavailable" as const, reason, assumptions: null, terminal: null,
    bands: Object.freeze([]), samplePaths: Object.freeze([]), displayPaths: null, prepared: null,
    executionWeights: Object.freeze([]), source, factorSources, currentFactors: Object.freeze([]), factorBands: Object.freeze([]), diagnostics: null,
    remediation: reason === "insufficient_factor_overlap" || reason === "current_factor_state_stale" || reason === "current_factor_state_missing" ? Object.freeze({
      code: "refresh_core_market_factor_history" as const,
      alignedObservationCount: source.alignedObservationCount,
      requiredAlignedObservationCount: source.requiredAlignedObservationCount,
      observationShortfall: source.observationShortfall,
    }) : null,
    exposures: Object.freeze([]),
  });
}
