import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { classifyTargetPolicyEvidence } from "../src/lib/target-policy-evidence.ts";
import { auditTargetPolicyEvidence } from "../scripts/lib/target-policy-evidence-audit.mjs";

describe("target policy evidence phase 0", () => {
  it("classifies complete standalone targets without creating a vector", () => {
    const result = classifyTargetPolicyEvidence({
      assets: [
        asset("brokerage-a", { targetWeight: 100 }),
        asset("isa-a", { account: "isa", targetWeight: 100 }),
        asset("irp-a", { account: "irp", targetWeight: 100 }),
      ],
      groups: [],
      members: [],
    });

    assert.equal(result.status, "resolvable");
    for (const account of result.accounts) {
      assert.equal(account.status, "resolvable");
      assert.equal(
        account.classificationCounts.standalone_asset_target_candidate,
        1,
      );
      assert.equal(account.candidateTargetTotalStatus, "exact_100");
    }
    assert.equal(result.canonicalTargetVector, null);
  });

  it("classifies a complete fixed-ratio group as candidate evidence", () => {
    const result = classifyTargetPolicyEvidence(
      groupedFixture({ executionMode: "fixed_ratio", ratios: [60, 40] }),
    );
    const brokerage = accountResult(result, "brokerage");

    assert.equal(brokerage.status, "resolvable");
    assert.equal(brokerage.classificationCounts.group_fixed_ratio_candidate, 1);
    assert.equal(brokerage.candidateTargetTotalStatus, "exact_100");
    assert.deepEqual(brokerage.evidenceCounts, {
      assetTargetPresent: 0,
      assetTargetMissing: 2,
      groupTargetPresent: 1,
      groupTargetMissing: 0,
      memberRatioPresent: 2,
      memberRatioMissing: 0,
      memberPriorityPresent: 2,
      memberPriorityMissing: 0,
    });
    assert.equal(result.canonicalTargetVector, null);
  });

  it("rejects missing, zero, non-finite, incomplete, and mismatched ratios", () => {
    const cases = [
      { ratios: [null, 100], reason: "missing_member_ratio" },
      { ratios: [0, 100], reason: "invalid_member_ratio" },
      { ratios: [Number.POSITIVE_INFINITY, 100], reason: "invalid_member_ratio" },
      { ratios: [60, 30], reason: "member_ratio_sum_mismatch" },
    ];

    for (const fixture of cases) {
      const result = classifyTargetPolicyEvidence(
        groupedFixture({ executionMode: "fixed_ratio", ratios: fixture.ratios }),
      );
      const brokerage = accountResult(result, "brokerage");

      assert.equal(brokerage.status, "unresolved");
      assert.equal(brokerage.classificationCounts.group_target_unresolved, 1);
      assert.ok(brokerage.reasonCounts[fixture.reason] >= 1);
      assert.equal(result.canonicalTargetVector, null);
    }

    const incomplete = groupedFixture({
      executionMode: "fixed_ratio",
      ratios: [60, 40],
    });
    incomplete.members.pop();
    const incompleteResult = classifyTargetPolicyEvidence(incomplete);
    const incompleteBrokerage = accountResult(incompleteResult, "brokerage");
    assert.equal(incompleteBrokerage.classificationCounts.group_target_unresolved, 1);
    assert.ok(incompleteBrokerage.reasonCounts.missing_member_ratio >= 1);
  });

  it("keeps priority and gap-first evidence out of target-vector authority", () => {
    for (const executionMode of ["priority", "gap_first"]) {
      const result = classifyTargetPolicyEvidence(
        groupedFixture({ executionMode, ratios: [60, 40] }),
      );
      const brokerage = accountResult(result, "brokerage");

      assert.equal(brokerage.status, "unresolved");
      assert.equal(
        brokerage.classificationCounts.execution_policy_not_target_vector,
        1,
      );
      assert.equal(brokerage.candidateTargetTotalStatus, "not_evaluable");
      assert.equal(result.canonicalTargetVector, null);
    }
  });

  it("marks overlapping positive group and asset targets as conflict", () => {
    const fixture = groupedFixture({
      executionMode: "fixed_ratio",
      ratios: [60, 40],
    });
    fixture.assets[0] = { ...fixture.assets[0], targetWeight: 60 };
    const result = classifyTargetPolicyEvidence(fixture);
    const brokerage = accountResult(result, "brokerage");

    assert.equal(brokerage.status, "conflict");
    assert.equal(brokerage.classificationCounts.target_conflict, 1);
    assert.equal(brokerage.reasonCounts.group_asset_target_overlap, 1);
  });

  it("blocks cross-account group scope", () => {
    const fixture = groupedFixture({
      executionMode: "fixed_ratio",
      ratios: [60, 40],
    });
    fixture.assets[1] = { ...fixture.assets[1], account: "isa" };
    const result = classifyTargetPolicyEvidence(fixture);

    assert.equal(
      accountResult(result, "brokerage").classificationCounts
        .cross_account_scope_unresolved,
      1,
    );
    assert.equal(
      accountResult(result, "isa").classificationCounts
        .cross_account_scope_unresolved,
      1,
    );
    assert.equal(result.canonicalTargetVector, null);
  });

  it("detects orphan, duplicate, mismatched, and multi-group membership", () => {
    const fixture = groupedFixture({
      executionMode: "fixed_ratio",
      ratios: [60, 40],
    });
    fixture.groups.push(group("group-b", { targetWeight: 0 }));
    fixture.assets[1] = {
      ...fixture.assets[1],
      directGroupRef: "group-b",
    };
    fixture.members.push(
      member("group-a", "asset-a", 60),
      member("group-b", "asset-a", 100),
      member("missing-group", "asset-a", 100),
      member("group-a", "missing-asset", 100),
    );
    const result = classifyTargetPolicyEvidence(fixture);
    const brokerage = accountResult(result, "brokerage");

    assert.equal(brokerage.status, "conflict");
    assert.ok(brokerage.reasonCounts.duplicate_member >= 1);
    assert.ok(brokerage.reasonCounts.multi_membership >= 1);
    assert.ok(brokerage.reasonCounts.membership_evidence_mismatch >= 1);
    assert.equal(result.globalReasonCounts.orphan_member_asset, 1);
    assert.equal(result.canonicalTargetVector, null);
  });

  it("marks a positive target without a buyable identity as unallocatable", () => {
    const result = classifyTargetPolicyEvidence({
      assets: [asset("asset-a", { ticker: null, targetWeight: 100 })],
      groups: [],
      members: [],
    });
    const brokerage = accountResult(result, "brokerage");

    assert.equal(brokerage.status, "unresolved");
    assert.equal(
      brokerage.classificationCounts.unallocatable_target_candidate,
      1,
    );
    assert.equal(
      brokerage.reasonCounts.structurally_unbuyable_positive_target,
      1,
    );
  });

  it("excludes all-account evidence and is independent of input ordering", () => {
    const fixture = groupedFixture({
      executionMode: "fixed_ratio",
      ratios: [60, 40],
    });
    fixture.assets.push(asset("all-a", { account: "all", targetWeight: 100 }));
    const forward = classifyTargetPolicyEvidence(fixture);
    const reversed = classifyTargetPolicyEvidence({
      assets: [...fixture.assets].reverse(),
      groups: [...fixture.groups].reverse(),
      members: [...fixture.members].reverse(),
    });

    assert.deepEqual(forward, reversed);
    assert.deepEqual(
      forward.accounts.map((row) => row.account),
      ["brokerage", "isa", "irp"],
    );
    assert.equal(forward.globalReasonCounts.unsupported_account_evidence, 1);
  });

  it("returns only sanitized aggregate evidence and proves row counts unchanged", () => {
    const evidence = toDatabaseEvidence(
      groupedFixture({ executionMode: "fixed_ratio", ratios: [60, 40] }),
    );
    const rowCounts = {
      assets: 2,
      assetGroups: 1,
      assetGroupMembers: 2,
    };
    const result = auditTargetPolicyEvidence({
      evidence,
      beforeRowCounts: rowCounts,
      afterRowCounts: { ...rowCounts },
    });

    assert.equal(result.status, "passed");
    assert.equal(result.databaseRowCounts.unchanged, true);
    assert.equal(result.canonicalTargetVector, null);
    assert.deepEqual(result.boundaries, {
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      routesEnabled: 0,
      allocatorCalls: 0,
    });

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
    assert.doesNotMatch(
      serialized,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    assert.doesNotMatch(serialized, /targetWeight|allocationRatio|directGroupRef/);
  });

  it("fails the audit invariant when any source row count changes", () => {
    const result = auditTargetPolicyEvidence({
      evidence: { assets: [], groups: [], members: [] },
      beforeRowCounts: { assets: 1, assetGroups: 0, assetGroupMembers: 0 },
      afterRowCounts: { assets: 2, assetGroups: 0, assetGroupMembers: 0 },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.databaseRowCounts.unchanged, false);
  });

  it("keeps every audit source read-only, provider-free, and allocator-free", () => {
    const source = [
      "scripts/audit-target-policy-evidence.mjs",
      "scripts/lib/target-policy-evidence-audit.mjs",
      "scripts/lib/target-policy-evidence-data.mjs",
      "scripts/lib/target-policy-evidence-sql.mjs",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /\bfetch\s*\(/i);
    assert.doesNotMatch(source, /\/api\/|admin\/jobs|server action/i);
    assert.doesNotMatch(source, /allocateAdditionalContribution|targetPolicyResolver/i);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
  });
});

function accountResult(result, account) {
  return result.accounts.find((row) => row.account === account);
}

function groupedFixture({ executionMode, ratios }) {
  return {
    assets: [
      asset("asset-a", { targetWeight: null, directGroupRef: "group-a" }),
      asset("asset-b", { targetWeight: null, directGroupRef: "group-a" }),
    ],
    groups: [group("group-a", { executionMode, targetWeight: 100 })],
    members: [
      member("group-a", "asset-a", ratios[0], 1),
      member("group-a", "asset-b", ratios[1], 2),
    ],
  };
}

function asset(ref, overrides = {}) {
  return {
    ref,
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    ticker: ref.toUpperCase(),
    targetWeight: 0,
    directGroupRef: null,
    ...overrides,
  };
}

function group(ref, overrides = {}) {
  return {
    ref,
    targetWeight: null,
    executionMode: "gap_first",
    isActive: true,
    ...overrides,
  };
}

function member(groupRef, assetRef, allocationRatio, priority = null) {
  return {
    groupRef,
    assetRef,
    allocationRatio,
    priority,
    isActive: true,
  };
}

function toDatabaseEvidence(fixture) {
  return {
    assets: fixture.assets.map((row, index) => ({
      ref: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      account: row.account,
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      target_weight: row.targetWeight,
      direct_group_ref: row.directGroupRef
        ? "20000000-0000-4000-8000-000000000000"
        : null,
    })),
    groups: fixture.groups.map((row) => ({
      ref: "20000000-0000-4000-8000-000000000000",
      target_weight: row.targetWeight,
      execution_mode: row.executionMode,
      is_active: row.isActive,
    })),
    members: fixture.members.map((row, index) => ({
      group_ref: "20000000-0000-4000-8000-000000000000",
      asset_ref: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      allocation_ratio: row.allocationRatio,
      priority: row.priority,
      is_active: row.isActive,
    })),
  };
}
