import "server-only";
import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { buildHistoryLiveValuation } from "@/lib/history-live-valuation";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantHistoryLiveValuation({ scope, tenantContext, now = new Date() }: {
  scope: PortfolioAnalysisScope; tenantContext: TenantContext; now?: Date;
}) {
  try {
    // Membership follows the same effective service date as Home; only the display date is today's calendar date.
    const structure = await getReadOnlyTenantPortfolioStructureForScope({ scope, tenantContext, serviceDate: resolveSnapshotCycle(now).snapshotDate });
    return buildHistoryLiveValuation(structure, now);
  } catch {
    return buildHistoryLiveValuation(null, now);
  }
}
