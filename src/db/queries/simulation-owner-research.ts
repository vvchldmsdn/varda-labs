import "server-only";

import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import {
  getActivePortfolioOwnerUserIds,
  getLatestCommonPrivateOwnerRawServiceDate,
  getReadOnlyPrivateOwnerRawHistoryBatch,
} from "@/db/queries/simulation-owner-private-history";
import {
  buildSimulationOwnerHistoricalOutcomeValidation,
  buildSimulationOwnerHistoricalValidationEndpointDates,
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
} from "@/lib/simulation-owner-historical-outcome-validation";
import { buildSimulationOwnerInputCandidate } from "@/lib/simulation-owner-input-candidate";
import { buildSimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";
import { buildSimulationOwnerCandidateComparison } from "@/lib/simulation-owner-candidate-comparison";
import {
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
  SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
} from "@/lib/simulation-owner-research-execution";
import { prepareSimulationResearchPaths } from "@/lib/simulation-research-execution-core";
import { resolveSimulationResearchHorizon } from "@/lib/simulation-research-horizon";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantSimulationOwnerResearch(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  horizon?: string | string[];
  now?: Date;
}) {
  const [portfolio, activeOwnerUserIds] = await Promise.all([
    getReadOnlyTenantPortfolioStructure({
      tenantContext: options.tenantContext,
      account: options.account,
    }),
    getActivePortfolioOwnerUserIds(),
  ]);
  const candidate = buildSimulationOwnerInputCandidate({
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
  const validationDates =
    endSelection.status === "valid"
      ? buildSimulationOwnerHistoricalValidationEndpointDates(
          endSelection.endServiceDate,
        )
      : [];
  const historyBatch =
    candidate.selection && endSelection.status === "valid"
      ? await getReadOnlyPrivateOwnerRawHistoryBatch({
          tenantContext: options.tenantContext,
          activeOwnerUserIds,
          selection: candidate.selection,
          requests: [
            {
              endServiceDate: endSelection.endServiceDate,
              returnStepCount: 90,
            },
            ...validationDates.map((endServiceDate) => ({
              endServiceDate,
              returnStepCount:
                SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY.sourceReturnStepCount,
            })),
          ],
        })
      : [];
  const historicalBundle = historyBatch[0] ?? null;
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
  const historicalValidation =
    buildSimulationOwnerHistoricalOutcomeValidation({
      execution,
      endpoints: validationDates.map((outcomeEndServiceDate, index) => ({
        outcomeEndServiceDate,
        matrix: historyBatch[index + 1]?.matrix ?? null,
      })),
    });

  return Object.freeze({
    inputPreflight,
    execution,
    candidateComparison,
    historicalValidation,
  });
}

export async function getReadOnlyTenantSimulationOwnerInputPreflight(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  now?: Date;
}) {
  const result = await getReadOnlyTenantSimulationOwnerResearch(options);
  return result.inputPreflight;
}
