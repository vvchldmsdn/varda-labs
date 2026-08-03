import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import { buildTargetPolicyReviewPacket } from "../src/lib/target-policy-review-packet.ts";

describe("target policy approval persistence schema", () => {
  const source = readFileSync("src/db/schema.ts", "utf8");

  it("stores immutable approval headers, normalized rows, and lifecycle events", () => {
    assert.match(source, /target_policy_approval_revisions/);
    assert.match(source, /target_policy_approval_vector_rows/);
    assert.match(source, /target_policy_approval_lifecycle_events/);
    assert.match(source, /target_policy_revisions_current_unique/);
    assert.match(source, /target_policy_vector_rows_pk/);
    assert.match(source, /target_policy_events_revision_sequence_unique/);
    assert.match(source, /target_policy_approval_audit_v1/);
  });

  it("binds approvals to the canonical owner-account pair", () => {
    assert.match(source, /accounts_id_canonical_owner_unique/);
    assert.match(source, /target_policy_revisions_account_owner_fk/);
    assert.match(
      source,
      /foreignColumns: \[accounts\.id, accounts\.canonicalOwnerUserId\]/,
    );
  });

  it("creates the referenced account-owner uniqueness before the composite FK", () => {
    const migration = readFileSync("drizzle/0022_hot_sir_ram.sql", "utf8");
    const uniqueIndex = migration.indexOf(
      'CREATE UNIQUE INDEX "accounts_id_canonical_owner_unique"',
    );
    const accountOwnerForeignKey = migration.indexOf(
      'ADD CONSTRAINT "target_policy_revisions_account_owner_fk"',
    );

    assert.ok(uniqueIndex >= 0);
    assert.ok(accountOwnerForeignKey >= 0);
    assert.ok(uniqueIndex < accountOwnerForeignKey);
  });

  it("preserves zero-bps rows without a duplicated JSON vector", () => {
    const targetSchema = source.slice(
      source.indexOf("export const targetPolicyApprovalRevisions"),
      source.indexOf("export const assetGroups"),
    );

    assert.match(targetSchema, /between 0 and 10000/);
    assert.doesNotMatch(targetSchema, /jsonb|isCurrent|is_current/);
  });

  it("keeps the reviewed ISA input independently hash-verifiable", () => {
    const payload = JSON.parse(
      readFileSync("operator-inputs/target-policies/isa-v1.json", "utf8"),
    );
    const universe = buildTargetPolicyHoldingUniverse({
      account: payload.account,
      holdings: payload.vector.map((row) => ({
        ...row,
        name: `fixture-${row.ticker}`,
      })),
    });
    const packet = buildTargetPolicyReviewPacket({
      account: payload.account,
      policyVersion: payload.policyVersion,
      effectiveServiceDate: payload.effectiveServiceDate,
      currentHoldings: universe.rows,
      decisions: payload.vector.map((row) => ({
        ...row,
        decision:
          row.targetWeightBps === 0 ? "zero_target" : "positive_target",
        exclusionReason: null,
      })),
    });

    assert.equal(universe.status, "reviewable");
    assert.equal(packet.status, "reviewable");
    assert.equal(universe.universeHash, payload.universeHash);
    assert.equal(packet.vectorHash, payload.vectorHash);
  });

  it("uses an explicit dry-run/write boundary and one atomic transaction", () => {
    const script = readFileSync(
      "scripts/record-approved-target-policy.mjs",
      "utf8",
    );

    assert.match(script, /value === "--write"/);
    assert.match(script, /owner_user_id_required/);
    assert.doesNotMatch(script, /\$2::uuid is null/);
    assert.match(script, /guardProductionDatabaseTarget/);
    assert.match(script, /guardPreviewDatabaseTarget/);
    assert.match(script, /value === "--target"/);
    assert.match(script, /\["production", "preview"\]/);
    assert.match(script, /sql\.transaction/);
    assert.match(script, /pg_advisory_xact_lock/);
    assert.match(script, /inserted_revision/);
    assert.match(script, /inserted_vector/);
    assert.match(script, /inserted_event/);
    assert.match(script, /\$3::varchar/);
    assert.match(script, /database_constraint_violation/);
    assert.match(script, /database_timeout/);
    assert.doesNotMatch(script, /readFile\([^)]*approvalEvidenceRef/);
  });
});
