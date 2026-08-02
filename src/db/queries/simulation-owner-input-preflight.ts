import "server-only";

import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlySimulationResearchUniversePreflightForSelection } from "@/db/queries/simulation-research-universe-preflight";
import { buildSimulationOwnerInputCandidate } from "@/lib/simulation-owner-input-candidate";
import { buildSimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantSimulationOwnerInputPreflight(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  now?: Date;
}) {
  const portfolio = await getReadOnlyTenantPortfolioStructure({
    tenantContext: options.tenantContext,
    account: options.account,
  });
  const candidate = buildSimulationOwnerInputCandidate({
    account: portfolio.selectedAccount,
    portfolio,
  });

  const historicalPreflight = candidate.selection
    ? await getReadOnlySimulationResearchUniversePreflightForSelection({
        selection: candidate.selection,
        endServiceDate: options.endServiceDate,
        now: options.now,
      })
    : null;

  return buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight,
  });
}
