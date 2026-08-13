import "server-only";

import {
  getReadOnlyTenantPortfolioStructure,
  getReadOnlyTenantPortfolioStructureForScope,
} from "@/db/queries/portfolio-structure";
import {
  getActivePortfolioOwnerUserIds,
  getLatestCommonPrivateOwnerRawServiceDate,
  getReadOnlyPrivateOwnerRawHistoryValidationBatch,
} from "@/db/queries/simulation-owner-private-history";
import { buildSimulationOwnerHistoricalOutcomeValidation } from "@/lib/simulation-owner-historical-outcome-validation";
import { buildSimulationOwnerInputCandidate } from "@/lib/simulation-owner-input-candidate";
import { buildSimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";
import { buildSimulationOwnerCandidateComparison } from "@/lib/simulation-owner-candidate-comparison";
import { buildSimulationOwnerWalkForwardValidation } from "@/lib/simulation-owner-walk-forward-validation";
import {
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
  SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
} from "@/lib/simulation-owner-research-execution";
import { prepareSimulationResearchPaths } from "@/lib/simulation-research-execution-core";
import { resolveSimulationResearchHorizon } from "@/lib/simulation-research-horizon";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

type SimulationOwnerResearchBaseOptions = Readonly<{
  tenantContext: TenantContext;
  endServiceDate?: string | string[];
  horizon?: string | string[];
  now?: Date;
}>;

type SimulationOwnerResearchOptions = SimulationOwnerResearchBaseOptions &
  (
    | Readonly<{
        account?: string | string[] | null;
        scope?: never;
        serviceDate?: never;
      }>
    | Readonly<{
        account?: never;
        scope: PortfolioAnalysisScope;
        serviceDate: string;
      }>
  );

export async function getReadOnlyTenantSimulationOwnerResearch(
  options: SimulationOwnerResearchOptions,
) {
  const portfolioPromise = options.scope
    ? getReadOnlyTenantPortfolioStructureForScope({
        scope: options.scope,
        serviceDate: options.serviceDate,
        tenantContext: options.tenantContext,
      })
    : getReadOnlyTenantPortfolioStructure({
        tenantContext: options.tenantContext,
        account: options.account,
      });
  const [portfolio, activeOwnerUserIds] = await Promise.all([
    portfolioPromise,
    getActivePortfolioOwnerUserIds(),
  ]);
  const candidate = options.scope
    ? buildSimulationOwnerInputCandidate({
        scopeKey: options.scope.key,
        portfolio,
      })
    : buildSimulationOwnerInputCandidate({
        account: portfolio.selectedAccount,
        portfolio,
      });
  const latestCommonStoredServiceDate =
    options.endServiceDate === undefined && candidate.selection
      ? await getLatestCommonPrivateOwnerRawServiceDate({
          tenantContext: options.tenantContext,
          activeOwnerUserIds,
          selection: candidate.selection,
        })
      : null;
  const endSelection = resolveSimulationOwnerExecutionEndSelection({
    suppliedValue: options.endServiceDate,
    latestCommonStoredServiceDate,
  });
  const historyValidationBatch =
    candidate.selection && endSelection.status === "valid"
      ? await getReadOnlyPrivateOwnerRawHistoryValidationBatch({
          tenantContext: options.tenantContext,
          activeOwnerUserIds,
          selection: candidate.selection,
          endServiceDate: endSelection.endServiceDate,
          currentReturnStepCount: 90,
        })
      : null;
  const historicalBundle = historyValidationBatch?.current ?? null;
  const availableServiceDates =
    historyValidationBatch?.availableServiceDates ??
    Object.freeze([] as string[]);
  const historicalValidationEndpoints = Object.freeze(
    (historyValidationBatch?.endpoints ?? []).map(
      ({ outcomeEndServiceDate, result }) =>
        Object.freeze({
          outcomeEndServiceDate,
          matrix: result.matrix ?? null,
        }),
    ),
  );
  const inputPreflight = buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight: historicalBundle,
  });
  const horizonSelection = resolveSimulationResearchHorizon(options.horizon);
  const matrix =
    endSelection.status === "valid"
      ? historicalBundle?.matrix ?? null
      : null;
  const preparedPaths =
    matrix?.status === "ready" &&
    horizonSelection.status === "valid" &&
    horizonSelection.horizon !== null
      ? prepareSimulationResearchPaths({
          matrix,
          seed: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.seed,
          expectedBlockLength:
            SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.expectedBlockLength,
          horizon: horizonSelection.horizon,
          pathCount: SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.pathCount,
        })
      : undefined;
  const execution = buildSimulationOwnerResearchExecution({
    candidate,
    inputPreflight,
    endSelection,
    horizonSelection,
    matrix,
    preparedPaths,
  });
  const candidateComparison = buildSimulationOwnerCandidateComparison({
    account: candidate.account,
    prepared:
      preparedPaths?.status === "ready" ? preparedPaths : null,
    currentExecution: execution,
    currentWeights: execution.executionWeights,
    samplePathCount:
      SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.samplePathCount,
  });
  const walkForwardValidation = buildSimulationOwnerWalkForwardValidation({
    account: candidate.account,
    currentExecutionReady: execution.status === "ready",
    matrix,
    currentWeights: execution.executionWeights,
  });
  const historicalValidation =
    buildSimulationOwnerHistoricalOutcomeValidation({
      execution,
      availableServiceDates,
      endpoints: historicalValidationEndpoints,
    });
  const parametricFactorInput =
    execution.status === "ready" && matrix?.status === "ready"
      ? Object.freeze({
          account: candidate.account,
          matrix,
          weights: execution.executionWeights,
          horizon: execution.assumptions.horizon,
        })
      : null;

  return Object.freeze({
    inputPreflight,
    execution,
    candidateComparison,
    walkForwardValidation,
    historicalValidation,
    parametricFactorInput,
    modelCalibrationInput: Object.freeze({
      factorAsOfServiceDate:
        endSelection.status === "valid" ? endSelection.endServiceDate : null,
      availableServiceDates,
      endpoints: historicalValidationEndpoints,
    }),
  });
}

export type ReadOnlyTenantSimulationOwnerResearchResult = Awaited<
  ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch>
>;

export async function getReadOnlyTenantSimulationOwnerInputPreflight(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  now?: Date;
}) {
  const result = await getReadOnlyTenantSimulationOwnerResearch(options);
  return result.inputPreflight;
}
