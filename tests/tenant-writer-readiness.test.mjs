import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";

import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";
import {
  TenantWritePolicyError,
  assertActiveTenantWriteAllowed,
  canonicalOwnerAssignment,
  prepareMigrationOwnerContext,
  prepareSnapshotWriteScope,
  prepareTenantWriteContext,
} from "../src/lib/tenant-write-context.ts";
import { EXPANDED_TENANT_TABLE_POLICIES } from "../scripts/lib/tenant-ownership-policy.mjs";

const ROOT = process.cwd();
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const DRIZZLE_DML_PATTERN = /\.(?:insert|update|delete)\s*\(/i;
const DB_IMPORT_PATTERN =
  /import\s+\{[^}]*\bdb\b[^}]*\}\s+from\s+["'][^"']+["']/s;
const RAW_SQL_DML_PATTERN =
  /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|truncate)\b/i;
const RAW_CANONICAL_OWNER_DML_PATTERN =
  /insert\s+into\s+[^()]+\([^)]*canonical_owner_user_id|update\s+[a-z_\"]+\s+set[\s\S]{0,2000}canonical_owner_user_id\s*=|canonical_owner_user_id\s*=\s*excluded\.canonical_owner_user_id/i;
const DRIZZLE_CANONICAL_OWNER_DML_PATTERN =
  /\.(?:values|set)\s*\(\s*\{[\s\S]{0,2000}canonicalOwnerUserId\s*:/i;

describe("tenant writer Phase 1D-A readiness", () => {
  it("registers every current DML implementation exactly once by path", () => {
    const discoveredPaths = discoverDmlPaths().sort();
    const registeredPaths = [
      ...new Set(
        TENANT_WRITER_REGISTRY.flatMap(
          ({ implementationPaths }) => implementationPaths,
        ),
      ),
    ].sort();

    assert.deepEqual(registeredPaths, discoveredPaths);
    assert.equal(TENANT_WRITER_REGISTRY.length, 17);
    assert.equal(registeredPaths.length, 21);
    assert.equal(
      new Set(TENANT_WRITER_REGISTRY.map(({ id }) => id)).size,
      TENANT_WRITER_REGISTRY.length,
    );

    for (const path of registeredPaths) {
      assert.equal(existsSync(join(ROOT, path)), true, `${path} must exist`);
    }
  });

  it("keeps writer target classes aligned with the table ownership policy", () => {
    const policyByTable = new Map(
      EXPANDED_TENANT_TABLE_POLICIES.map(({ table, classification }) => [
        table,
        classification,
      ]),
    );

    for (const writer of TENANT_WRITER_REGISTRY) {
      assert.equal(writer.canonicalOwnerHttpInput, "forbidden");
      for (const target of writer.targets) {
        assert.equal(
          target.classification,
          policyByTable.get(target.table),
          `${writer.id}:${target.table}`,
        );
        assert.equal(
          target.ownerPolicy,
          target.classification === "user_owned"
            ? "trusted_context_required"
            : "owner_forbidden",
        );
      }
    }
  });

  it("splits mixed writers by target class, including market context", () => {
    const mixedWriters = TENANT_WRITER_REGISTRY.filter(
      ({ classification }) => classification === "mixed",
    );

    assert.deepEqual(
      mixedWriters.map(({ id }) => id).sort(),
      [
        "admin_market_price_sync",
        "base44_history_import",
        "base44_market_context_import",
      ],
    );

    for (const writer of mixedWriters) {
      assert.ok(new Set(writer.targets.map(({ classification }) => classification)).size > 1);
    }

    const marketContext = TENANT_WRITER_REGISTRY.find(
      ({ id }) => id === "base44_market_context_import",
    );
    assert.deepEqual(
      marketContext?.targets.map(({ table, classification }) => ({
        table,
        classification,
      })),
      [
        { table: "market_regime_daily", classification: "user_owned" },
        { table: "global_market_factors", classification: "shared_reference" },
      ],
    );
  });

  it("keeps canonical owner values out of HTTP inputs and runtime writers", () => {
    for (const path of walkFiles(join(ROOT, "src", "app", "api"))) {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(source, /canonicalOwnerUserId|canonical_owner_user_id/);
    }

    for (const writer of TENANT_WRITER_REGISTRY) {
      for (const path of writer.implementationPaths) {
        const source = readFileSync(join(ROOT, path), "utf8");
        assert.doesNotMatch(source, /tenant-write-context/);
      }
    }
  });

  it("keeps every registered writer free of canonical owner DML", () => {
    for (const writer of TENANT_WRITER_REGISTRY) {
      for (const path of writer.implementationPaths) {
        const source = readFileSync(join(ROOT, path), "utf8");
        assert.doesNotMatch(
          source,
          RAW_CANONICAL_OWNER_DML_PATTERN,
          `${writer.id}:${path} raw canonical owner DML`,
        );
        assert.doesNotMatch(
          source,
          DRIZZLE_CANONICAL_OWNER_DML_PATTERN,
          `${writer.id}:${path} Drizzle canonical owner DML`,
        );
      }
    }
  });

  it("separates legacy import evidence from verified canonical ownership", () => {
    const shadow = prepareMigrationOwnerContext({
      mode: "shadow",
      legacyOwnerUserId: "base44-import",
    });

    assert.equal(shadow.legacyOwnerUserId, "base44-import");
    assert.equal(shadow.tenantWriteContext.canonicalOwnerUserId, null);
    assert.deepEqual(canonicalOwnerAssignment(shadow.tenantWriteContext), {});

    assertPolicyError(
      () =>
        prepareMigrationOwnerContext({
          mode: "shadow",
          legacyOwnerUserId: "base44-import",
          canonicalOwnerUserId: "base44-import",
          canonicalOwnerVerified: true,
        }),
      "invalid_canonical_owner",
    );
    assertPolicyError(
      () => prepareMigrationOwnerContext({ mode: "active" }),
      "missing_canonical_owner",
    );

    const active = prepareMigrationOwnerContext({
      mode: "active",
      legacyOwnerUserId: "base44-import",
      canonicalOwnerUserId: OWNER_A,
      canonicalOwnerStatus: "provisioning",
      canonicalOwnerVerified: true,
      provisioningOwnerApproved: true,
    });
    assert.deepEqual(canonicalOwnerAssignment(active.tenantWriteContext), {
      canonicalOwnerUserId: OWNER_A,
    });
  });

  it("rejects untrusted, unverified, and forbidden owner candidates", () => {
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "shadow",
          source: "session",
          targetClassification: "user_owned",
          untrustedOwnerInputLocations: ["body"],
        }),
      "untrusted_owner_input",
    );
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "session",
          targetClassification: "user_owned",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "active",
        }),
      "unverified_canonical_owner",
    );
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "machine_job",
          targetClassification: "shared_reference",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "active",
          canonicalOwnerVerified: true,
        }),
      "owner_forbidden_for_target",
    );
  });

  it("enforces app-user status by trusted writer source", () => {
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "session",
          targetClassification: "user_owned",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "provisioning",
          canonicalOwnerVerified: true,
          provisioningOwnerApproved: true,
        }),
      "owner_status_not_allowed",
    );
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "session",
          targetClassification: "user_owned",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "unknown",
          canonicalOwnerVerified: true,
        }),
      "owner_status_not_allowed",
    );
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "migration_cli",
          targetClassification: "user_owned",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "provisioning",
          canonicalOwnerVerified: true,
        }),
      "provisioning_owner_not_approved",
    );
    assertPolicyError(
      () =>
        prepareTenantWriteContext({
          mode: "active",
          source: "machine_job",
          targetClassification: "user_owned",
          canonicalOwnerUserId: OWNER_A,
          canonicalOwnerStatus: "disabled",
          canonicalOwnerVerified: true,
        }),
      "owner_status_not_allowed",
    );
    assert.doesNotThrow(() =>
      prepareTenantWriteContext({
        mode: "active",
        source: "migration_cli",
        targetClassification: "user_owned",
        canonicalOwnerUserId: OWNER_A,
        canonicalOwnerStatus: "provisioning",
        canonicalOwnerVerified: true,
        provisioningOwnerApproved: true,
      }),
    );
  });

  it("rejects cross-owner update, reference, and delete fixtures", () => {
    const context = activeUserContext(OWNER_A);
    const actions = [
      () =>
        assertActiveTenantWriteAllowed({
          context,
          operation: "update",
          existingOwnerUserId: OWNER_B,
        }),
      () =>
        assertActiveTenantWriteAllowed({
          context,
          operation: "reference",
          referencedOwnerUserIds: [OWNER_B],
        }),
      () =>
        assertActiveTenantWriteAllowed({
          context,
          operation: "delete",
          existingOwnerUserId: OWNER_B,
        }),
    ];

    for (const action of actions) {
      const error = capturePolicyError(action);
      assert.doesNotMatch(error.message, new RegExp(`${OWNER_A}|${OWNER_B}`));
    }

    assert.doesNotThrow(() =>
      assertActiveTenantWriteAllowed({
        context,
        operation: "update",
        existingOwnerUserId: OWNER_A,
        referencedOwnerUserIds: [OWNER_A],
      }),
    );
  });

  it("makes all-account snapshots owner-specific and preserves legacy-only rows", () => {
    const scopeA = prepareSnapshotWriteScope({
      context: activeUserContext(OWNER_A),
      snapshotDate: "2026-07-10",
      account: "all",
      observedOwnerUserIds: [OWNER_A],
      legacyOnlyPositionCount: 52,
    });
    const repeatedScopeA = prepareSnapshotWriteScope({
      context: activeUserContext(OWNER_A),
      snapshotDate: "2026-07-10",
      account: "all",
      observedOwnerUserIds: [OWNER_A],
      legacyOnlyPositionCount: 52,
    });
    const scopeB = prepareSnapshotWriteScope({
      context: activeUserContext(OWNER_B),
      snapshotDate: "2026-07-10",
      account: "all",
      observedOwnerUserIds: [OWNER_B],
      legacyOnlyPositionCount: 52,
    });

    assert.deepEqual(scopeA.identity, repeatedScopeA.identity);
    assert.notDeepEqual(scopeA.identity, scopeB.identity);
    assert.equal(scopeA.identity.account, "all");
    assert.equal(scopeA.legacyOnlyPositionCount, 52);

    assertPolicyError(
      () =>
        prepareSnapshotWriteScope({
          context: activeUserContext(OWNER_A),
          snapshotDate: "2026-07-10",
          account: "all",
          observedOwnerUserIds: [OWNER_A, OWNER_B],
          legacyOnlyPositionCount: 52,
        }),
      "snapshot_owner_integrity",
    );
  });
});

function activeUserContext(ownerUserId) {
  return prepareTenantWriteContext({
    mode: "active",
    source: "session",
    targetClassification: "user_owned",
    canonicalOwnerUserId: ownerUserId,
    canonicalOwnerStatus: "active",
    canonicalOwnerVerified: true,
  });
}

function assertPolicyError(action, expectedCode) {
  const error = capturePolicyError(action);
  assert.equal(error.code, expectedCode);
  assert.doesNotMatch(error.message, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
}

function capturePolicyError(action) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof TenantWritePolicyError);
  return caught;
}

function discoverDmlPaths() {
  return [join(ROOT, "src"), join(ROOT, "scripts")]
    .flatMap(walkFiles)
    .filter((path) => !path.endsWith("rehearse-tenant-expand.mjs"))
    .filter((path) => {
      const source = readFileSync(path, "utf8");
      return (
        RAW_SQL_DML_PATTERN.test(source) ||
        (DB_IMPORT_PATTERN.test(source) && DRIZZLE_DML_PATTERN.test(source))
      );
    })
    .map(relativePath);
}

function walkFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walkFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".mjs")) {
      files.push(path);
    }
  }
  return files;
}

function relativePath(path) {
  return relative(ROOT, path).split(sep).join("/");
}
