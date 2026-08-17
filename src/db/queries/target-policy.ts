import "server-only";

import { loadCurrentTenantLegacyTargetPolicy } from "@/db/queries/tenant-target-policies";
import {
  normalizeTargetPolicyUniverseAccount,
  type TargetPolicyUniverseAccount,
} from "@/lib/target-policy-holding-universe";
import {
  TARGET_POLICY_RESOLVER_POLICY,
  type ApprovedTargetPolicyPort,
} from "@/lib/target-policy-resolver";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantApprovedTargetPolicyReadResult =
  | Readonly<{
      status: "available";
      policy: ApprovedTargetPolicyPort;
    }>
  | Readonly<{
      status: "missing" | "conflict";
      policy: null;
    }>;

export async function getReadOnlyTenantApprovedTargetPolicy({
  account: accountInput,
  tenantContext,
}: {
  account: string;
  tenantContext: TenantContext;
}): Promise<TenantApprovedTargetPolicyReadResult> {
  const account = normalizeTargetPolicyUniverseAccount(accountInput);
  if (!account) return unavailable("missing");

  const approvedPolicy = await loadCurrentTenantLegacyTargetPolicy({
    account,
    policyId: TARGET_POLICY_RESOLVER_POLICY.policyId,
    tenantContext,
  });
  if (approvedPolicy.status !== "available") {
    return unavailable(approvedPolicy.status);
  }

  return Object.freeze({
    status: "available",
    policy: Object.freeze({
      approvalState: "approved",
      policyId: approvedPolicy.policy.policyId,
      account: account as TargetPolicyUniverseAccount,
      policyVersion: approvedPolicy.policy.policyVersion,
      effectiveServiceDate: approvedPolicy.policy.effectiveServiceDate,
      universeHash: approvedPolicy.policy.universeHash,
      vectorHash: approvedPolicy.policy.vectorHash,
      vector: approvedPolicy.policy.vector,
    }),
  });
}

function unavailable(status: "missing" | "conflict") {
  return Object.freeze({ status, policy: null });
}
