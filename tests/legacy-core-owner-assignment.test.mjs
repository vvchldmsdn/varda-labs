import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY,
  LegacyCoreOwnerAssignmentCliError,
  readLegacyCoreOwnerAssignmentCliOptions,
} from "../scripts/assign-legacy-core-owners.mjs";
import {
  buildLegacyCoreOwnerAssignmentPlan,
  LegacyCoreOwnerAssignmentError,
} from "../scripts/lib/legacy-core-owner-assignment.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const MEMBER_ID = "66666666-6666-4666-8666-666666666666";
const IDENTITY_ID = "77777777-7777-4777-8777-777777777777";
const MANIFEST_SHA256 = `sha256:${"a".repeat(64)}`;
const TARGET_SHA256 = `sha256:${"b".repeat(64)}`;

describe("legacy core owner assignment", () => {
  it("plans only unowned core rows and produces stable sanitized evidence", () => {
    const input = fixture();
    const plan = buildLegacyCoreOwnerAssignmentPlan(input);
    const reordered = buildLegacyCoreOwnerAssignmentPlan({
      ...input,
      assets: [...input.assets].reverse(),
      assetGroups: [...input.assetGroups].reverse(),
      assetGroupMembers: [...input.assetGroupMembers].reverse(),
    });

    assert.equal(plan.state, "assignment_pending");
    assert.deepEqual(plan.candidateCounts, {
      accounts: 1,
      assets: 1,
      assetGroups: 1,
      assetGroupMembers: 1,
    });
    assert.deepEqual(plan.plannedWrites, {
      assets: 1,
      assetGroups: 1,
      assetGroupMembers: 1,
    });
    assert.deepEqual(plan.eligibleIds, {
      assets: [ASSET_ID],
      assetGroups: [GROUP_ID],
      assetGroupMembers: [MEMBER_ID],
    });
    assert.match(plan.manifestSha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(plan.ownerFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(reordered.manifestSha256, plan.manifestSha256);
    assert.equal(JSON.stringify(plan).includes("069500"), false);
  });

  it("recognizes an idempotently completed assignment", () => {
    const input = fixture();
    for (const rows of [
      input.assets,
      input.assetGroups,
      input.assetGroupMembers,
    ]) {
      rows[0].canonical_owner_user_id = OWNER_ID;
    }

    const plan = buildLegacyCoreOwnerAssignmentPlan(input);
    assert.equal(plan.state, "already_applied");
    assert.deepEqual(plan.plannedWrites, {
      assets: 0,
      assetGroups: 0,
      assetGroupMembers: 0,
    });
  });

  it("blocks conflicting owners, broken relationships, and collisions", () => {
    const cases = [
      [
        () => {
          const input = fixture();
          input.assets[0].canonical_owner_user_id = OTHER_OWNER_ID;
          return input;
        },
        "asset_owner_conflict",
      ],
      [
        () => {
          const input = fixture();
          input.assets[0].account = "isa";
          return input;
        },
        "asset_account_relationship_invalid",
      ],
      [
        () => {
          const input = fixture();
          input.assetGroupMembers[0].asset_id = OTHER_OWNER_ID;
          return input;
        },
        "asset_group_member_relationship_invalid",
      ],
      [
        () => {
          const input = fixture();
          input.assets.push({
            ...input.assets[0],
            id: OTHER_OWNER_ID,
          });
          return input;
        },
        "asset_owner_instrument_collision",
      ],
    ];

    for (const [makeInput, code] of cases) {
      assert.throws(
        () => buildLegacyCoreOwnerAssignmentPlan(makeInput()),
        (error) =>
          error instanceof LegacyCoreOwnerAssignmentError &&
          error.code === code,
      );
    }
  });

  it("defaults to dry-run and requires exact reviewed evidence for write", () => {
    assert.deepEqual(readLegacyCoreOwnerAssignmentCliOptions([]), {
      mode: "dry_run",
      write: false,
      reviewedManifestSha256: null,
      reviewedDatabaseTargetFingerprint: null,
    });
    assert.deepEqual(
      readLegacyCoreOwnerAssignmentCliOptions([
        "--write",
        LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
        "--reviewed-manifest-sha256",
        MANIFEST_SHA256,
        "--reviewed-database-target-fingerprint",
        TARGET_SHA256,
      ]),
      {
        mode: "write",
        write: true,
        reviewedManifestSha256: MANIFEST_SHA256,
        reviewedDatabaseTargetFingerprint: TARGET_SHA256,
      },
    );

    for (const args of [
      ["--write"],
      [LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation],
      ["--reviewed-manifest-sha256", MANIFEST_SHA256],
      [
        "--write",
        LEGACY_CORE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
        "--reviewed-manifest-sha256",
        "invalid",
        "--reviewed-database-target-fingerprint",
        TARGET_SHA256,
      ],
    ]) {
      assert.throws(
        () => readLegacyCoreOwnerAssignmentCliOptions(args),
        (error) =>
          error instanceof LegacyCoreOwnerAssignmentCliError,
      );
    }
  });
});

function fixture() {
  return {
    appUsers: [
      {
        id: OWNER_ID,
        status: "active",
        role: "user",
      },
    ],
    authIdentities: [
      {
        id: IDENTITY_ID,
        app_user_id: OWNER_ID,
        status: "active",
      },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        canonical_owner_user_id: OWNER_ID,
        code: "brokerage",
      },
    ],
    assets: [
      {
        id: ASSET_ID,
        canonical_owner_user_id: null,
        account_id: ACCOUNT_ID,
        account: "brokerage",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
    ],
    assetGroups: [
      {
        id: GROUP_ID,
        canonical_owner_user_id: null,
      },
    ],
    assetGroupMembers: [
      {
        id: MEMBER_ID,
        canonical_owner_user_id: null,
        group_id: GROUP_ID,
        asset_id: ASSET_ID,
      },
    ],
  };
}
