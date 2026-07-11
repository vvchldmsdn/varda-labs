import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  CoreImportArgumentError,
  buildBase44CoreCanonicalPlan,
  parseBase44CoreArgs,
} from "../scripts/lib/base44-core-canonical-plan.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER = "base44-import-private";

describe("Base44 core canonical owner Phase 1E-A", () => {
  it("keeps the canonical candidate explicit and hard-blocks actual writes", () => {
    const parsed = parseBase44CoreArgs(
      [
        "--canonical-owner-id",
        OWNER_A,
        "--approve-provisioning-owner",
      ],
      { defaultDataDir: "migration-data", legacyOwnerUserId: LEGACY_OWNER },
    );

    assert.equal(parsed.canonicalOwnerId, OWNER_A);
    assert.equal(parsed.approveProvisioningOwner, true);
    assert.equal(parsed.write, false);

    assert.throws(
      () =>
        parseBase44CoreArgs(
          ["--canonical-owner-id", OWNER_A, "--write"],
          { defaultDataDir: "migration-data", legacyOwnerUserId: LEGACY_OWNER },
        ),
      (error) =>
        error instanceof CoreImportArgumentError &&
        error.code === "canonical_owner_write_not_enabled",
    );
    assert.throws(
      () =>
        parseBase44CoreArgs(["--canonical-owner-id", "not-a-uuid"], {
          defaultDataDir: "migration-data",
          legacyOwnerUserId: LEGACY_OWNER,
        }),
      (error) =>
        error instanceof CoreImportArgumentError &&
        error.code === "invalid_canonical_owner_id",
    );
  });

  it("plans null-owner core rows without enabling a canonical write", () => {
    const plan = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: OWNER_A,
      approveProvisioningOwner: true,
      legacyOwnerUserId: LEGACY_OWNER,
      appUser: { status: "provisioning", role: "user" },
      tables: fixtureTables(null),
    });

    assert.equal(plan.result, "planned");
    assert.equal(plan.mode, "shadow");
    assert.equal(plan.source, "migration_cli");
    assert.equal(plan.actualWriteAllowed, false);
    assert.equal(plan.canonicalOwnerWriteEnabled, false);
    assert.equal(plan.databaseSideEffects, false);
    assert.deepEqual(plan.tables, {
      accounts: { insert: 0, update: 2, skip: 0, block: 0 },
      asset_groups: { insert: 0, update: 1, skip: 0, block: 0 },
      assets: { insert: 0, update: 2, skip: 0, block: 0 },
      asset_group_members: { insert: 0, update: 1, skip: 0, block: 0 },
    });
    assert.equal(plan.plannedCanonicalAssignments, 6);
    assert.deepEqual(plan.blockers, []);
  });

  it("requires explicit approval for a provisioning migration owner", () => {
    const plan = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: OWNER_A,
      approveProvisioningOwner: false,
      legacyOwnerUserId: LEGACY_OWNER,
      appUser: { status: "provisioning", role: "user" },
      tables: fixtureTables(null),
    });

    assert.equal(plan.result, "blocked");
    assert.ok(
      plan.blockers.includes(
        "canonical_owner_context_provisioning_owner_not_approved",
      ),
    );
    for (const table of Object.values(plan.tables)) {
      assert.equal(table.insert + table.update + table.skip, 0);
      assert.ok(table.block > 0);
    }
  });

  it("skips same-owner rows and blocks reassignment through descendants", () => {
    const sameOwner = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: OWNER_A,
      approveProvisioningOwner: false,
      legacyOwnerUserId: LEGACY_OWNER,
      appUser: { status: "active", role: "user" },
      tables: fixtureTables(OWNER_A),
    });
    assert.equal(sameOwner.result, "planned");
    assert.equal(sameOwner.plannedCanonicalAssignments, 0);
    assert.equal(sameOwner.tables.assets.skip, 2);

    const foreignTables = fixtureTables(OWNER_A);
    foreignTables.asset_groups[0] = row(OWNER_B);
    const foreignOwner = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: OWNER_A,
      approveProvisioningOwner: false,
      legacyOwnerUserId: LEGACY_OWNER,
      appUser: { status: "active", role: "user" },
      tables: foreignTables,
    });

    assert.equal(foreignOwner.result, "blocked");
    assert.equal(foreignOwner.tables.asset_groups.block, 1);
    assert.equal(foreignOwner.tables.assets.block, 1);
    assert.equal(foreignOwner.tables.asset_group_members.block, 1);
    assert.ok(foreignOwner.blockers.includes("cross_owner_assignment_detected"));
    assert.ok(foreignOwner.blockers.includes("parent_child_contract_mismatch"));
  });

  it("returns only aggregate plans and never exposes owner or legacy identifiers", () => {
    const plan = buildBase44CoreCanonicalPlan({
      canonicalOwnerId: OWNER_A,
      approveProvisioningOwner: true,
      legacyOwnerUserId: LEGACY_OWNER,
      appUser: { status: "provisioning", role: "user" },
      tables: fixtureTables(null),
    });
    const serialized = JSON.stringify(plan);

    assert.doesNotMatch(serialized, new RegExp(OWNER_A, "i"));
    assert.doesNotMatch(serialized, new RegExp(OWNER_B, "i"));
    assert.doesNotMatch(serialized, new RegExp(LEGACY_OWNER, "i"));
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
  });

  it("preserves the legacy dry-run arguments with sanitized output wiring", () => {
    const parsed = parseBase44CoreArgs([], {
      defaultDataDir: "migration-data",
      legacyOwnerUserId: LEGACY_OWNER,
    });
    const coreSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-core.mjs"),
      "utf8",
    );

    assert.equal(parsed.write, false);
    assert.equal(parsed.ownerUserId, LEGACY_OWNER);
    assert.equal(parsed.canonicalOwnerId, null);
    assert.match(coreSource, /"legacy-evidence"/);
    assert.match(coreSource, /Dry run only/);
    assert.doesNotMatch(coreSource, /dataDir:\s*args\.dataDir/);
    assert.doesNotMatch(coreSource, /ownerUserId:\s*args\.ownerUserId/);
    assert.doesNotMatch(coreSource, /unmatchedGroupRefs/);
    assert.doesNotMatch(coreSource, /console\.error\(error\)/);
  });

  it("keeps the shadow state loader read-only and preserves legacy columns", () => {
    const stateSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-core-canonical-state.mjs"),
      "utf8",
    );
    const coreSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-core.mjs"),
      "utf8",
    );

    assert.doesNotMatch(
      stateSource,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i,
    );
    assert.doesNotMatch(coreSource, /canonical_owner_user_id/);
    assert.doesNotMatch(coreSource, /created_by_id\s*=|created_by_id\s*,/i);
    assert.match(coreSource, /owner_user_id = excluded\.owner_user_id/);
  });
});

function fixtureTables(owner) {
  return {
    accounts: [row(owner), row(owner)],
    asset_groups: [row(owner)],
    assets: [
      {
        ...row(owner),
        accountIndex: 0,
        groupIndex: 0,
        accountReferenceMatches: true,
        groupReferenceMatches: true,
      },
      {
        ...row(owner),
        accountIndex: 1,
        groupIndex: null,
        accountReferenceMatches: true,
        groupReferenceMatches: true,
      },
    ],
    asset_group_members: [
      {
        ...row(owner),
        groupIndex: 0,
        assetIndex: 0,
        groupReferenceMatches: true,
        assetReferenceMatches: true,
      },
    ],
  };
}

function row(canonicalOwnerUserId) {
  return { exists: true, canonicalOwnerUserId };
}
