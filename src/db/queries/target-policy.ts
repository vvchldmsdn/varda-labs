import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  targetPolicyApprovalRevisions,
  targetPolicyApprovalVectorRows,
} from "@/db/schema";
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

  const revisions = await db
    .select({
      id: targetPolicyApprovalRevisions.id,
      policyId: targetPolicyApprovalRevisions.policyId,
      policyVersion: targetPolicyApprovalRevisions.policyVersion,
      effectiveServiceDate:
        targetPolicyApprovalRevisions.effectiveServiceDate,
      universeHash: targetPolicyApprovalRevisions.universeHash,
      vectorHash: targetPolicyApprovalRevisions.vectorHash,
    })
    .from(targetPolicyApprovalRevisions)
    .innerJoin(
      accounts,
      eq(targetPolicyApprovalRevisions.accountId, accounts.id),
    )
    .where(
      and(
        eq(
          targetPolicyApprovalRevisions.ownerUserId,
          tenantContext.ownerUserId,
        ),
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        eq(accounts.code, account),
        eq(
          targetPolicyApprovalRevisions.policyId,
          TARGET_POLICY_RESOLVER_POLICY.policyId,
        ),
        eq(targetPolicyApprovalRevisions.lifecycleStatus, "approved"),
      ),
    )
    .limit(2);

  if (revisions.length === 0) return unavailable("missing");
  if (revisions.length !== 1) return unavailable("conflict");

  const [revision] = revisions;
  const vector = await db
    .select({
      market: targetPolicyApprovalVectorRows.market,
      currency: targetPolicyApprovalVectorRows.currency,
      ticker: targetPolicyApprovalVectorRows.ticker,
      targetWeightBps: targetPolicyApprovalVectorRows.targetWeightBps,
    })
    .from(targetPolicyApprovalVectorRows)
    .where(
      eq(targetPolicyApprovalVectorRows.approvalRevisionId, revision.id),
    )
    .orderBy(
      asc(targetPolicyApprovalVectorRows.market),
      asc(targetPolicyApprovalVectorRows.currency),
      asc(targetPolicyApprovalVectorRows.ticker),
    )
    .limit(65);

  if (vector.length > 64) return unavailable("conflict");

  return Object.freeze({
    status: "available",
    policy: Object.freeze({
      approvalState: "approved",
      policyId: revision.policyId,
      account: account as TargetPolicyUniverseAccount,
      policyVersion: revision.policyVersion,
      effectiveServiceDate: revision.effectiveServiceDate,
      universeHash: revision.universeHash,
      vectorHash: revision.vectorHash,
      vector: Object.freeze(vector.map((row) => Object.freeze(row))),
    }),
  });
}

function unavailable(status: "missing" | "conflict") {
  return Object.freeze({ status, policy: null });
}
