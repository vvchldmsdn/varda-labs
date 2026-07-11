import type {
  NormalizedTargetPolicyAsset,
  NormalizedTargetPolicyMember,
  TargetPolicyAccount,
} from "./target-policy-evidence-input.ts";

export type TargetPolicyEvidenceClassification =
  | "standalone_asset_target_candidate"
  | "group_fixed_ratio_candidate"
  | "group_target_unresolved"
  | "execution_policy_not_target_vector"
  | "target_conflict"
  | "cross_account_scope_unresolved"
  | "unallocatable_target_candidate";

export type TargetPolicyEvidenceReason =
  | "invalid_asset_reference"
  | "invalid_group_reference"
  | "unsupported_account_evidence"
  | "missing_asset_target"
  | "invalid_asset_target"
  | "missing_group_target"
  | "invalid_group_target"
  | "empty_group"
  | "missing_member_ratio"
  | "invalid_member_ratio"
  | "member_ratio_sum_mismatch"
  | "unknown_execution_mode"
  | "orphan_member_asset"
  | "orphan_member_group"
  | "orphan_direct_group"
  | "duplicate_member"
  | "multi_membership"
  | "membership_evidence_mismatch"
  | "group_asset_target_overlap"
  | "cross_account_group"
  | "structurally_unbuyable_positive_target"
  | "account_target_sum_unresolved";

export type TargetPolicyEvidenceIssue = Readonly<{
  reason: TargetPolicyEvidenceReason;
  account: TargetPolicyAccount | null;
}>;

export function classifyStandaloneTargetEvidence(
  asset: NormalizedTargetPolicyAsset,
  account: TargetPolicyAccount,
  classifications: Map<
    TargetPolicyAccount,
    TargetPolicyEvidenceClassification[]
  >,
  candidateTargetParts: Map<TargetPolicyAccount, number[]>,
  issues: TargetPolicyEvidenceIssue[],
) {
  const target = validTargetPercent(asset.targetWeight);
  if (target === null) {
    addTargetPolicyIssue(
      issues,
      asset.targetWeight === null ? "missing_asset_target" : "invalid_asset_target",
      account,
    );
    return;
  }
  addTargetPolicyClassification(
    classifications,
    account,
    "standalone_asset_target_candidate",
  );
  candidateTargetParts.get(account)?.push(target);
  if (target > 0 && !isStructurallyBuyableTargetAsset(asset)) {
    addTargetPolicyClassification(
      classifications,
      account,
      "unallocatable_target_candidate",
    );
    addTargetPolicyIssue(
      issues,
      "structurally_unbuyable_positive_target",
      account,
    );
  }
}

export function inspectTargetFixedRatios(
  members: readonly NormalizedTargetPolicyMember[],
  assetCount: number,
) {
  const reasons: TargetPolicyEvidenceReason[] = [];
  if (members.length !== assetCount || members.length === 0) {
    reasons.push("missing_member_ratio");
  }
  let sum = 0;
  for (const member of members) {
    if (member.allocationRatio === null) {
      reasons.push("missing_member_ratio");
    } else if (
      !Number.isFinite(member.allocationRatio) ||
      member.allocationRatio <= 0 ||
      member.allocationRatio > 100
    ) {
      reasons.push("invalid_member_ratio");
    } else {
      sum += member.allocationRatio;
    }
  }
  if (members.length > 0 && !targetPercentEqual(sum, 100)) {
    reasons.push("member_ratio_sum_mismatch");
  }
  return { complete: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function targetPolicyEvidenceStatus(
  classifications: TargetPolicyEvidenceClassification[],
  issues: TargetPolicyEvidenceIssue[],
) {
  if (
    classifications.includes("target_conflict") ||
    issues.some((issue) => isTargetPolicyConflictReason(issue.reason))
  ) {
    return "conflict";
  }
  if (
    classifications.some((value) =>
      [
        "group_target_unresolved",
        "execution_policy_not_target_vector",
        "cross_account_scope_unresolved",
        "unallocatable_target_candidate",
      ].includes(value),
    ) ||
    issues.length > 0
  ) {
    return "unresolved";
  }
  return classifications.length > 0 ? "resolvable" : "unresolved";
}

export function isTargetPolicyConflictReason(
  reason: TargetPolicyEvidenceReason,
) {
  return [
    "orphan_member_asset",
    "orphan_member_group",
    "orphan_direct_group",
    "duplicate_member",
    "multi_membership",
    "membership_evidence_mismatch",
    "group_asset_target_overlap",
  ].includes(reason);
}

export function isStructurallyBuyableTargetAsset(
  asset: NormalizedTargetPolicyAsset,
) {
  return (
    Boolean(asset.ticker) &&
    (asset.market === "korea" || asset.market === "us") &&
    (asset.currency === "KRW" || asset.currency === "USD")
  );
}

export function validTargetPercent(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

export function addTargetPolicyClassification(
  target: Map<TargetPolicyAccount, TargetPolicyEvidenceClassification[]>,
  account: TargetPolicyAccount,
  value: TargetPolicyEvidenceClassification,
) {
  target.get(account)?.push(value);
}

export function addTargetPolicyIssue(
  issues: TargetPolicyEvidenceIssue[],
  reason: TargetPolicyEvidenceReason,
  account: TargetPolicyAccount | null,
) {
  issues.push(Object.freeze({ reason, account }));
}

export function countTargetPolicyValues(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.freeze(
    Object.fromEntries(
      [...counts].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function targetPercentEqual(left: number, right: number) {
  return Math.abs(left - right) <= 1e-6;
}
