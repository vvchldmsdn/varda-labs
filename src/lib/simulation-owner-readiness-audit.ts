import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";
import type { SimulationOwnerInputPreflightModel } from "./simulation-owner-input-preflight.ts";
import type { SimulationOwnerHistoricalOutcomeValidationResult } from "./simulation-owner-historical-outcome-validation.ts";
import type { SimulationOwnerResearchExecutionResult } from "./simulation-owner-research-execution.ts";
import type { SimulationOwnerParametricFactorResult } from "./simulation-owner-parametric-factor.ts";
import type { SimulationOwnerModelComparisonResult } from "./simulation-owner-model-comparison.ts";
import type { SimulationOwnerModelCalibrationResult } from "./simulation-owner-model-calibration.ts";

export const SIMULATION_OWNER_READINESS_AUDIT_POLICY = Object.freeze({
  version: "simulation_owner_research_readiness_audit_v5",
  accountScopes: Object.freeze([
    "all",
    "brokerage",
    "isa",
    "irp",
  ] as const),
  databaseAccess: "select_only",
  providerCalls: "forbidden",
  databaseWrites: "forbidden",
  outputBoundary: "aggregate_statuses_counts_and_dates_only",
} as const);

type ReadinessScopeInput = Readonly<{
  account: PortfolioAccountScope;
  inputPreflight: SimulationOwnerInputPreflightModel;
  execution: SimulationOwnerResearchExecutionResult;
  historicalValidation: SimulationOwnerHistoricalOutcomeValidationResult;
  parametricFactor: SimulationOwnerParametricFactorResult;
  modelComparison: SimulationOwnerModelComparisonResult;
  modelCalibration: SimulationOwnerModelCalibrationResult;
}>;

export function summarizeSimulationOwnerReadiness(
  inputs: readonly ReadinessScopeInput[],
) {
  const byScope = new Map<PortfolioAccountScope, ReadinessScopeInput>();
  for (const input of inputs) {
    if (byScope.has(input.account)) {
      throw new TypeError(`duplicate readiness scope: ${input.account}`);
    }
    if (
      input.inputPreflight.account !== input.account ||
      input.execution.account !== input.account ||
      input.historicalValidation.account !== input.account ||
      input.parametricFactor.account !== input.account ||
      input.modelComparison.account !== input.account ||
      input.modelCalibration.account !== input.account
    ) {
      throw new TypeError(`readiness scope mismatch: ${input.account}`);
    }
    byScope.set(input.account, input);
  }

  const scopes = SIMULATION_OWNER_READINESS_AUDIT_POLICY.accountScopes.map(
    (account) => {
      const input = byScope.get(account);
      if (!input) throw new TypeError(`missing readiness scope: ${account}`);
      return summarizeScope(input);
    },
  );

  return Object.freeze({
    policy: SIMULATION_OWNER_READINESS_AUDIT_POLICY,
    scopeCount: scopes.length,
    readyScopeCount: scopes.filter((scope) => scope.executionStatus === "ready")
      .length,
    historicalValidationReadyScopeCount: scopes.filter(
      (scope) => scope.historicalValidation.status === "ready",
    ).length,
    parametricFactorReadyScopeCount: scopes.filter(
      (scope) => scope.parametricFactor.status === "ready",
    ).length,
    modelComparisonReadyScopeCount: scopes.filter(
      (scope) => scope.modelComparison.status === "ready",
    ).length,
    modelCalibrationReadyScopeCount: scopes.filter(
      (scope) => scope.modelCalibration.status === "ready",
    ).length,
    modelCalibrationPairedScopeCount: scopes.filter(
      (scope) => scope.modelCalibration.pairedEndpointCount > 0,
    ).length,
    scopes: Object.freeze(scopes),
  });
}

function summarizeScope(input: ReadinessScopeInput) {
  const {
    inputPreflight,
    execution,
    historicalValidation,
    parametricFactor,
    modelComparison,
    modelCalibration,
  } = input;
  return Object.freeze({
    account: input.account,
    inputStatus: inputPreflight.status,
    executionStatus: execution.status,
    executionReason:
      execution.status === "unavailable" ? execution.reason : null,
    inputBlockers: Object.freeze([...inputPreflight.blockers]),
    endSelection: Object.freeze({ ...execution.endSelection }),
    holdings: Object.freeze({
      sourceHoldingCount: inputPreflight.summary.sourceHoldingCount,
      candidateInstrumentCount: execution.coverage.candidateInstrumentCount,
      modeledInstrumentCount: execution.coverage.modeledInstrumentCount,
      valuationGapCount: inputPreflight.summary.valuationGapCount,
      identityGapCount: inputPreflight.summary.identityGapCount,
      fountExcludedHoldingCount:
        inputPreflight.summary.fountExcludedHoldingCount,
    }),
    modeledCoverage: Object.freeze({
      currentValuePct: roundPercentage(
        execution.coverage.modeledCurrentValuePct,
      ),
      omittedWeightBps: execution.coverage.omittedWeightBps,
      manualHistoryWeightBps: execution.coverage.manualHistoryWeightBps,
    }),
    historicalStatusCounts: countCodes(
      inputPreflight.instruments.map((row) => row.historicalStatus),
    ),
    admissionStatusCounts: countCodes(
      inputPreflight.instruments.map(
        (row) => row.admissionStatus ?? "not_evaluated",
      ),
    ),
    historicalValidation: Object.freeze({
      status: historicalValidation.status,
      reason: historicalValidation.reason,
      latestOutcomeEndServiceDate:
        historicalValidation.latestOutcomeEndServiceDate,
      endpointCount: historicalValidation.summary.endpointCount,
      readyEndpointCount:
        historicalValidation.summary.readyEndpointCount,
      unavailableEndpointCount:
        historicalValidation.summary.unavailableEndpointCount,
    }),
    parametricFactor: Object.freeze({
      status: parametricFactor.status,
      reason:
        parametricFactor.status === "unavailable"
          ? parametricFactor.reason
          : null,
      alignedObservationCount:
        parametricFactor.source.alignedObservationCount,
      factorGapRowCount: parametricFactor.source.factorGapRowCount,
      firstAlignedServiceDate:
        parametricFactor.source.firstAlignedServiceDate,
      lastAlignedServiceDate:
        parametricFactor.source.lastAlignedServiceDate,
    }),
    modelComparison: Object.freeze({
      status: modelComparison.status,
      reason:
        modelComparison.status === "unavailable"
          ? modelComparison.reason
          : null,
      agreementCode:
        modelComparison.status === "ready"
          ? modelComparison.agreement.code
          : null,
      terminalP10P90OverlapPct:
        modelComparison.status === "ready"
          ? roundPercentage(
              modelComparison.agreement.terminalP10P90OverlapPct,
            )
          : null,
      factorObservationCoveragePct:
        modelComparison.status === "ready"
          ? roundPercentage(
              modelComparison.pairing.factorObservationCoveragePct,
            )
          : null,
    }),
    modelCalibration: Object.freeze({
      status: modelCalibration.status,
      reason: modelCalibration.reason,
      endpointCount: modelCalibration.summary.endpointCount,
      pairedEndpointCount: modelCalibration.summary.pairedEndpointCount,
      unavailableEndpointCount:
        modelCalibration.summary.unavailableEndpointCount,
      effectiveNonOverlappingWindowCount:
        modelCalibration.summary.effectiveNonOverlappingWindowCount,
    }),
  });
}

function countCodes(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function roundPercentage(value: number) {
  return Math.round(value * 100) / 100;
}
