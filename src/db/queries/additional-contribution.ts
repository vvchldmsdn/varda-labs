import "server-only";

import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { getReadOnlyTenantTargetPolicyHoldingUniverse } from "@/db/queries/target-policy-holding-universe";
import { buildAdditionalContributionPreview } from "@/lib/additional-contribution-preview";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantAdditionalContributionPreview({
  account,
  cashAmountKrw,
  tenantContext,
  now = new Date(),
}: {
  account: string;
  cashAmountKrw: number;
  tenantContext: TenantContext;
  now?: Date;
}) {
  const [approvedPolicyRead, currentUniverse, structure] = await Promise.all([
    getReadOnlyTenantApprovedTargetPolicy({ account, tenantContext }),
    getReadOnlyTenantTargetPolicyHoldingUniverse({ account, tenantContext }),
    getReadOnlyTenantPortfolioStructure({ account, tenantContext }),
  ]);

  return buildAdditionalContributionPreview({
    account,
    cashAmountKrw,
    serviceDate: resolveSnapshotCycle(now).snapshotDate,
    approvedPolicyRead,
    currentUniverse,
    structure,
  });
}
