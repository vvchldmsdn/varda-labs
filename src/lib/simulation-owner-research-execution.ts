import { allocateBasisPointsByValue, BASIS_POINT_TOTAL } from "./basis-point-allocation.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";
import type { SimulationOwnerInputCandidate } from "./simulation-owner-input-candidate.ts";
import type { SimulationOwnerInputPreflightModel } from "./simulation-owner-input-preflight.ts";
import {
  executeSimulationResearchPathsFromPrepared,
  prepareSimulationResearchPaths,
  type PreparedSimulationResearchPaths,
  type SimulationResearchExecutionBlockerReason,
} from "./simulation-research-execution-core.ts";
import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  type SimulationResearchHorizonSelection,
} from "./simulation-research-horizon.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY = Object.freeze({
  version: "simulation_owner_current_composition_research_v1",
  inputAuthority: "ephemeral_server_derived_current_value_research_only",
  accountAuthority: "resolved_server_tenant_context",
  sourceReturnStepCount: 90,
  defaultEndSelection: "latest_common_qualified_stored_observation",
  explicitEndSelection: "exact_query_date_only",
  historicalPriceBasis: "matrix_policy_explicit",
  partialEvidencePolicy:
    "execute_positive_weight_listed_subset_and_disclose_omissions",
  subsetWeightPolicy: "largest_remainder_current_value_to_10000bps",
  krxGoldPolicy: "omit_without_backcast_until_manual_history_exists",
  zeroWeightPolicy: "preserve_diagnostic_row_omit_from_execution_matrix",
  horizonPolicyVersion: SIMULATION_RESEARCH_HORIZON_POLICY.version,
  pathCount: 500,
  expectedBlockLength: 5,
  seed: 0x56415244,
  samplePathCount: 12,
  bootstrapModel: "stationary_bootstrap_unconditional_not_regime_conditioned",
  portfolioPath: "gross_normalized_buy_and_hold_no_rebalancing",
  displayBasis: "normalized_index_100",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  optimizer: "forbidden",
  orderAuthority: "forbidden",
  interpretation: "research_distribution_not_forecast",
} as const);

export type SimulationOwnerExecutionEndSelection =
  | Readonly<{
      status: "valid";
      source: "query" | "latest_common_stored";
      endServiceDate: string;
    }>
  | Readonly<{
      status: "invalid";
      source: "query";
      endServiceDate: null;
    }>
  | Readonly<{
      status: "unavailable";
      source: "latest_common_stored";
      endServiceDate: null;
    }>;

export type SimulationOwnerResearchExecutionResult = ReturnType<
  typeof buildSimulationOwnerResearchExecution
>;

export function resolveSimulationOwnerExecutionEndSelection(input: {
  suppliedValue: string | string[] | undefined;
  latestCommonStoredServiceDate: string | null;
}): SimulationOwnerExecutionEndSelection {
  if (input.suppliedValue !== undefined) {
    return typeof input.suppliedValue === "string" &&
      isRiskDate(input.suppliedValue)
      ? Object.freeze({
          status: "valid" as const,
          source: "query" as const,
          endServiceDate: input.suppliedValue,
        })
      : Object.freeze({
          status: "invalid" as const,
          source: "query" as const,
          endServiceDate: null,
        });
  }

  return input.latestCommonStoredServiceDate &&
    isRiskDate(input.latestCommonStoredServiceDate)
    ? Object.freeze({
        status: "valid" as const,
        source: "latest_common_stored" as const,
        endServiceDate: input.latestCommonStoredServiceDate,
      })
    : Object.freeze({
        status: "unavailable" as const,
        source: "latest_common_stored" as const,
        endServiceDate: null,
      });
}

export function buildSimulationOwnerResearchExecution(input: {
  candidate: SimulationOwnerInputCandidate;
  inputPreflight: SimulationOwnerInputPreflightModel;
  endSelection: SimulationOwnerExecutionEndSelection;
  horizonSelection: SimulationResearchHorizonSelection;
  matrix: SimulationReturnMatrixResult | null;
  preparedPaths?: PreparedSimulationResearchPaths;
}) {
  const base = {
    id: `owner-${input.candidate.account}`,
    name: "내 포트폴리오",
    account: input.candidate.account,
    policy: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
    runtimeTrustStatus: "tenant_scoped_read_only_research" as const,
    endSelection: input.endSelection,
    coverage: buildCoverage(input.candidate),
    instruments: buildInstrumentDiagnostics(
      input.candidate,
      input.inputPreflight,
    ),
  };

  if (
    input.candidate.status !== "ready_for_historical_preflight" ||
    !input.candidate.selection
  ) {
    return unavailable(base, "owner_input_unavailable");
  }
  if (input.endSelection.status === "invalid") {
    return unavailable(base, "invalid_end_service_date");
  }
  if (input.endSelection.status === "unavailable") {
    return unavailable(base, "end_service_date_unavailable");
  }
  if (
    input.horizonSelection.status !== "valid" ||
    input.horizonSelection.horizon === null
  ) {
    return unavailable(base, "invalid_horizon_selection");
  }

  const modeledRows = input.candidate.instruments.filter(
    (row) =>
      row.classification === "listed_instrument" &&
      row.weightBps !== null &&
      row.weightBps > 0,
  );
  if (modeledRows.length === 0) {
    return unavailable(base, "modeled_subset_empty");
  }
  const historicalByKey = new Map(
    input.inputPreflight.instruments.map((row) => [row.instrumentKey, row]),
  );
  if (
    modeledRows.some((row) => {
      const historical = historicalByKey.get(row.instrumentKey);
      return (
        historical?.historicalStatus !==
          "provenance_ready_for_separate_review" ||
        historical.admissionStatus !== "ready"
      );
    })
  ) {
    return unavailable(base, "historical_evidence_not_admitted");
  }

  const allocated = allocateBasisPointsByValue(
    modeledRows.map((row) => ({
      key: row.instrumentKey,
      value: row.currentValueKrw,
    })),
  );
  if (!allocated) {
    return unavailable(base, "weight_derivation_failed");
  }
  if (!input.matrix || input.matrix.status !== "ready") {
    return unavailable(base, "input_matrix_unavailable");
  }

  const matrix = input.matrix;
  const matrixKeys = matrix.instruments.map((row) => row.instrumentKey);
  const expectedKeys = modeledRows.map((row) => row.instrumentKey).sort();
  const matrixEndServiceDate = matrix.requestedServiceDates.at(-1) ?? null;
  if (
    matrix.matrix.length !==
      SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.sourceReturnStepCount ||
    matrixEndServiceDate !== input.endSelection.endServiceDate ||
    matrixKeys.length !== expectedKeys.length ||
    [...matrixKeys].sort().some((key, index) => key !== expectedKeys[index])
  ) {
    return unavailable(base, "input_matrix_shape_mismatch");
  }

  const weights = matrix.instruments.map((instrument) => ({
    ...instrument,
    weightBps: allocated.get(instrument.instrumentKey) ?? -1,
  }));
  if (
    weights.some((row) => row.weightBps < 0) ||
    weights.reduce((sum, row) => sum + row.weightBps, 0) !== BASIS_POINT_TOTAL
  ) {
    return unavailable(base, "weight_derivation_failed");
  }

  const prepared =
    input.preparedPaths ??
    prepareSimulationResearchPaths({
      matrix,
      seed: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.seed,
      expectedBlockLength:
        SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.expectedBlockLength,
      horizon: input.horizonSelection.horizon,
      pathCount: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.pathCount,
    });
  if (prepared.status !== "ready") {
    return unavailable(base, prepared.reason);
  }
  const execution = executeSimulationResearchPathsFromPrepared({
    prepared,
    scenarioId: `owner-current-${input.candidate.account}`,
    scenarioVersion: "v1",
    weights,
    samplePathCount:
      SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.samplePathCount,
  });
  if (execution.status !== "ready") {
    return unavailable(base, execution.reason);
  }

  return Object.freeze({
    ...base,
    ...execution,
    source: Object.freeze({
      endServiceDate: input.endSelection.endServiceDate,
      endSelectionSource: input.endSelection.source,
      returnStepCount: matrix.matrix.length,
      firstServiceDate: matrix.requestedServiceDates[0] ?? null,
      lastServiceDate: matrixEndServiceDate,
      priceBasis:
        matrix.policy.version ===
        "simulation_private_owner_raw_close_return_matrix_v1"
          ? ("raw_price_return" as const)
          : ("provider_adjusted_close" as const),
      corporateActionAdjustment:
        matrix.policy.version ===
        "simulation_private_owner_raw_close_return_matrix_v1"
          ? ("not_claimed" as const)
          : ("provider_claimed" as const),
      distributionAdjustment:
        matrix.policy.version ===
        "simulation_private_owner_raw_close_return_matrix_v1"
          ? ("not_claimed" as const)
          : ("provider_claimed" as const),
    }),
    executionWeights: Object.freeze(
      weights.map((row) => Object.freeze(row)),
    ),
  });
}

type OwnerExecutionBlockerReason =
  | "owner_input_unavailable"
  | "invalid_end_service_date"
  | "end_service_date_unavailable"
  | "invalid_horizon_selection"
  | "modeled_subset_empty"
  | "historical_evidence_not_admitted"
  | "weight_derivation_failed"
  | "input_matrix_unavailable"
  | "input_matrix_shape_mismatch"
  | SimulationResearchExecutionBlockerReason;

function buildCoverage(candidate: SimulationOwnerInputCandidate) {
  const modeledRows = candidate.instruments.filter(
    (row) =>
      row.classification === "listed_instrument" &&
      row.weightBps !== null &&
      row.weightBps > 0,
  );
  const modeledCurrentValueKrw = modeledRows.reduce(
    (sum, row) => sum + row.currentValueKrw,
    0,
  );
  const modeledOriginalWeightBps = modeledRows.reduce(
    (sum, row) => sum + (row.weightBps ?? 0),
    0,
  );
  const manualHistoryWeightBps = candidate.instruments.reduce(
    (sum, row) =>
      sum +
      (row.classification === "physical_commodity_position"
        ? row.weightBps ?? 0
        : 0),
    0,
  );
  const zeroWeightRowCount = candidate.instruments.filter(
    (row) => row.weightBps === 0,
  ).length;

  return Object.freeze({
    candidateCurrentValueKrw: candidate.summary.currentValueKrw,
    modeledCurrentValueKrw,
    modeledCurrentValuePct:
      candidate.summary.currentValueKrw > 0
        ? (modeledCurrentValueKrw / candidate.summary.currentValueKrw) * 100
        : 0,
    modeledOriginalWeightBps,
    omittedWeightBps: Math.max(
      0,
      BASIS_POINT_TOTAL - modeledOriginalWeightBps,
    ),
    manualHistoryWeightBps,
    zeroWeightRowCount,
    modeledInstrumentCount: modeledRows.length,
    candidateInstrumentCount: candidate.instruments.length,
  });
}

function buildInstrumentDiagnostics(
  candidate: SimulationOwnerInputCandidate,
  preflight: SimulationOwnerInputPreflightModel,
) {
  const historyByKey = new Map(
    preflight.instruments.map((row) => [row.instrumentKey, row]),
  );
  return Object.freeze(
    candidate.instruments.map((row) => {
      const history = historyByKey.get(row.instrumentKey);
      const executionRole =
        row.classification === "listed_instrument" &&
        row.weightBps !== null &&
        row.weightBps > 0
          ? ("modeled" as const)
          : row.classification === "physical_commodity_position"
            ? ("omitted_manual_history" as const)
            : ("omitted_zero_weight" as const);
      return Object.freeze({
        instrumentKey: row.instrumentKey,
        name: row.name,
        ticker: row.ticker,
        market: row.market,
        currency: row.currency,
        originalWeightBps: row.weightBps,
        currentValueKrw: row.currentValueKrw,
        historicalStatus: history?.historicalStatus ?? "not_evaluated",
        executionRole,
      });
    }),
  );
}

function unavailable(
  base: {
    id: string;
    name: string;
    account: SimulationOwnerInputCandidate["account"];
    policy: typeof SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY;
    runtimeTrustStatus: "tenant_scoped_read_only_research";
    endSelection: SimulationOwnerExecutionEndSelection;
    coverage: ReturnType<typeof buildCoverage>;
    instruments: ReturnType<typeof buildInstrumentDiagnostics>;
  },
  reason: OwnerExecutionBlockerReason,
) {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    source: null,
    assumptions: null,
    terminal: null,
    bands: Object.freeze([]),
    samplePaths: Object.freeze([]),
    executionWeights: Object.freeze([]),
  });
}
