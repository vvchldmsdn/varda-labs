import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FUTURE_SNAPSHOT_OWNER_CONTRACT,
  RUNTIME_WRITER_FREEZE_MATRIX,
  RuntimeWriterConvergenceError,
  evaluateFutureRuntimeWriterContext,
  findCanonicalOwnerInputLocations,
  prepareFutureSnapshotOwnerScope,
} from "../src/lib/runtime-writer-convergence.ts";
import { prepareTenantWriteContext } from "../src/lib/tenant-write-context.ts";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";
import { auditRuntimeWriterConvergence } from "../scripts/lib/runtime-writer-convergence-audit.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const ENTITY_WRITER_IDS = [
  "entity_accounts_api",
  "entity_assets_api",
  "entity_asset_groups_api",
  "entity_asset_group_members_api",
];

describe("runtime writer Phase 1F0 freeze and context convergence", () => {
  it("publishes the six-writer, three-kind freeze matrix", () => {
    assert.equal(RUNTIME_WRITER_FREEZE_MATRIX.length, 6);
    assert.deepEqual(
      [...new Set(RUNTIME_WRITER_FREEZE_MATRIX.map(({ writerKind }) => writerKind))].sort(),
      [
        "compatibility_entity_api",
        "legacy_destructive_cleanup",
        "machine_snapshot",
      ],
    );

    const registryById = new Map(
      TENANT_WRITER_REGISTRY.map((definition) => [definition.id, definition]),
    );
    for (const definition of RUNTIME_WRITER_FREEZE_MATRIX) {
      assert.equal(
        definition.currentAuthorization,
        registryById.get(definition.writerId)?.authorization,
      );
      assert.equal(definition.canonicalOwnerDmlAllowed, false);
      assert.equal(definition.singletonOwnerFallbackAllowed, false);
      assert.equal(definition.legacyOwnerInferenceAllowed, false);
      assert.equal(definition.productionContextIntegration, "not_connected");
    }
  });

  it("keeps the approved legacy cleanup permanently outside canonical activation", () => {
    const cleanup = RUNTIME_WRITER_FREEZE_MATRIX.find(
      ({ writerId }) => writerId === "base44_nonportfolio_asset_cleanup",
    );
    assert.equal(cleanup?.canonicalOwnerSource, "not_applicable_legacy_cleanup");
    assert.equal(
      cleanup?.activationStatus,
      "legacy_cleanup_future_invocation_frozen",
    );
    assert.deepEqual(
      evaluateFutureRuntimeWriterContext({
        writerId: "base44_nonportfolio_asset_cleanup",
        tenantContext: activeSessionContext(),
      }),
      {
        eligibleForFutureActivation: false,
        reason: "legacy_cleanup_frozen",
        productionContextConnected: false,
      },
    );
  });

  it("rejects canonical owner spoof keys from body, query, and headers", () => {
    const locations = findCanonicalOwnerInputLocations({
      bodyKeys: ["name", "canonicalOwnerUserId"],
      queryKeys: ["account", "canonical_owner_user_id"],
      headerKeys: ["authorization", "x-canonical-owner-user-id"],
    });
    assert.deepEqual(locations, ["body", "query", "header"]);

    for (const writerId of ENTITY_WRITER_IDS) {
      const decision = evaluateFutureRuntimeWriterContext({
        writerId,
        tenantContext: activeSessionContext(),
        machineAuthorizationVerified: true,
        untrustedOwnerInputLocations: locations,
      });
      assert.equal(decision.eligibleForFutureActivation, false);
      assert.equal(decision.reason, "untrusted_owner_input");
    }
  });

  it("proves a machine secret cannot select a canonical owner", () => {
    for (const writerId of [...ENTITY_WRITER_IDS, "admin_daily_snapshot"]) {
      const decision = evaluateFutureRuntimeWriterContext({
        writerId,
        machineAuthorizationVerified: true,
      });
      assert.equal(decision.eligibleForFutureActivation, false);
      assert.match(decision.reason, /context_required/);
      assert.equal(decision.productionContextConnected, false);
    }
  });

  it("accepts an active session only as a hypothetical entity API fixture", () => {
    for (const writerId of ENTITY_WRITER_IDS) {
      assert.deepEqual(
        evaluateFutureRuntimeWriterContext({
          writerId,
          tenantContext: activeSessionContext(),
        }),
        {
          eligibleForFutureActivation: true,
          reason: "future_contract_satisfied",
          productionContextConnected: false,
        },
      );
    }
  });

  it("requires an explicit active machine target for one-owner snapshots", () => {
    const context = activeMachineContext();
    assert.equal(
      evaluateFutureRuntimeWriterContext({
        writerId: "admin_daily_snapshot",
        tenantContext: context,
        machineAuthorizationVerified: true,
      }).reason,
      "explicit_machine_job_target_required",
    );

    const scope = prepareFutureSnapshotOwnerScope({
      tenantContext: context,
      machineAuthorizationVerified: true,
      explicitMachineJobTargetVerified: true,
      observedOwnerUserIdsByTable: ownerEvidence(OWNER_A),
    });
    assert.deepEqual(scope.readTables, FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables);
    assert.deepEqual(scope.writeTables, FUTURE_SNAPSHOT_OWNER_CONTRACT.writeTables);
    assert.deepEqual(scope.namedAccountOutputs, ["brokerage", "isa", "irp"]);
    assert.deepEqual(scope.derivedAccountOutputs, ["all"]);
    assert.equal(scope.canonicalOwnerUserId, OWNER_A);

    assert.throws(
      () =>
        prepareFutureSnapshotOwnerScope({
          tenantContext: context,
          machineAuthorizationVerified: true,
          explicitMachineJobTargetVerified: true,
          observedOwnerUserIdsByTable: {
            ...ownerEvidence(OWNER_A),
            assets: [OWNER_A, OWNER_B],
          },
        }),
      (error) =>
        error instanceof RuntimeWriterConvergenceError &&
        error.code === "snapshot_owner_integrity",
    );

    const incompleteEvidence = ownerEvidence(OWNER_A);
    delete incompleteEvidence.settings;
    assert.throws(
      () =>
        prepareFutureSnapshotOwnerScope({
          tenantContext: context,
          machineAuthorizationVerified: true,
          explicitMachineJobTargetVerified: true,
          observedOwnerUserIdsByTable: incompleteEvidence,
        }),
      (error) =>
        error instanceof RuntimeWriterConvergenceError &&
        error.code === "snapshot_owner_integrity",
    );
  });

  it("runs as a static audit with no DB, provider, or route invocation", () => {
    const result = auditRuntimeWriterConvergence({
      root: process.cwd(),
      writerRegistry: TENANT_WRITER_REGISTRY,
      freezeMatrix: RUNTIME_WRITER_FREEZE_MATRIX,
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.evidence, {
      canonicalOwnerReferences: 0,
      canonicalOwnerDmlMatches: 0,
      singletonOwnerFallbackMatches: 0,
      legacyOwnerInferenceMatches: 0,
      productionPolicyImports: 0,
      cleanupGuardsIntact: true,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
    });

    const auditSources = [
      "scripts/audit-runtime-writer-convergence.mjs",
      "scripts/lib/runtime-writer-convergence-audit.mjs",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    assert.doesNotMatch(
      auditSources,
      /@neondatabase|DATABASE_URL|process\.env|\bfetch\s*\(|from\s+["']@\/db|from\s+["']next\/server/,
    );
  });
});

function activeSessionContext() {
  return prepareTenantWriteContext({
    mode: "active",
    source: "session",
    targetClassification: "user_owned",
    canonicalOwnerUserId: OWNER_A,
    canonicalOwnerStatus: "active",
    canonicalOwnerVerified: true,
  });
}

function activeMachineContext() {
  return prepareTenantWriteContext({
    mode: "active",
    source: "machine_job",
    targetClassification: "user_owned",
    canonicalOwnerUserId: OWNER_A,
    canonicalOwnerStatus: "active",
    canonicalOwnerVerified: true,
  });
}

function ownerEvidence(ownerUserId) {
  return Object.fromEntries(
    FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables.map((table) => [
      table,
      [ownerUserId],
    ]),
  );
}
