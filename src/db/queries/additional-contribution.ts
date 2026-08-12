import "server-only";

import { getReadOnlyTenantAdditionalContributionMa120Evidence } from "@/db/queries/additional-contribution-ma120";
import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { getReadOnlyTenantTargetPolicyHoldingUniverse } from "@/db/queries/target-policy-holding-universe";
import {
  additionalContributionMa120ReadFailure,
  attachAdditionalContributionMa120Evidence,
  buildAdditionalContributionPreview,
} from "@/lib/additional-contribution-preview";
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
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const preview = buildAdditionalContributionPreview({
    account,
    cashAmountKrw,
    serviceDate,
    approvedPolicyRead,
    currentUniverse,
    structure,
  });
  if (preview.status !== "ready") return preview;

  let ma120Read;
  try {
    ma120Read = await getReadOnlyTenantAdditionalContributionMa120Evidence({
      holdings: structure.holdingRows,
      serviceDate,
      tenantContext,
    });
  } catch {
    ma120Read = additionalContributionMa120ReadFailure(
      structure.holdingRows.length,
    );
  }

  return attachAdditionalContributionMa120Evidence({ preview, ma120Read });
}
