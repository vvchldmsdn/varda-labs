import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyIdentityPairingCatalogAuditProcessResult,
  createIdentityPairingCatalogAuditCommand,
  createIdentityPairingCatalogAuditFailure,
  runIdentityPairingCatalogAuditProcess,
} from "../scripts/lib/identity-pairing-catalog-preflight.mjs";

describe("identity pairing catalog child audit protocol", () => {
  it("builds one fixed Node command for standalone and rehearsal callers", () => {
    const command = createIdentityPairingCatalogAuditCommand(
      "synthetic-node",
    );
    assert.equal(command.command, "synthetic-node");
    assert.deepEqual(command.args.slice(0, 1), ["--no-warnings"]);
    assert.match(
      command.args[1],
      /scripts[\\/]audit-identity-pairing-schema\.mjs$/,
    );
    assert.deepEqual(command.args.slice(2), [
      "--expect-state",
      "present",
    ]);
  });

  it("emits only allowlisted child failure fields", () => {
    const failure = createIdentityPairingCatalogAuditFailure(
      "database_read",
    );
    assert.deepEqual(failure, {
      audit: "identity_pairing_schema_catalog",
      status: "failed",
      stage: "database_read",
      code: "catalog_preflight_child_database_read_failed",
    });
    assert.throws(() =>
      createIdentityPairingCatalogAuditFailure("secret_stage"),
    );
  });

  it("classifies spawn, signal, child, and malformed failures", () => {
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({
          error: Object.assign(new Error("secret"), { code: "ENOENT" }),
          status: null,
        }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_spawn_enoent",
      },
    );
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({
          error: Object.assign(new Error("secret"), { code: "EPERM" }),
          status: null,
        }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_spawn_eperm",
      },
    );
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({ signal: "SIGTERM", status: null }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_child_signaled",
      },
    );
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({
          status: 1,
          stderr: JSON.stringify(
            createIdentityPairingCatalogAuditFailure("migration_plan"),
          ),
        }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_child_migration_plan_failed",
      },
    );
    const malformed = classifyIdentityPairingCatalogAuditProcessResult(
      spawnResult({
        status: 1,
        stderr:
          "postgresql://secret-user:secret@secret-host/secret-database",
      }),
    );
    assert.deepEqual(malformed, {
      status: "failed",
      code: "catalog_preflight_child_protocol_invalid",
    });
    assert.equal(JSON.stringify(malformed).includes("secret"), false);
  });

  it("accepts one passed JSON record and blocks malformed success output", () => {
    const passed = classifyIdentityPairingCatalogAuditProcessResult(
      spawnResult({
        stdout: JSON.stringify({
          audit: "identity_pairing_schema_catalog",
          status: "passed",
          state: "present",
        }),
      }),
    );
    assert.equal(passed.status, "passed");
    assert.equal(passed.evidence.state, "present");

    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({ stdout: "not-json" }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_success_protocol_invalid",
      },
    );
  });

  it("does not invoke result or error accessors", () => {
    let resultReads = 0;
    const accessorResult = {};
    Object.defineProperty(accessorResult, "error", {
      get() {
        resultReads += 1;
        return null;
      },
    });
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(accessorResult),
      {
        status: "failed",
        code: "catalog_preflight_child_protocol_invalid",
      },
    );
    assert.equal(resultReads, 0);

    let codeReads = 0;
    const accessorError = new Error("secret");
    Object.defineProperty(accessorError, "code", {
      get() {
        codeReads += 1;
        return "ENOENT";
      },
    });
    assert.deepEqual(
      classifyIdentityPairingCatalogAuditProcessResult(
        spawnResult({ error: accessorError, status: null }),
      ),
      {
        status: "failed",
        code: "catalog_preflight_spawn_failed",
      },
    );
    assert.equal(codeReads, 0);
  });

  it("uses the fixed command without returning child streams", () => {
    let observedCommand = null;
    const result = runIdentityPairingCatalogAuditProcess({
      cwd: "synthetic-cwd",
      env: Object.freeze({ SYNTHETIC: "true" }),
      spawn(command, args, options) {
        observedCommand = { command, args, options };
        return spawnResult({
          status: 1,
          stderr: JSON.stringify(
            createIdentityPairingCatalogAuditFailure("target_guard"),
          ),
        });
      },
    });
    assert.match(
      observedCommand.args[1],
      /scripts[\\/]audit-identity-pairing-schema\.mjs$/,
    );
    assert.equal(observedCommand.options.cwd, "synthetic-cwd");
    assert.equal(observedCommand.options.env.SYNTHETIC, "true");
    assert.deepEqual(result, {
      status: "failed",
      code: "catalog_preflight_child_target_guard_failed",
    });
    assert.equal("stdout" in result, false);
    assert.equal("stderr" in result, false);
  });
});

function spawnResult(changed = {}) {
  return {
    signal: null,
    status: 0,
    stdout: JSON.stringify({
      audit: "identity_pairing_schema_catalog",
      status: "passed",
    }),
    stderr: "",
    ...changed,
  };
}
