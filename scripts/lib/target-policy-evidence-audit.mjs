import { classifyTargetPolicyEvidence } from "../../src/lib/target-policy-evidence.ts";

export function auditTargetPolicyEvidence({
  evidence,
  beforeRowCounts,
  afterRowCounts,
}) {
  const classification = classifyTargetPolicyEvidence({
    assets: evidence.assets.map(mapAsset),
    groups: evidence.groups.map(mapGroup),
    members: evidence.members.map(mapMember),
  });
  const rowCountsUnchanged = sameRowCounts(beforeRowCounts, afterRowCounts);

  return Object.freeze({
    audit: "target_policy_evidence_phase0",
    status: rowCountsUnchanged ? "passed" : "failed",
    readOnly: true,
    policyReadiness: classification.status,
    auditPolicy: classification.auditPolicy,
    databaseRowCounts: Object.freeze({
      before: beforeRowCounts,
      after: afterRowCounts,
      unchanged: rowCountsUnchanged,
    }),
    evidenceRowCounts: classification.rowCounts,
    accounts: classification.accounts,
    globalReasonCounts: classification.globalReasonCounts,
    canonicalTargetVector: null,
    boundaries: Object.freeze({
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      routesEnabled: 0,
      allocatorCalls: 0,
    }),
  });
}

function mapAsset(row) {
  return {
    ref: row.ref,
    account: row.account,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    targetWeight: row.target_weight,
    directGroupRef: row.direct_group_ref,
  };
}

function mapGroup(row) {
  return {
    ref: row.ref,
    targetWeight: row.target_weight,
    executionMode: row.execution_mode,
    isActive: Boolean(row.is_active),
  };
}

function mapMember(row) {
  return {
    groupRef: row.group_ref,
    assetRef: row.asset_ref,
    allocationRatio: row.allocation_ratio,
    priority: nullableNumber(row.priority),
    isActive: Boolean(row.is_active),
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameRowCounts(left, right) {
  return (
    left.assets === right.assets &&
    left.assetGroups === right.assetGroups &&
    left.assetGroupMembers === right.assetGroupMembers
  );
}
