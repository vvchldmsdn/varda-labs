import { buildSimulationOwnerEconomicResearch } from "./simulation-owner-economic-research.ts";
import { buildSimulationOwnerEconomicCandidates } from "./simulation-owner-economic-candidates.ts";
import { buildSimulationOwnerParametricFactorResearch } from "./simulation-owner-parametric-factor.ts";
import { calculateWeightedObservedHistoricalOutcome } from "./simulation-historical-outcome-engine.ts";
import { buildSimulationHistoricalOutcomeReadyRow, type SimulationHistoricalOutcomeObservation } from "./simulation-historical-outcome-comparison.ts";
import { sliceReadySimulationReturnMatrix } from "./simulation-historical-outcome-validation-matrix.ts";
import {
  buildSimulationOwnerHistoricalValidationEndpointDates,
  isOwnerHistoricalValidationSourceMatrix,
  type SimulationOwnerHistoricalValidationEndpoint,
} from "./simulation-owner-historical-outcome-validation.ts";
import type { SimulationOwnerResearchExecutionResult } from "./simulation-owner-research-execution.ts";
import type { SimulationRegimeFactorObservation } from "./simulation-regime-bootstrap-policy.ts";
import { SIMULATION_OWNER_OUTCOME_SEARCH_POLICY } from "./simulation-owner-outcome-optimizer.ts";
import type { SimulationOwnerResearchWeight } from "./simulation-owner-constrained-min-volatility.ts";

export const SIMULATION_OWNER_ECONOMIC_VALIDATION_POLICY = Object.freeze({
  version: "simulation_owner_economic_validation_v1",
  maximumEndpointCount: 3,
  trainingReturnStepCount: 90,
  outcomeReturnStepCount: 21,
  sourceReturnStepCount: 111,
  endpointStrideReturnStepCount: 21,
  fitting: "model_and_candidate_search_use_training_window_only",
  candidateConfirmation: "held_out_simulated_paths_before_observed_outcome",
  outcomeSelection: "publish_all_admitted_candidates_even_when_observed_result_is_worse",
  currentComposition: "retrospective_current_weights_not_historical_positions",
  baseline: "unconditional_factor_model_same_training_window_and_current_weights",
  modelRanking: "forbidden",
  transactionCostBps: 0,
  taxBps: 0,
  pointInTimeAvailability: "not_established",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
} as const);

export type SimulationOwnerEconomicValidationResult = ReturnType<typeof buildSimulationOwnerEconomicValidation>;

export function buildSimulationOwnerEconomicValidation(input: {
  execution: SimulationOwnerResearchExecutionResult;
  availableServiceDates: readonly string[];
  endpoints: readonly SimulationOwnerHistoricalValidationEndpoint[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  const base = { account: input.execution.account, policy: SIMULATION_OWNER_ECONOMIC_VALIDATION_POLICY };
  if (input.execution.status !== "ready" || input.execution.endSelection.status !== "valid") {
    return result(base, [], "owner_execution_unavailable");
  }
  const expectedDates = buildSimulationOwnerHistoricalValidationEndpointDates(
    input.execution.endSelection.endServiceDate, input.availableServiceDates,
  ).slice(0, SIMULATION_OWNER_ECONOMIC_VALIDATION_POLICY.maximumEndpointCount);
  const endpoints = input.endpoints.slice(0, SIMULATION_OWNER_ECONOMIC_VALIDATION_POLICY.maximumEndpointCount);
  if (endpoints.length !== expectedDates.length || endpoints.some((row, index) => row.outcomeEndServiceDate !== expectedDates[index])) {
    return result(base, [], "endpoint_set_mismatch");
  }
  if (endpoints.length === 0) return result(base, [], "insufficient_history");
  const weights = input.execution.executionWeights;
  return result(base, endpoints.map((endpoint) => buildEndpoint({
    account: input.execution.account,
    endpoint,
    weights,
    availableServiceDates: input.availableServiceDates,
    factorRows: input.factorRows,
  })));
}

function buildEndpoint(input: {
  account: string;
  endpoint: SimulationOwnerHistoricalValidationEndpoint;
  weights: readonly SimulationOwnerResearchWeight[];
  availableServiceDates: readonly string[];
  factorRows: readonly SimulationRegimeFactorObservation[];
}) {
  const { endpoint } = input;
  const matrix = endpoint.matrix;
  const end = endpoint.outcomeEndServiceDate;
  const unavailable = (reason: string) => Object.freeze({
    status: "unavailable" as const, reason, outcomeEndServiceDate: end,
    trainingEndServiceDate: null, outcomeStartServiceDate: null,
    models: null, currentObserved: null, candidateStatus: "unavailable" as const,
    candidateReason: reason, candidates: Object.freeze([]), source: null,
  });
  if (!matrix || matrix.status !== "ready") return unavailable("input_matrix_unavailable");
  const weightsByKey = new Map(input.weights.map((row) => [row.instrumentKey, row.weightBps]));
  const identities = new Map(input.weights.map((row) => [row.instrumentKey, row]));
  const axisEnd = input.availableServiceDates.indexOf(end);
  const expectedAxis = input.availableServiceDates.slice(axisEnd - 111, axisEnd + 1);
  if (!isOwnerHistoricalValidationSourceMatrix(matrix, end, weightsByKey) ||
    matrix.requestedServiceDates.some((date, index) => date !== expectedAxis[index]) ||
    matrix.instruments.some((row) => {
      const expected = identities.get(row.instrumentKey);
      return !expected || expected.market !== row.market || expected.currency !== row.currency || expected.ticker !== row.ticker;
    })) return unavailable("input_matrix_shape_mismatch");

  const trainingMatrix = sliceReadySimulationReturnMatrix(matrix, 0, 90);
  const outcomeRows = matrix.matrix.slice(90);
  const trainingEndServiceDate = trainingMatrix.requestedServiceDates.at(-1)!;
  const outcomeStartServiceDate = outcomeRows[0]?.serviceDate;
  const weights = matrix.instruments.map((row) => ({ ...row, weightBps: weightsByKey.get(row.instrumentKey)! }));
  // Both model fitting and candidate search see only this historical cutoff.
  // Releases in the outcome window are not even passed to either model.
  const trainingFactors = input.factorRows.filter((row) => row.releaseDate < trainingEndServiceDate);
  const modelInput = {
    account: input.account, matrix: trainingMatrix, weights, horizon: 21,
    factorRows: trainingFactors, ownerExecutionReady: true,
  };
  const economic = buildSimulationOwnerEconomicResearch({ ...modelInput, stateAsOfServiceDate: trainingEndServiceDate });
  if (economic.status !== "ready") return unavailable(`economic_model:${economic.reason}`);
  const comparison = buildSimulationOwnerEconomicCandidates({ economic });
  if (comparison.status !== "ready") return unavailable(`economic_candidates:${comparison.reason}`);
  const currentObserved = calculateWeightedObservedHistoricalOutcome(outcomeRows, weights.map((row) => row.weightBps));
  if (!currentObserved || !outcomeStartServiceDate) return unavailable("observed_path_unavailable");
  const dates = { outcomeEndServiceDate: end, trainingEndServiceDate, outcomeStartServiceDate };
  const baseline = buildSimulationOwnerParametricFactorResearch(modelInput);
  const economicCheck = modelCheck(dates, comparison.currentExecution.terminal, currentObserved);
  const baselineCheck = baseline.status === "ready" ? modelCheck(dates, baseline.terminal, currentObserved) : null;
  const candidates = comparison.outcomeCandidates.flatMap((candidate) => {
    const observed = calculateWeightedObservedHistoricalOutcome(outcomeRows, candidate.weights.map((row) => row.candidateWeightBps));
    if (!observed) return [];
    return [Object.freeze({
      objective: candidate.objective,
      weights: candidate.weights,
      constraints: candidate.constraints,
      search: candidate.search,
      confirmation: candidate.confirmation,
      observed,
      predictionCheck: modelCheck(dates, candidate.execution.terminal, observed),
      actualReturnDeltaPctPoints: observed.terminalReturnPct - currentObserved.terminalReturnPct,
      actualMddDeltaPctPoints: observed.maxDrawdownPct - currentObserved.maxDrawdownPct,
    })];
  });
  return Object.freeze({
    status: "ready" as const,
    reason: null,
    ...dates,
    models: Object.freeze({
      economic: economicCheck,
      baseline: baselineCheck,
      baselineStatus: baseline.status,
      baselineReason: baseline.reason,
    }),
    currentObserved,
    candidateStatus: comparison.candidateStatus,
    candidateReason: comparison.candidateReason,
    candidates: Object.freeze(candidates),
    source: Object.freeze({
      trainingReturnStepCount: 90,
      outcomeReturnStepCount: 21,
      stateAsOfServiceDate: economic.source.stateAsOfServiceDate,
      factorAlignedObservationCount: economic.source.alignedObservationCount,
      factorGapRowCount: economic.source.factorGapRowCount,
    }),
  });
}

type TerminalSummary = {
  p10Index: number; p50ReturnPct: number; p90Index: number;
  lossProbabilityPct: number; maxDrawdownP50Pct: number; maxDrawdownP90Pct: number;
};
function modelCheck(
  dates: { outcomeEndServiceDate: string; trainingEndServiceDate: string; outcomeStartServiceDate: string },
  terminal: TerminalSummary,
  observed: SimulationHistoricalOutcomeObservation,
) {
  const row = buildSimulationHistoricalOutcomeReadyRow({
    ...dates,
    trainingReturnStepCount: 90,
    outcomeReturnStepCount: 21,
    predicted: {
      p10ReturnPct: terminal.p10Index - 100,
      p50ReturnPct: terminal.p50ReturnPct,
      p90ReturnPct: terminal.p90Index - 100,
      lossProbabilityPct: terminal.lossProbabilityPct,
      maxDrawdownP50Pct: terminal.maxDrawdownP50Pct,
      maxDrawdownP90Pct: terminal.maxDrawdownP90Pct,
    },
    observed,
  });
  return Object.freeze({ ...row, lossBrierScore: (terminal.lossProbabilityPct / 100 - Number(observed.terminalLoss)) ** 2 });
}

type EndpointRow = ReturnType<typeof buildEndpoint>;
function result(
  base: { account: string; policy: typeof SIMULATION_OWNER_ECONOMIC_VALIDATION_POLICY },
  rows: readonly EndpointRow[],
  explicitReason?: string,
) {
  const ready = rows.filter((row) => row.status === "ready");
  const paired = ready.flatMap((row) => row.models.baseline ? [{ economic: row.models.economic, baseline: row.models.baseline }] : []);
  const status = ready.length === 0 ? "unavailable" as const : ready.length === rows.length ? "ready" as const : "partial" as const;
  return Object.freeze({
    ...base,
    status,
    reason: explicitReason ?? (status === "ready" ? null : status === "partial" ? "some_endpoints_unavailable" : "all_endpoints_unavailable"),
    rows: Object.freeze(rows),
    summary: Object.freeze({
      endpointCount: rows.length,
      readyEndpointCount: ready.length,
      pairedModelEndpointCount: paired.length,
      candidateEvaluationCount: ready.reduce((sum, row) => sum + row.candidates.length, 0),
      economic: summarizeChecks(paired.map((row) => row.economic)),
      baseline: summarizeChecks(paired.map((row) => row.baseline)),
      objectives: Object.freeze(SIMULATION_OWNER_OUTCOME_SEARCH_POLICY.objectives.map((objective) => {
        const candidates = ready.flatMap((row) => row.candidates.filter((candidate) => candidate.objective === objective));
        return Object.freeze({
          objective,
          evaluatedEndpointCount: candidates.length,
          observedImprovementCount: candidates.filter((candidate) => candidate.actualReturnDeltaPctPoints > 0).length,
          meanActualReturnDeltaPctPoints: meanOrNull(candidates.map((candidate) => candidate.actualReturnDeltaPctPoints)),
          meanActualMddDeltaPctPoints: meanOrNull(candidates.map((candidate) => candidate.actualMddDeltaPctPoints)),
        });
      })),
    }),
  });
}

function summarizeChecks(rows: readonly ReturnType<typeof modelCheck>[]) {
  return Object.freeze({
    endpointCount: rows.length,
    bandCoveragePct: rows.length ? 100 * rows.filter((row) => row.inP10P90Band).length / rows.length : null,
    meanAbsoluteP50ErrorPctPoints: meanOrNull(rows.map((row) => row.absoluteP50ErrorPctPoints)),
    meanLossBrierScore: meanOrNull(rows.map((row) => row.lossBrierScore)),
    meanAbsoluteMddP50ErrorPctPoints: meanOrNull(rows.map((row) => row.absoluteMddP50ErrorPctPoints)),
  });
}

function meanOrNull(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
