import "server-only";

import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import {
  getActivePortfolioOwnerUserIds,
  getLatestCommonPrivateOwnerRawServiceDate,
  getReadOnlyPrivateOwnerRawHistoryBundle,
} from "@/db/queries/simulation-owner-private-history";
import { buildSimulationOwnerInputCandidate } from "@/lib/simulation-owner-input-candidate";
import { buildSimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";
import {
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
} from "@/lib/simulation-owner-research-execution";
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
  const historicalBundle = candidate.selection
    ? endSelection.status === "valid"
      ? await getReadOnlyPrivateOwnerRawHistoryBundle({
          tenantContext: options.tenantContext,
          activeOwnerUserIds,
          selection: candidate.selection,
          endServiceDate: endSelection.endServiceDate,
        })
      : null
    : null;
  const inputPreflight = buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight: historicalBundle,
  });
  const execution = buildSimulationOwnerResearchExecution({
    candidate,
    inputPreflight,
    endSelection,
    horizonSelection: resolveSimulationResearchHorizon(options.horizon),
    matrix:
      endSelection.status === "valid"
        ? historicalBundle?.matrix ?? null
        : null,
  });

  return Object.freeze({ inputPreflight, execution });
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
