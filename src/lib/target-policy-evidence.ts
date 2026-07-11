import {
  TARGET_POLICY_ACCOUNTS,
  normalizeTargetPolicyEvidenceInput,
  type NormalizedTargetPolicyAsset,
  type NormalizedTargetPolicyMember,
  type TargetPolicyAccount,
  type TargetPolicyAssetEvidence,
  type TargetPolicyGroupEvidence,
  type TargetPolicyMemberEvidence,
} from "./target-policy-evidence-input.ts";
import {
  addTargetPolicyClassification as addClassification,
  addTargetPolicyIssue as addIssue,
  classifyStandaloneTargetEvidence as classifyStandaloneAsset,
  countTargetPolicyValues as countValues,
  inspectTargetFixedRatios as inspectFixedRatios,
  isStructurallyBuyableTargetAsset as isStructurallyBuyable,
  isTargetPolicyConflictReason as isConflictReason,
  targetPercentEqual as nearlyEqual,
  targetPolicyEvidenceStatus as evidenceStatus,
  validTargetPercent as validPercent,
  type TargetPolicyEvidenceClassification as Classification,
  type TargetPolicyEvidenceIssue as Issue,
} from "./target-policy-evidence-rules.ts";

export const TARGET_POLICY_EVIDENCE_AUDIT_POLICY = Object.freeze({
  version: "target_policy_evidence_audit_v0",
  supportedAccounts: TARGET_POLICY_ACCOUNTS,
  targetUnit: "raw_percent",
  fixedRatioExpectedTotal: 100,
  canonicalVectorGeneration: "forbidden",
  missingRatioNormalization: "forbidden",
  effectiveTargetInference: "forbidden",
} as const);

type Account = TargetPolicyAccount;

type NormalizedAsset = NormalizedTargetPolicyAsset;
type NormalizedMember = NormalizedTargetPolicyMember;

export function classifyTargetPolicyEvidence(input: {
  assets: readonly TargetPolicyAssetEvidence[];
  groups: readonly TargetPolicyGroupEvidence[];
  members: readonly TargetPolicyMemberEvidence[];
}) {
  const { assets, groups, members } = normalizeTargetPolicyEvidenceInput(input);
  const assetsByRef = new Map(assets.map((asset) => [asset.ref, asset]));
  const groupsByRef = new Map(groups.map((group) => [group.ref, group]));
  const activeGroupsByRef = new Map(
    groups.filter((group) => group.isActive).map((group) => [group.ref, group]),
  );
  const activeMembers = members.filter((member) => member.isActive);
  const issues: Issue[] = [];
  const classifications = new Map<Account, Classification[]>();
  const candidateTargetParts = new Map<Account, number[]>();
  const memberGroupsByAsset = new Map<string, Set<string>>();
  const groupAssetRefs = new Map<string, Set<string>>();
  const memberRowsByGroup = new Map<string, NormalizedMember[]>();

  for (const account of TARGET_POLICY_EVIDENCE_AUDIT_POLICY.supportedAccounts) {
    classifications.set(account, []);
    candidateTargetParts.set(account, []);
  }

  for (const asset of assets) {
    if (!asset.ref) addIssue(issues, "invalid_asset_reference", asset.account);
    if (!asset.account) addIssue(issues, "unsupported_account_evidence", null);
    if (asset.directGroupRef) {
      addToSet(groupAssetRefs, asset.directGroupRef, asset.ref);
      if (!groupsByRef.has(asset.directGroupRef)) {
        addIssue(issues, "orphan_direct_group", asset.account);
      }
    }
  }

  const memberPairs = new Set<string>();
  for (const member of activeMembers) {
    const group = groupsByRef.get(member.groupRef);
    const asset = assetsByRef.get(member.assetRef);
    if (!group) addIssue(issues, "orphan_member_group", asset?.account ?? null);
    if (!asset) addIssue(issues, "orphan_member_asset", null);
    if (!group || !asset) continue;

    const pair = JSON.stringify([member.groupRef, member.assetRef]);
    if (memberPairs.has(pair)) addIssue(issues, "duplicate_member", asset.account);
    memberPairs.add(pair);
    addToSet(memberGroupsByAsset, member.assetRef, member.groupRef);
    addToSet(groupAssetRefs, member.groupRef, member.assetRef);
    const groupRows = memberRowsByGroup.get(member.groupRef) ?? [];
    groupRows.push(member);
    memberRowsByGroup.set(member.groupRef, groupRows);
  }

  for (const asset of assets) {
    if (!asset.account) continue;
    const memberGroups = memberGroupsByAsset.get(asset.ref) ?? new Set<string>();
    const linkedGroups = new Set(memberGroups);
    if (asset.directGroupRef && activeGroupsByRef.has(asset.directGroupRef)) {
      linkedGroups.add(asset.directGroupRef);
    }
    if (linkedGroups.size > 1) addIssue(issues, "multi_membership", asset.account);
    if (
      (asset.directGroupRef && !memberGroups.has(asset.directGroupRef)) ||
      (!asset.directGroupRef && memberGroups.size > 0)
    ) {
      addIssue(issues, "membership_evidence_mismatch", asset.account);
    }

    if (linkedGroups.size === 0) {
      classifyStandaloneAsset(
        asset,
        asset.account,
        classifications,
        candidateTargetParts,
        issues,
      );
    }
  }

  for (const group of groups) {
    if (!group.ref) addIssue(issues, "invalid_group_reference", null);
    if (!group.isActive) continue;
    const linkedAssets = [...(groupAssetRefs.get(group.ref) ?? new Set<string>())]
      .map((ref) => assetsByRef.get(ref))
      .filter((asset): asset is NormalizedAsset => Boolean(asset));
    const accounts = new Set(
      linkedAssets.map((asset) => asset.account).filter(isAccount),
    );

    if (linkedAssets.length === 0) {
      addIssue(issues, "empty_group", null);
      continue;
    }
    if (accounts.size > 1) {
      for (const account of accounts) {
        addClassification(classifications, account, "cross_account_scope_unresolved");
        addIssue(issues, "cross_account_group", account);
      }
      continue;
    }
    const account = [...accounts][0];
    if (!account) {
      addIssue(issues, "unsupported_account_evidence", null);
      continue;
    }

    const target = validPercent(group.targetWeight);
    if (target === null) {
      addClassification(classifications, account, "group_target_unresolved");
      addIssue(
        issues,
        group.targetWeight === null ? "missing_group_target" : "invalid_group_target",
        account,
      );
      continue;
    }

    let targetConflict = false;
    for (const asset of linkedAssets) {
      if (validPercent(asset.targetWeight) !== null && (asset.targetWeight ?? 0) > 0) {
        targetConflict = true;
        addIssue(issues, "group_asset_target_overlap", account);
      } else if (asset.targetWeight !== null && validPercent(asset.targetWeight) === null) {
        addIssue(issues, "invalid_asset_target", account);
      }
    }
    if (targetConflict) {
      addClassification(classifications, account, "target_conflict");
      continue;
    }

    if (group.executionMode === "fixed_ratio") {
      const groupMembers = memberRowsByGroup.get(group.ref) ?? [];
      const ratioResult = inspectFixedRatios(groupMembers, linkedAssets.length);
      for (const reason of ratioResult.reasons) addIssue(issues, reason, account);
      if (!ratioResult.complete) {
        addClassification(classifications, account, "group_target_unresolved");
        continue;
      }
      addClassification(classifications, account, "group_fixed_ratio_candidate");
      candidateTargetParts.get(account)?.push(target);
    } else if (
      group.executionMode === "priority" ||
      group.executionMode === "gap_first"
    ) {
      addClassification(classifications, account, "execution_policy_not_target_vector");
    } else {
      addClassification(classifications, account, "group_target_unresolved");
      addIssue(issues, "unknown_execution_mode", account);
    }

    if (
      target > 0 &&
      linkedAssets.some((asset) => !isStructurallyBuyable(asset))
    ) {
      addClassification(classifications, account, "unallocatable_target_candidate");
      addIssue(issues, "structurally_unbuyable_positive_target", account);
    }
  }

  const accountResults = TARGET_POLICY_EVIDENCE_AUDIT_POLICY.supportedAccounts.map(
    (account) => {
      const accountIssues = issues.filter((issue) => issue.account === account);
      const accountClassifications = classifications.get(account) ?? [];
      const preliminaryStatus = evidenceStatus(accountClassifications, accountIssues);
      const targetParts = candidateTargetParts.get(account) ?? [];
      let targetTotalStatus = "not_evaluable";

      if (preliminaryStatus === "resolvable" && targetParts.length > 0) {
        const total = targetParts.reduce((sum, value) => sum + value, 0);
        targetTotalStatus = nearlyEqual(total, 100) ? "exact_100" : "not_100";
        if (targetTotalStatus === "not_100") {
          addIssue(issues, "account_target_sum_unresolved", account);
        }
      }

      const finalIssues = issues.filter((issue) => issue.account === account);
      const accountAssets = assets.filter((asset) => asset.account === account);
      const accountGroups = groups.filter(
        (group) =>
          group.isActive &&
          [...(groupAssetRefs.get(group.ref) ?? new Set<string>())].some(
            (ref) => assetsByRef.get(ref)?.account === account,
          ),
      );
      const accountMembers = activeMembers.filter(
        (member) => assetsByRef.get(member.assetRef)?.account === account,
      );
      return Object.freeze({
        account,
        status: evidenceStatus(accountClassifications, finalIssues),
        assetRows: accountAssets.length,
        activeGroupRows: accountGroups.length,
        activeMemberRows: accountMembers.length,
        evidenceCounts: Object.freeze({
          assetTargetPresent: accountAssets.filter(
            (asset) => asset.targetWeight !== null,
          ).length,
          assetTargetMissing: accountAssets.filter(
            (asset) => asset.targetWeight === null,
          ).length,
          groupTargetPresent: accountGroups.filter(
            (group) => group.targetWeight !== null,
          ).length,
          groupTargetMissing: accountGroups.filter(
            (group) => group.targetWeight === null,
          ).length,
          memberRatioPresent: accountMembers.filter(
            (member) => member.allocationRatio !== null,
          ).length,
          memberRatioMissing: accountMembers.filter(
            (member) => member.allocationRatio === null,
          ).length,
          memberPriorityPresent: accountMembers.filter(
            (member) => member.priority !== null,
          ).length,
          memberPriorityMissing: accountMembers.filter(
            (member) => member.priority === null,
          ).length,
        }),
        classificationCounts: countValues(accountClassifications),
        reasonCounts: countValues(finalIssues.map((issue) => issue.reason)),
        candidateTargetTotalStatus: targetTotalStatus,
      });
    },
  );

  const globalIssues = issues.filter((issue) => issue.account === null);
  const overallStatus = accountResults.some((row) => row.status === "conflict") ||
      globalIssues.some((issue) => isConflictReason(issue.reason))
    ? "conflict"
    : accountResults.some((row) => row.status === "unresolved") || globalIssues.length > 0
      ? "unresolved"
      : "resolvable";

  return Object.freeze({
    auditPolicy: TARGET_POLICY_EVIDENCE_AUDIT_POLICY,
    status: overallStatus,
    rowCounts: Object.freeze({
      assets: assets.length,
      groups: groups.length,
      members: members.length,
      activeGroups: groups.filter((group) => group.isActive).length,
      activeMembers: activeMembers.length,
    }),
    accounts: Object.freeze(accountResults),
    globalReasonCounts: countValues(globalIssues.map((issue) => issue.reason)),
    canonicalTargetVector: null,
  } as const);
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function isAccount(value: Account | null): value is Account {
  return value !== null;
}
