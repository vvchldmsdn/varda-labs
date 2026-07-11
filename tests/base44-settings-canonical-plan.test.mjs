import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  SettingsImportArgumentError,
  buildBase44SettingsCanonicalPlan,
  parseBase44SettingsArgs,
} from "../scripts/lib/base44-settings-canonical-plan.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const LEGACY_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const LEGACY_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("Base44 settings canonical owner Phase 1E-B", () => {
  it("requires an explicit canonical candidate and blocks actual writes", () => {
    const parsed = parseBase44SettingsArgs([
      "--canonical-owner-id",
      OWNER_A.toUpperCase(),
      "--approve-provisioning-owner",
    ]);

    assert.equal(parsed.canonicalOwnerId, OWNER_A);
    assert.equal(parsed.approveProvisioningOwner, true);
    assert.equal(parsed.write, false);

    assert.throws(
      () =>
        parseBase44SettingsArgs([
          "--canonical-owner-id",
          OWNER_A,
          "--write",
        ]),
      (error) =>
        error instanceof SettingsImportArgumentError &&
        error.code === "canonical_owner_write_not_enabled",
    );
    assert.throws(
      () => parseBase44SettingsArgs(["--canonical-owner-id", "invalid"]),
      (error) =>
        error instanceof SettingsImportArgumentError &&
        error.code === "invalid_canonical_owner_id",
    );
  });

  it("plans one missing owner assignment without enabling a write", () => {
    const plan = buildPlan({ existingOwner: null });

    assert.equal(plan.result, "planned");
    assert.equal(plan.reason, "canonical_owner_missing");
    assert.equal(plan.mode, "shadow");
    assert.equal(plan.source, "migration_cli");
    assert.equal(plan.actualWriteAllowed, false);
    assert.equal(plan.canonicalOwnerWriteEnabled, false);
    assert.equal(plan.databaseSideEffects, false);
    assert.deepEqual(plan.candidateCounts, { source: 1, database: 1 });
    assert.deepEqual(plan.tables.settings, {
      insert: 0,
      update: 1,
      skip: 0,
      block: 0,
    });
    assert.equal(plan.plannedCanonicalAssignments, 1);
    assert.deepEqual(plan.reasons, []);
    for (const value of Object.values(plan.fingerprints)) {
      assert.match(value, /^sha256:[0-9a-f]{16}$/);
    }
  });

  it("plans insert for an absent candidate and skip for a same-owner rerun", () => {
    const insert = buildPlan({ databaseRows: [] });
    assert.equal(insert.result, "planned");
    assert.equal(insert.reason, "settings_candidate_absent");
    assert.equal(insert.tables.settings.insert, 1);

    const sameOwner = buildPlan({ existingOwner: OWNER_A });
    assert.equal(sameOwner.result, "planned");
    assert.equal(sameOwner.reason, "canonical_owner_already_matches");
    assert.equal(sameOwner.tables.settings.skip, 1);
    assert.equal(sameOwner.plannedCanonicalAssignments, 0);
  });

  it("blocks a foreign owner without planning reassignment", () => {
    const plan = buildPlan({ existingOwner: OWNER_B });

    assert.equal(plan.result, "blocked");
    assert.equal(plan.reason, "canonical_owner_conflict");
    assert.equal(plan.tables.settings.block, 1);
    assert.equal(plan.plannedCanonicalAssignments, 0);
    assert.deepEqual(plan.reasons, ["canonical_owner_conflict"]);
  });

  it("blocks duplicate and mismatched settings candidates without selection", () => {
    const duplicateSource = buildPlan({
      sourceRows: [sourceRow(LEGACY_A), sourceRow(LEGACY_B)],
    });
    assert.equal(duplicateSource.result, "blocked");
    assert.ok(
      duplicateSource.reasons.includes("ambiguous_source_candidate_count"),
    );

    const duplicateDatabase = buildPlan({
      databaseRows: [databaseRow(LEGACY_A, null), databaseRow(LEGACY_B, null)],
    });
    assert.equal(duplicateDatabase.result, "blocked");
    assert.ok(
      duplicateDatabase.reasons.includes("ambiguous_database_candidate_count"),
    );

    const mismatched = buildPlan({
      databaseRows: [databaseRow(LEGACY_B, null)],
    });
    assert.equal(mismatched.result, "blocked");
    assert.ok(
      mismatched.reasons.includes("database_candidate_identity_mismatch"),
    );
  });

  it("requires explicit provisioning approval and never infers from cardinality", () => {
    const unapproved = buildPlan({ approveProvisioningOwner: false });
    assert.equal(unapproved.result, "blocked");
    assert.ok(
      unapproved.reasons.includes(
        "canonical_owner_context_provisioning_owner_not_approved",
      ),
    );

    const missingUser = buildPlan({ appUser: null });
    assert.equal(missingUser.result, "blocked");
    assert.ok(missingUser.reasons.includes("canonical_owner_not_found"));
    assert.equal(missingUser.candidateCounts.database, 1);
  });

  it("returns only aggregate reasons and fingerprints", () => {
    const serialized = JSON.stringify(buildPlan({ existingOwner: null }));

    assert.doesNotMatch(serialized, new RegExp(OWNER_A, "i"));
    assert.doesNotMatch(serialized, new RegExp(OWNER_B, "i"));
    assert.doesNotMatch(serialized, new RegExp(LEGACY_A, "i"));
    assert.doesNotMatch(serialized, new RegExp(LEGACY_B, "i"));
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
  });

  it("keeps the state loader read-only and legacy settings DML owner-free", () => {
    const stateSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-settings-canonical-state.mjs"),
      "utf8",
    );
    const importSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-settings.mjs"),
      "utf8",
    );

    assert.doesNotMatch(
      stateSource,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|truncate)\b/i,
    );
    assert.doesNotMatch(importSource, /canonical_owner_user_id/);
    assert.match(importSource, /on conflict \(legacy_base44_id\) do update set/);
    assert.match(importSource, /"legacy-evidence"/);
    assert.match(importSource, /Dry run only/);
    assert.doesNotMatch(importSource, /dataDir:\s*args\.dataDir/);
    assert.doesNotMatch(importSource, /legacyBase44Ids/);
    assert.doesNotMatch(importSource, /console\.error\(error\)/);
  });
});

function buildPlan({
  existingOwner = null,
  approveProvisioningOwner = true,
  appUser = { status: "provisioning", role: "user" },
  sourceRows = [sourceRow(LEGACY_A)],
  databaseRows,
} = {}) {
  return buildBase44SettingsCanonicalPlan({
    canonicalOwnerId: OWNER_A,
    approveProvisioningOwner,
    appUser,
    sourceRows,
    databaseRows:
      databaseRows ?? [databaseRow(LEGACY_A, existingOwner)],
  });
}

function sourceRow(legacyBase44Id) {
  return {
    legacyBase44Id,
    annualIncomeGrowth: "3",
    useTrendFilter: true,
  };
}

function databaseRow(legacyBase44Id, canonicalOwnerUserId) {
  return { legacyBase44Id, canonicalOwnerUserId };
}
