import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_EVIDENCE_DIRECTORY,
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_ROOT,
  readLegacyAccountOwnerAssignmentHostOptions,
  runLegacyAccountOwnerAssignmentHostCli,
} from "../scripts/run-legacy-account-owner-assignment-rehearsal-host.mjs";

const SOURCE_SHA = "74bcc7effdfe210e9a8aeab31cf92ffc2b990b57";
const PROJECT_ID = "synthetic-project";
const PARENT_BRANCH_ID = "br-synthetic-production";
const PRODUCTION_ENDPOINT_ID = "ep-synthetic-production";
const ROOT = resolve("synthetic-owner-host-root");
const EVIDENCE_DIRECTORY = join(ROOT, ".rehearsal-evidence");
const NEON_API_KEY = "synthetic-neon-api-key-never-use";
const NOW = new Date("2026-07-29T00:00:00.000Z");

describe("legacy account owner-assignment host CLI", () => {
  it("accepts only the explicit one-shot target and confirmation", () => {
    assert.deepEqual(
      readLegacyAccountOwnerAssignmentHostOptions(validArgs()),
      {
        expectedSourceSha: SOURCE_SHA,
        projectId: PROJECT_ID,
        parentBranchId: PARENT_BRANCH_ID,
        productionEndpointId: PRODUCTION_ENDPOINT_ID,
      },
    );
    assert.throws(() =>
      readLegacyAccountOwnerAssignmentHostOptions(
        validArgs().filter(
          (value) =>
            value !==
            "--confirm-single-disposable-owner-assignment-rehearsal",
        ),
      ),
    );
    assert.throws(() =>
      readLegacyAccountOwnerAssignmentHostOptions([
        ...validArgs(),
        "--project-id",
        PROJECT_ID,
      ]),
    );
  });

  it("derives runtime paths from the repository entrypoint", () => {
    assert.equal(
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_EVIDENCE_DIRECTORY,
      join(
        LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_ROOT,
        ".rehearsal-evidence",
      ),
    );
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../scripts/run-legacy-account-owner-assignment-rehearsal-host.mjs",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    assert.equal(source.includes("process.cwd()"), false);
    assert.equal(source.includes("npm.cmd"), false);
    assert.equal(source.includes("shell: true"), false);
  });

  it("wires the fixed paths and REST adapter into one host call", async () => {
    const events = [];
    let adapterOptions = null;
    let hostOptions = null;
    let written = null;
    const adapter = Object.freeze({
      attestProductionSource() {},
      createChild() {},
      reconcileChildByExactName() {},
      attestChild() {},
      deleteChild() {},
      checkChildNotFound() {},
    });
    const passed = Object.freeze({
      host:
        "legacy_account_owner_assignment_rehearsal_host_v1",
      status: "passed",
      code: "completed",
      runId: "synthetic-run",
    });
    const baseEnv = {
      synthetic: "base-env",
    };

    const result = await runLegacyAccountOwnerAssignmentHostCli({
      args: validArgs(),
      baseEnv,
      repositoryRoot: ROOT,
      evidenceDirectory: EVIDENCE_DIRECTORY,
      clock: () => new Date(NOW),
      loadEnvironment() {
        events.push("load_environment");
        return {
          NEON_API_KEY,
          synthetic: "local-must-not-override",
          localOnly: "local-value",
        };
      },
      makeEvidenceDirectory(value) {
        events.push("make_evidence_directory");
        assert.equal(value, EVIDENCE_DIRECTORY);
      },
      createAdapter(options) {
        events.push("create_adapter");
        adapterOptions = options;
        return adapter;
      },
      async runHost(options) {
        events.push("run_host");
        hostOptions = options;
        return passed;
      },
      write(value) {
        events.push("write");
        written = value;
      },
      writeError() {
        assert.fail("A passing host must not use stderr.");
      },
    });

    assert.equal(result, passed);
    assert.equal(written, passed);
    assert.deepEqual(events, [
      "load_environment",
      "make_evidence_directory",
      "create_adapter",
      "run_host",
      "write",
    ]);
    assert.deepEqual(adapterOptions, {
      apiKey: NEON_API_KEY,
      expiresAt: "2026-07-30T00:00:00.000Z",
      now: adapterOptions.now,
    });
    assert.equal(typeof adapterOptions.now, "function");
    assert.equal(hostOptions.expectedSourceSha, SOURCE_SHA);
    assert.equal(hostOptions.repositoryRoot, ROOT);
    assert.equal(hostOptions.evidenceDirectory, EVIDENCE_DIRECTORY);
    assert.notEqual(hostOptions.baseEnv, baseEnv);
    assert.equal(
      Object.getPrototypeOf(hostOptions.baseEnv),
      null,
    );
    assert.equal(hostOptions.baseEnv.synthetic, "base-env");
    assert.equal(hostOptions.baseEnv.localOnly, "local-value");
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        hostOptions.baseEnv,
        "NEON_API_KEY",
      ),
      false,
    );
    assert.equal(hostOptions.projectId, PROJECT_ID);
    assert.equal(hostOptions.parentBranchId, PARENT_BRANCH_ID);
    assert.equal(
      hostOptions.productionEndpointId,
      PRODUCTION_ENDPOINT_ID,
    );
    for (const key of Object.keys(adapter)) {
      assert.equal(hostOptions[key], adapter[key]);
    }
  });

  it("rejects invalid CLI input before environment or adapter work", async () => {
    const calls = {
      load: 0,
      directory: 0,
      adapter: 0,
      host: 0,
    };
    let failure = null;
    const result = await runLegacyAccountOwnerAssignmentHostCli({
      args: [],
      loadEnvironment() {
        calls.load += 1;
      },
      makeEvidenceDirectory() {
        calls.directory += 1;
      },
      createAdapter() {
        calls.adapter += 1;
      },
      runHost() {
        calls.host += 1;
      },
      writeError(value) {
        failure = value;
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.code, "host_options_invalid");
    assert.equal(failure, result);
    assert.deepEqual(calls, {
      load: 0,
      directory: 0,
      adapter: 0,
      host: 0,
    });
  });

  it("rejects a missing or accessor-backed local API key before adapter work", async () => {
    for (const localEnvironment of [
      {},
      Object.defineProperty({}, "NEON_API_KEY", {
        get() {
          assert.fail("The API key accessor must not be invoked.");
        },
      }),
    ]) {
      let adapterCalls = 0;
      let failure = null;
      const result =
        await runLegacyAccountOwnerAssignmentHostCli({
          args: validArgs(),
          baseEnv: {},
          repositoryRoot: ROOT,
          evidenceDirectory: EVIDENCE_DIRECTORY,
          loadEnvironment() {
            return localEnvironment;
          },
          makeEvidenceDirectory() {},
          createAdapter() {
            adapterCalls += 1;
          },
          writeError(value) {
            failure = value;
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "neon_api_key_invalid");
      assert.equal(failure, result);
      assert.equal(adapterCalls, 0);
    }
  });

  it("rejects ambient own and inherited API keys before loading the local file", async () => {
    const inherited = Object.create({
      NEON_API_KEY: "inherited-key-must-not-be-used",
    });
    for (const baseEnv of [
      { NEON_API_KEY: "ambient-key-must-not-be-used" },
      inherited,
      Object.defineProperty({}, "NEON_API_KEY", {
        get() {
          assert.fail("The ambient key accessor must not be invoked.");
        },
      }),
    ]) {
      let loadCalls = 0;
      let adapterCalls = 0;
      let failure = null;
      const result =
        await runLegacyAccountOwnerAssignmentHostCli({
          args: validArgs(),
          baseEnv,
          repositoryRoot: ROOT,
          evidenceDirectory: EVIDENCE_DIRECTORY,
          loadEnvironment() {
            loadCalls += 1;
            return { NEON_API_KEY };
          },
          makeEvidenceDirectory() {},
          createAdapter() {
            adapterCalls += 1;
          },
          writeError(value) {
            failure = value;
          },
        });

      assert.equal(result.status, "failed");
      assert.equal(result.code, "neon_api_key_invalid");
      assert.equal(failure, result);
      assert.equal(loadCalls, 0);
      assert.equal(adapterCalls, 0);
    }
  });

  it("converts an unexpected host failure into a sanitized envelope", async () => {
    const rawSecret =
      "postgresql://raw-user:raw-password@raw.example/db";
    let failure = null;
    const result = await runLegacyAccountOwnerAssignmentHostCli({
      args: validArgs(),
      baseEnv: {},
      repositoryRoot: ROOT,
      evidenceDirectory: EVIDENCE_DIRECTORY,
      clock: () => new Date(NOW),
      loadEnvironment() {
        return { NEON_API_KEY };
      },
      makeEvidenceDirectory() {},
      createAdapter() {
        return {};
      },
      async runHost() {
        throw new Error(rawSecret);
      },
      writeError(value) {
        failure = value;
      },
    });

    assert.equal(result.status, "failed");
    assert.equal(result.code, "host_execution_failed");
    assert.equal(failure, result);
    assert.equal(JSON.stringify(result).includes(rawSecret), false);
  });

  it("does not invoke an accessor-backed host status", async () => {
    let statusAccessorInvocations = 0;
    let failure = null;
    const unsafeResult = {};
    Object.defineProperty(unsafeResult, "status", {
      get() {
        statusAccessorInvocations += 1;
        return "passed";
      },
    });
    const result = await runLegacyAccountOwnerAssignmentHostCli({
      args: validArgs(),
      baseEnv: {},
      repositoryRoot: ROOT,
      evidenceDirectory: EVIDENCE_DIRECTORY,
      clock: () => new Date(NOW),
      loadEnvironment() {
        return { NEON_API_KEY };
      },
      makeEvidenceDirectory() {},
      createAdapter() {
        return {};
      },
      async runHost() {
        return unsafeResult;
      },
      writeError(value) {
        failure = value;
      },
    });

    assert.equal(statusAccessorInvocations, 0);
    assert.equal(result.status, "failed");
    assert.equal(result.code, "host_execution_failed");
    assert.equal(failure, result);
  });
});

function validArgs() {
  return [
    "--expected-source-sha",
    SOURCE_SHA,
    "--project-id",
    PROJECT_ID,
    "--parent-branch-id",
    PARENT_BRANCH_ID,
    "--production-endpoint-id",
    PRODUCTION_ENDPOINT_ID,
    "--confirm-single-disposable-owner-assignment-rehearsal",
  ];
}
