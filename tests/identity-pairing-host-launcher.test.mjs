import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyIdentityPairingHostCommandResult,
  createIdentityPairingHostCommand,
  runIdentityPairingHostCommand,
} from "../scripts/lib/identity-pairing-host-launcher.mjs";
import {
  prepareIdentityPairingHostEnvironment,
  readIdentityPairingHostOptions,
} from "../scripts/lib/identity-pairing-host-target.mjs";
import {
  IDENTITY_PAIRING_HOST_REPOSITORY_ROOT,
  runIdentityPairingHostCli,
} from "../scripts/run-identity-pairing-host-command.mjs";

describe("identity pairing host launcher", () => {
  it("uses the Node executable directly for both fixed commands", () => {
    const preflight = createIdentityPairingHostCommand(
      "preflight",
      "synthetic-node",
    );
    assert.equal(preflight.command, "synthetic-node");
    assert.match(
      preflight.args[1],
      /scripts[\\/]preflight-identity-pairing-catalog\.mjs$/,
    );
    assert.equal(preflight.args.includes("npm.cmd"), false);

    const rehearsal = createIdentityPairingHostCommand(
      "rehearsal",
      "synthetic-node",
    );
    assert.match(
      rehearsal.args[1],
      /scripts[\\/]rehearse-identity-pairing-consume-writer\.mjs$/,
    );
    assert.equal(
      rehearsal.args.at(-1),
      "--confirm-isolated-identity-pairing-rehearsal",
    );
  });

  it("rewrites only the Neon endpoint and discards stale targets", () => {
    const env = prepareIdentityPairingHostEnvironment({
      baseEnv: {
        DATABASE_URL:
          "postgresql://owner:secret@ep-production-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require",
        DATABASE_URL_UNPOOLED:
          "postgresql://owner:secret@ep-production.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require",
        NEON_PROJECT_ID: "synthetic-project",
        KIS_APP_SECRET: "must-not-reach-child",
        ADMIN_JOB_SECRET: "must-not-reach-child",
        IDENTITY_PAIRING_REHEARSAL_DATABASE_URL:
          "postgresql://stale:secret@ep-stale.neon.tech/db",
      },
      branchId: "br-synthetic-child",
      branchName:
        "preview/codex/identity-pairing-consume-rehearsal-synthetic",
      endpointId: "ep-synthetic-child",
    });
    const pooled = new URL(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL,
    );
    const unpooled = new URL(
      env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED,
    );
    assert.equal(
      pooled.hostname,
      "ep-synthetic-child-pooler.c-9.us-east-1.aws.neon.tech",
    );
    assert.equal(
      unpooled.hostname,
      "ep-synthetic-child.c-9.us-east-1.aws.neon.tech",
    );
    assert.equal(pooled.username, "owner");
    assert.equal(pooled.password, "secret");
    assert.equal(env.NEON_PROJECT_ID, "synthetic-project");
    assert.equal(
      env.IDENTITY_PAIRING_HOST_ENV_SOURCE,
      "identity_pairing_host_launcher_v1",
    );
    assert.equal("DATABASE_URL" in env, false);
    assert.equal("DATABASE_URL_UNPOOLED" in env, false);
    assert.equal("KIS_APP_SECRET" in env, false);
    assert.equal("ADMIN_JOB_SECRET" in env, false);
  });

  it("leaves database targets absent when base URLs are absent", () => {
    const env = prepareIdentityPairingHostEnvironment({
      baseEnv: {
        IDENTITY_PAIRING_REHEARSAL_DATABASE_URL: "stale-secret",
        IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED:
          "stale-secret",
      },
      branchId: "br-synthetic-child",
      branchName:
        "preview/codex/identity-pairing-consume-rehearsal-synthetic",
      endpointId: "ep-synthetic-child",
    });
    assert.equal(
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL" in env,
      false,
    );
    assert.equal(
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED" in env,
      false,
    );
  });

  it("accepts strict preflight and rehearsal CLI options", () => {
    const target = [
      "--branch-id",
      "br-synthetic-child",
      "--branch-name",
      "preview/codex/identity-pairing-consume-rehearsal-synthetic",
      "--endpoint-id",
      "ep-synthetic-child",
    ];
    assert.equal(
      readIdentityPairingHostOptions([
        "--mode",
        "preflight",
        ...target,
      ]).mode,
      "preflight",
    );
    assert.equal(
      readIdentityPairingHostOptions([
        "--mode",
        "rehearsal",
        ...target,
        "--confirm-isolated-identity-pairing-rehearsal",
      ]).mode,
      "rehearsal",
    );
    assert.throws(() =>
      readIdentityPairingHostOptions([
        "--mode",
        "rehearsal",
        ...target,
      ]),
    );
  });

  it("pins child execution to the repository root", () => {
    let received = null;
    const result = runIdentityPairingHostCli({
      args: [
        "--mode",
        "preflight",
        "--branch-id",
        "br-synthetic-child",
        "--branch-name",
        "preview/codex/identity-pairing-consume-rehearsal-synthetic",
        "--endpoint-id",
        "ep-synthetic-child",
      ],
      baseEnv: {},
      loadEnvironment() {},
      runCommand(input) {
        received = input;
        return Object.freeze({
          status: "passed",
          code: "synthetic_pass",
        });
      },
      write() {},
    });
    assert.equal(result.status, "passed");
    assert.equal(received.cwd, IDENTITY_PAIRING_HOST_REPOSITORY_ROOT);
  });

  it("returns passed child evidence without raw stream fields", () => {
    const result = classifyIdentityPairingHostCommandResult({
      mode: "preflight",
      result: childResult({
        stdout: JSON.stringify({
          audit: "identity_pairing_schema_catalog",
          status: "passed",
          state: "present",
          readOnly: true,
          databaseWrites: 0,
          unexpectedSecret: "must-not-cross-host-boundary",
        }),
      }),
    });
    assert.equal(result.status, "passed");
    assert.equal(result.evidence.state, "present");
    assert.equal("unexpectedSecret" in result.evidence, false);
    assert.equal("stdout" in result.child, false);
    assert.equal("stderr" in result.child, false);
    assert.equal(result.child.stdoutPresent, true);
  });

  it("preserves a sanitized child target-guard failure", () => {
    const result = classifyIdentityPairingHostCommandResult({
      mode: "preflight",
      result: childResult({
        status: 1,
        stdout: "",
        stderr: JSON.stringify({
          preflight: "identity_pairing_catalog_child_audit",
          status: "failed",
          code: "catalog_preflight_child_target_guard_failed",
        }),
      }),
    });
    assert.deepEqual(result.childEvidence, {
      preflight: "identity_pairing_catalog_child_audit",
      status: "failed",
      code: "catalog_preflight_child_target_guard_failed",
    });
    assert.equal(result.code, "host_child_reported_failure");
  });

  it("accepts the native successful spawn shape without an error key", () => {
    const result = classifyIdentityPairingHostCommandResult({
      mode: "preflight",
      result: {
        signal: null,
        status: 0,
        stdout: JSON.stringify({
          audit: "identity_pairing_schema_catalog",
          status: "passed",
          state: "present",
          readOnly: true,
          databaseWrites: 0,
        }),
        stderr: "",
      },
    });
    assert.equal(result.status, "passed");
  });

  it("projects only allowlisted rehearsal success evidence", () => {
    const result = classifyIdentityPairingHostCommandResult({
      mode: "rehearsal",
      result: childResult({
        stdout: JSON.stringify({
          rehearsal:
            "identity_pairing_atomic_consume_disposable_branch",
          status: "passed",
          stage: "completed",
          lastCompletedCheck: "terminal_insert_full_rollback",
          poolReadiness: true,
          disposableBranchDmlAttempted: true,
          productionDatabaseWrites: 0,
          branchDeletionRequired: true,
          unexpectedSecret: "must-not-cross-host-boundary",
        }),
      }),
    });
    assert.equal(result.status, "passed");
    assert.equal(result.evidence.stage, "completed");
    assert.equal("unexpectedSecret" in result.evidence, false);
  });

  it("distinguishes EINVAL, signals, and malformed output", () => {
    const spawnFailure = runIdentityPairingHostCommand({
      mode: "preflight",
      spawn() {
        return childResult({
          error: Object.assign(new Error("secret"), {
            code: "EINVAL",
          }),
          status: null,
        });
      },
    });
    assert.equal(spawnFailure.code, "host_spawn_einval");
    assert.equal(JSON.stringify(spawnFailure).includes("secret"), false);

    const signaled = classifyIdentityPairingHostCommandResult({
      mode: "preflight",
      result: childResult({ signal: "SIGTERM", status: null }),
    });
    assert.equal(signaled.code, "host_child_signaled");
    assert.equal(signaled.child.signal, "SIGTERM");

    const missingExitEvidence =
      classifyIdentityPairingHostCommandResult({
        mode: "preflight",
        result: childResult({ status: null }),
      });
    assert.equal(
      missingExitEvidence.code,
      "host_child_protocol_invalid",
    );

    const malformed = classifyIdentityPairingHostCommandResult({
      mode: "preflight",
      result: childResult({
        status: 1,
        stderr:
          "postgresql://secret-user:secret@secret-host/secret-db",
      }),
    });
    assert.equal(
      malformed.code,
      "host_child_failure_protocol_invalid",
    );
    assert.equal(JSON.stringify(malformed).includes("secret"), false);
    assert.equal(malformed.child.stderrPresent, true);
  });

  it("does not invoke child result or error accessors", () => {
    let resultReads = 0;
    const accessorResult = childResult();
    Object.defineProperty(accessorResult, "status", {
      get() {
        resultReads += 1;
        return 0;
      },
    });
    assert.equal(
      classifyIdentityPairingHostCommandResult({
        mode: "preflight",
        result: accessorResult,
      }).code,
      "host_child_protocol_invalid",
    );
    assert.equal(resultReads, 0);

    let codeReads = 0;
    const accessorError = new Error("secret");
    Object.defineProperty(accessorError, "code", {
      get() {
        codeReads += 1;
        return "EINVAL";
      },
    });
    assert.equal(
      classifyIdentityPairingHostCommandResult({
        mode: "preflight",
        result: childResult({
          error: accessorError,
          status: null,
        }),
      }).code,
      "host_spawn_failed",
    );
    assert.equal(codeReads, 0);
  });

  it("does not invoke environment accessors", () => {
    let reads = 0;
    const baseEnv = {};
    Object.defineProperty(baseEnv, "DATABASE_URL", {
      enumerable: true,
      get() {
        reads += 1;
        return "postgresql://secret";
      },
    });
    const env = prepareIdentityPairingHostEnvironment({
      baseEnv,
      branchId: "br-synthetic-child",
      branchName:
        "preview/codex/identity-pairing-consume-rehearsal-synthetic",
      endpointId: "ep-synthetic-child",
    });
    assert.equal(reads, 0);
    assert.equal(
      "IDENTITY_PAIRING_REHEARSAL_DATABASE_URL" in env,
      false,
    );
  });
});

function childResult(changed = {}) {
  return {
    error: undefined,
    signal: null,
    status: 0,
    stdout: JSON.stringify({
      audit: "identity_pairing_schema_catalog",
      status: "passed",
      state: "present",
      readOnly: true,
      databaseWrites: 0,
    }),
    stderr: "",
    ...changed,
  };
}
