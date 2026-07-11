import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  INITIAL_APP_USER_WRITE_CONFIRMATION,
  ProvisioningArgumentError,
  buildInitialProvisioningPlan,
  parseProvisioningArgs,
} from "../scripts/lib/initial-app-user-provisioning.mjs";
import {
  PROVISIONING_ADVISORY_LOCK_SQL,
  buildActualProvisioningOutput,
  buildLockedProvisioningQuery,
} from "../scripts/lib/initial-app-user-write.mjs";
import { readWriterReadiness } from "../scripts/lib/initial-app-user-readiness.mjs";
import { USER_OWNED_TABLE_NAMES } from "../scripts/lib/tenant-ownership-policy.mjs";

const ROOT = process.cwd();
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

describe("initial app-user provisioning", () => {
  it("defaults to dry-run and requires an explicit CLI owner UUID", () => {
    assert.deepEqual(
      parseProvisioningArgs(["--initial-owner-id", OWNER_A]),
      { initialOwnerId: OWNER_A, write: false },
    );
    assertArgumentError(
      () => parseProvisioningArgs([]),
      "missing_initial_owner_id",
    );
    assertArgumentError(
      () => parseProvisioningArgs(["--initial-owner-id", OWNER_A, "--write"]),
      "missing_write_confirmation",
    );
    assert.deepEqual(
      parseProvisioningArgs([
        "--initial-owner-id",
        OWNER_A,
        "--write",
        "--confirm",
        INITIAL_APP_USER_WRITE_CONFIRMATION,
      ]),
      { initialOwnerId: OWNER_A, write: true },
    );
  });

  it("plans exactly one provisioning/user row from the empty state", () => {
    const plan = buildInitialProvisioningPlan({
      initialOwnerId: OWNER_A,
      state: readyState(),
    });

    assert.equal(plan.mode, "dry_run");
    assert.equal(plan.result, "planned_insert");
    assert.deepEqual(plan.appUserCount, { current: 0, expected: 1 });
    assert.deepEqual(plan.plannedWrites, {
      appUsers: 1,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    });
    assert.equal(plan.committed, false);
    assert.equal(plan.databaseSideEffects, false);
    assertSafeOutput(plan);
  });

  it("blocks malformed UUIDs without reflecting input", () => {
    const malformed = "not-a-uuid-secret-shaped-input";
    const plan = buildInitialProvisioningPlan({
      initialOwnerId: malformed,
      state: readyState(),
    });

    assert.equal(plan.result, "blocked");
    assert.deepEqual(plan.blockers, ["invalid_initial_owner_id"]);
    assert.equal(JSON.stringify(plan).includes(malformed), false);
    assertSafeOutput(plan);
  });

  it("blocks a different existing app user", () => {
    const plan = buildInitialProvisioningPlan({
      initialOwnerId: OWNER_A,
      state: readyState({
        appUsers: [appUser(OWNER_B)],
      }),
    });

    assert.equal(plan.result, "blocked");
    assert.ok(plan.blockers.includes("different_app_user_exists"));
    assert.deepEqual(plan.plannedWrites, {
      appUsers: 0,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    });
  });

  it("treats an exact provisioning/user rerun as idempotent", () => {
    const plan = buildInitialProvisioningPlan({
      initialOwnerId: OWNER_A,
      state: readyState({ appUsers: [appUser(OWNER_A)] }),
    });

    assert.equal(plan.result, "already_provisioned");
    assert.deepEqual(plan.appUserCount, { current: 1, expected: 1 });
    assert.equal(plan.plannedWrites.appUsers, 0);
    assertSafeOutput(plan);
  });

  it("blocks a same-UUID status or role mismatch without repairing it", () => {
    for (const existing of [
      appUser(OWNER_A, { status: "active" }),
      appUser(OWNER_A, { role: "admin" }),
    ]) {
      const plan = buildInitialProvisioningPlan({
        initialOwnerId: OWNER_A,
        state: readyState({ appUsers: [existing] }),
      });

      assert.equal(plan.result, "blocked");
      assert.ok(plan.blockers.includes("existing_app_user_state_mismatch"));
      assert.equal(plan.plannedWrites.appUsers, 0);
    }
  });

  it("blocks preexisting identity, canonical owner, schema, or writer drift", () => {
    const scenarios = [
      [
        { authIdentityCount: 1 },
        "auth_identity_preexists",
      ],
      [
        { canonicalOwnerNonNullRows: 1 },
        "canonical_owner_preexists",
      ],
      [
        { schemaContractValid: false },
        "identity_schema_mismatch",
      ],
      [
        {
          writerReadiness: {
            registryShadow: false,
            runtimeOwnerIntegrationCount: 1,
            httpCanonicalOwnerInputCount: 0,
            ownerInferencePathCount: 0,
          },
        },
        "writer_registry_not_shadow",
      ],
    ];

    for (const [override, expectedBlocker] of scenarios) {
      const plan = buildInitialProvisioningPlan({
        initialOwnerId: OWNER_A,
        state: readyState(override),
      });
      assert.equal(plan.result, "blocked");
      assert.ok(plan.blockers.includes(expectedBlocker));
      assert.equal(plan.plannedWrites.appUsers, 0);
    }
  });

  it("freezes one parameterized insert and no other table DML", () => {
    const query = buildLockedProvisioningQuery(
      OWNER_A,
      USER_OWNED_TABLE_NAMES,
    );
    const normalized = query.text.replace(/\s+/g, " ").toLowerCase();

    assert.equal((normalized.match(/insert into app_users/g) ?? []).length, 1);
    assert.doesNotMatch(normalized, /insert into auth_identities/);
    assert.doesNotMatch(normalized, /\b(?:update|delete|truncate)\b/);
    assert.doesNotMatch(normalized, /on conflict/);
    assert.equal(query.text.includes(OWNER_A), false);
    assert.deepEqual(query.params, [OWNER_A]);
    for (const table of USER_OWNED_TABLE_NAMES) {
      assert.match(normalized, new RegExp(`from "${table}"`));
    }
  });

  it("serializes concurrent attempts so only one can insert", () => {
    const script = readFileSync(
      join(ROOT, "scripts", "provision-initial-app-user.mjs"),
      "utf8",
    );
    const lockAt = script.indexOf("PROVISIONING_ADVISORY_LOCK_SQL");
    const insertAt = script.indexOf("insertQuery.text");

    assert.match(PROVISIONING_ADVISORY_LOCK_SQL, /pg_advisory_xact_lock/);
    assert.ok(lockAt >= 0 && insertAt > lockAt);
    assert.match(script, /sql\.transaction/);

    const plan = buildInitialProvisioningPlan({
      initialOwnerId: OWNER_A,
      state: readyState(),
    });
    const first = buildActualProvisioningOutput(
      plan,
      lockedState({ inserted_count: 1 }),
    );
    const second = buildActualProvisioningOutput(
      plan,
      lockedState({
        app_user_count_before: 1,
        candidate_exists: true,
        candidate_exact: true,
        inserted_count: 0,
      }),
    );

    assert.equal(first.result, "provisioned");
    assert.equal(first.actualWrites.appUsers, 1);
    assert.equal(second.result, "already_provisioned");
    assert.equal(second.actualWrites.appUsers, 0);
    assertSafeOutput(first);
    assertSafeOutput(second);
  });

  it("keeps the live writer registry in shadow with no HTTP owner input", () => {
    assert.deepEqual(readWriterReadiness(ROOT), {
      registryShadow: true,
      runtimeOwnerIntegrationCount: 0,
      httpCanonicalOwnerInputCount: 0,
      ownerInferencePathCount: 0,
    });
  });
});

function readyState(overrides = {}) {
  const base = {
    appUsers: [],
    authIdentityCount: 0,
    canonicalOwnerNonNullRows: 0,
    schemaContractValid: true,
    schemaManifest: {
      identityColumnContract: true,
      identityConstraintContract: true,
      identityIndexContract: true,
      canonicalColumnContract: true,
      canonicalIndexContract: true,
    },
    writerReadiness: {
      registryShadow: true,
      runtimeOwnerIntegrationCount: 0,
      httpCanonicalOwnerInputCount: 0,
      ownerInferencePathCount: 0,
    },
  };

  return {
    ...base,
    ...overrides,
    schemaManifest: {
      ...base.schemaManifest,
      ...(overrides.schemaManifest ?? {}),
    },
    writerReadiness: {
      ...base.writerReadiness,
      ...(overrides.writerReadiness ?? {}),
    },
  };
}

function appUser(id, overrides = {}) {
  return {
    id,
    status: "provisioning",
    role: "user",
    ...overrides,
  };
}

function lockedState(overrides = {}) {
  return {
    app_user_count_before: 0,
    candidate_exists: false,
    candidate_exact: false,
    auth_identity_count: 0,
    canonical_owner_non_null_rows: 0,
    inserted_count: 0,
    ...overrides,
  };
}

function assertArgumentError(action, expectedCode) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ProvisioningArgumentError);
  assert.equal(caught.code, expectedCode);
}

function assertSafeOutput(output) {
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes(OWNER_A), false);
  assert.equal(serialized.includes(OWNER_B), false);
  assert.doesNotMatch(
    serialized,
    /provider_subject|postgres(?:ql)?:\/\/|database_url|api[_-]?key|password|secret/i,
  );
  assert.doesNotMatch(
    serialized,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
}
