import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_CLI,
  createLegacyAccountOwnerAssignmentNeonAdapter,
} from "../scripts/lib/legacy-account-owner-assignment-neon-adapter.mjs";

const NOW = new Date("2026-07-29T00:00:00.000Z");
const EXPIRES_AT = "2026-07-30T00:00:00.000Z";
const PROJECT_ID = "synthetic-project";
const PARENT_BRANCH_ID = "br-synthetic-production";
const PRODUCTION_ENDPOINT_ID = "ep-synthetic-production";
const CHILD_BRANCH_ID = "br-synthetic-owner-rehearsal";
const CHILD_ENDPOINT_ID = "ep-synthetic-owner-rehearsal";
const BRANCH_NAME =
  "preview/codex/legacy-account-owner-assignment-rehearsal-" +
  "33333333-3333-4333-8333-333333333333";
const REPOSITORY_ROOT = "C:\\synthetic\\varda-labs";
const NODE_EXECUTABLE = "C:\\Program Files\\nodejs\\node.exe";
const NPX_CLI_PATH =
  "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
const CONFIG_DIRECTORY =
  "C:\\Users\\synthetic\\.config\\neonctl";
const RAW_SECRET =
  "postgresql://raw-user:raw-password@raw.example/db";

describe("legacy account owner-assignment Neon adapter", () => {
  it("uses one pinned direct-Node command per operation and returns allowlisted evidence", async () => {
    const calls = [];
    const responses = [
      ok("2.38.1\n"),
      json(sourceBranchResponse()),
      json(sourceEndpointResponse()),
      json({
        branch: childBranch(),
        endpoints: [childEndpoint()],
        connection_uris: [{ connection_uri: RAW_SECRET }],
      }),
      json({ branch: childBranch() }),
      json(childEndpointResponse()),
      ok(""),
      failed(
        "ERROR: FetchBranchWithParent\n" +
          "internal provider detail must remain private",
      ),
    ];
    const adapter = createAdapter({ calls, responses });

    const source = await adapter.attestProductionSource({
      projectId: PROJECT_ID,
      parentBranchId: PARENT_BRANCH_ID,
      productionEndpointId: PRODUCTION_ENDPOINT_ID,
    });
    const child = await adapter.createChild({
      projectId: PROJECT_ID,
      parentBranchId: PARENT_BRANCH_ID,
      branchName: BRANCH_NAME,
    });
    const attestation = await adapter.attestChild({
      projectId: PROJECT_ID,
      branchId: child.branchId,
      branchName: child.branchName,
    });
    await adapter.deleteChild({
      projectId: PROJECT_ID,
      branchId: CHILD_BRANCH_ID,
    });
    const notFound = await adapter.checkChildNotFound({
      projectId: PROJECT_ID,
      branchId: CHILD_BRANCH_ID,
    });

    assert.equal(
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_CLI,
      "neonctl@2.38.1",
    );
    assert.deepEqual(source, {
      projectId: PROJECT_ID,
      parentBranchId: null,
      branchId: PARENT_BRANCH_ID,
      branchName: "main",
      endpointId: PRODUCTION_ENDPOINT_ID,
      endpointProjectId: PROJECT_ID,
      endpointBranchId: PARENT_BRANCH_ID,
      endpointType: "read_write",
      branchState: "ready",
      endpointState: "idle",
      endpointDisabled: false,
      branchReady: true,
      endpointReady: true,
      default: true,
      primary: true,
      protected: false,
      autoExpires: false,
    });
    assert.deepEqual(child, {
      branchId: CHILD_BRANCH_ID,
      branchName: BRANCH_NAME,
    });
    assert.equal(
      attestation.endpointBranchId,
      CHILD_BRANCH_ID,
    );
    assert.equal(attestation.autoExpires, true);
    assert.equal(notFound, true);
    assert.equal(
      JSON.stringify({ source, child, attestation }).includes(
        RAW_SECRET,
      ),
      false,
    );
    assert.equal(responses.length, 0);

    for (const call of calls) {
      assert.equal(call.command, NODE_EXECUTABLE);
      assert.deepEqual(call.args.slice(0, 3), [
        NPX_CLI_PATH,
        "--yes",
        "neonctl@2.38.1",
      ]);
      assert.equal(call.options.cwd, REPOSITORY_ROOT);
      assert.equal(call.options.shell, false);
      assert.equal(call.options.windowsHide, true);
      assert.equal(call.options.env.Path, "C:\\Windows\\System32");
      for (const forbidden of [
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
        "NEON_API_KEY",
        "VARDA_APP_PASSWORD",
      ]) {
        assert.equal(
          Object.hasOwn(call.options.env, forbidden),
          false,
        );
      }
    }

    const createCall = calls.find((call) =>
      call.args.includes(`/projects/${PROJECT_ID}/branches`),
    );
    assert.ok(createCall);
    assert.equal(createCall.args.includes("branches"), false);
    const dataIndex = createCall.args.indexOf("--data");
    const body = JSON.parse(createCall.args[dataIndex + 1]);
    assert.deepEqual(body, {
      branch: {
        name: BRANCH_NAME,
        parent_id: PARENT_BRANCH_ID,
        expires_at: EXPIRES_AT,
        protected: false,
      },
      endpoints: [{ type: "read_write" }],
    });
  });

  it("does not invoke accessors on process results", async () => {
    let stdoutAccessorInvocations = 0;
    const result = {
      status: 0,
      signal: null,
      stderr: "",
    };
    Object.defineProperty(result, "stdout", {
      get() {
        stdoutAccessorInvocations += 1;
        return "2.38.1\n";
      },
    });
    const adapter = createAdapter({
      calls: [],
      responses: [result],
    });

    await assert.rejects(
      () =>
        adapter.createChild({
          projectId: PROJECT_ID,
          parentBranchId: PARENT_BRANCH_ID,
          branchName: BRANCH_NAME,
        }),
      (error) => {
        assert.equal(
          error.code,
          "neon_cli_execution_failed",
        );
        return true;
      },
    );
    assert.equal(stdoutAccessorInvocations, 0);
  });

  it("blocks raw provider output and credentials at the adapter boundary", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        failed(`provider failed: ${RAW_SECRET}`),
      ],
    });

    await assert.rejects(
      () =>
        adapter.createChild({
          projectId: PROJECT_ID,
          parentBranchId: PARENT_BRANCH_ID,
          branchName: BRANCH_NAME,
        }),
      (error) => {
        const serialized = JSON.stringify({
          name: error.name,
          message: error.message,
          code: error.code,
        });
        assert.equal(
          error.code,
          "neon_cli_execution_failed",
        );
        assert.equal(serialized.includes(RAW_SECRET), false);
        assert.equal(serialized.includes("provider failed"), false);
        return true;
      },
    );
  });

  it("does not classify a different CLI failure as exact not-found", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        failed("ERROR: authentication failed"),
      ],
    });

    await assert.rejects(
      () =>
        adapter.checkChildNotFound({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
        }),
      (error) => {
        assert.equal(
          error.code,
          "neon_cli_execution_failed",
        );
        return true;
      },
    );
  });

  it("bounds both readiness GETs by one remaining monotonic budget", async () => {
    const calls = [];
    let clock = 0;
    const adapter = createAdapter({
      calls,
      responses: [
        ok("2.38.1\n"),
        json({ branch: childBranch() }),
        json(childEndpointResponse()),
      ],
      monotonicNow: () => clock,
      afterSpawn(callIndex) {
        clock = [100, 700, 700][callIndex] ?? clock;
      },
    });

    await adapter.attestChild({
      projectId: PROJECT_ID,
      branchId: CHILD_BRANCH_ID,
      branchName: BRANCH_NAME,
      timeoutMs: 1_000,
    });

    assert.deepEqual(
      calls.map(({ options }) => options.timeout),
      [1_000, 900, 300],
    );
  });

  it("classifies a direct Node process timeout without exposing provider output", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        timedOut(`private provider output ${RAW_SECRET}`),
      ],
    });

    await assert.rejects(
      () =>
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
          timeoutMs: 1_000,
        }),
      (error) => {
        assert.equal(error.code, "neon_cli_timeout");
        assert.equal(error.stage, "branch_get");
        assert.equal(error.reason, "timeout");
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
  });

  it("classifies an exact child branch miss without exposing provider output", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        failed(
          "ERROR: FetchBranchWithParent\n" +
            `private provider output ${RAW_SECRET}`,
        ),
      ],
    });

    await assert.rejects(
      () =>
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
          timeoutMs: 1_000,
        }),
      (error) => {
        assert.deepEqual(
          {
            code: error.code,
            stage: error.stage,
            reason: error.reason,
          },
          {
            code: "neon_cli_exact_not_found",
            stage: "branch_get",
            reason: "exact_not_found",
          },
        );
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
  });

  it("classifies an endpoint-list execution failure without exposing stderr", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        json({ branch: childBranch() }),
        failed(`private endpoint failure ${RAW_SECRET}`),
      ],
    });

    await assert.rejects(
      () =>
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
          timeoutMs: 1_000,
        }),
      (error) => {
        assert.deepEqual(
          {
            code: error.code,
            stage: error.stage,
            reason: error.reason,
          },
          {
            code: "neon_cli_execution_failed",
            stage: "endpoint_list_get",
            reason: "execution_failed",
          },
        );
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
  });

  it("classifies malformed child branch JSON as a response failure", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [ok("2.38.1\n"), ok("{not-json")],
    });

    await assert.rejects(
      () =>
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
          timeoutMs: 1_000,
        }),
      (error) => {
        assert.deepEqual(
          {
            code: error.code,
            stage: error.stage,
            reason: error.reason,
          },
          {
            code: "neon_cli_response_invalid",
            stage: "branch_get",
            reason: "response_invalid",
          },
        );
        return true;
      },
    );
  });

  it("classifies an invalid endpoint response schema at its read stage", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        ok("2.38.1\n"),
        json({ branch: childBranch() }),
        json({ endpoints: "invalid" }),
      ],
    });

    await assert.rejects(
      () =>
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
          timeoutMs: 1_000,
        }),
      (error) => {
        assert.deepEqual(
          {
            code: error.code,
            stage: error.stage,
            reason: error.reason,
          },
          {
            code: "neon_cli_response_invalid",
            stage: "endpoint_list_get",
            reason: "response_invalid",
          },
        );
        return true;
      },
    );
  });
});

function createAdapter({
  calls,
  responses,
  monotonicNow,
  afterSpawn,
}) {
  return createLegacyAccountOwnerAssignmentNeonAdapter({
    npxCliPath: NPX_CLI_PATH,
    configDirectory: CONFIG_DIRECTORY,
    repositoryRoot: REPOSITORY_ROOT,
    expiresAt: EXPIRES_AT,
    processEnvironment: {
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      DATABASE_URL: RAW_SECRET,
      DATABASE_URL_UNPOOLED: RAW_SECRET,
      NEON_API_KEY: "raw-neon-key",
      VARDA_APP_PASSWORD: "raw-app-password",
    },
    nodeExecutable: NODE_EXECUTABLE,
    now: () => new Date(NOW),
    ...(monotonicNow === undefined ? {} : { monotonicNow }),
    spawn(command, args, options) {
      calls.push({ command, args, options });
      afterSpawn?.(calls.length - 1);
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected fake process invocation.");
      }
      return response;
    },
  });
}

function sourceBranchResponse() {
  return {
    branch: {
      project_id: PROJECT_ID,
      id: PARENT_BRANCH_ID,
      name: "main",
      parent_id: null,
      current_state: "ready",
      default: true,
      primary: true,
      protected: false,
      expires_at: null,
    },
  };
}

function sourceEndpointResponse() {
  return {
    endpoints: [
      {
        id: PRODUCTION_ENDPOINT_ID,
        project_id: PROJECT_ID,
        branch_id: PARENT_BRANCH_ID,
        type: "read_write",
        current_state: "idle",
        disabled: false,
      },
    ],
  };
}

function childBranch() {
  return {
    project_id: PROJECT_ID,
    id: CHILD_BRANCH_ID,
    name: BRANCH_NAME,
    parent_id: PARENT_BRANCH_ID,
    current_state: "ready",
    default: false,
    primary: false,
    protected: false,
    expires_at: EXPIRES_AT,
  };
}

function childEndpoint() {
  return {
    id: CHILD_ENDPOINT_ID,
    project_id: PROJECT_ID,
    branch_id: CHILD_BRANCH_ID,
    type: "read_write",
    current_state: "active",
    disabled: false,
  };
}

function childEndpointResponse() {
  return { endpoints: [childEndpoint()] };
}

function ok(stdout) {
  return {
    status: 0,
    signal: null,
    stdout,
    stderr: "",
  };
}

function json(value) {
  return ok(JSON.stringify(value));
}

function failed(stderr) {
  return {
    status: 1,
    signal: null,
    stdout: "",
    stderr,
  };
}

function timedOut(stderr) {
  return {
    status: null,
    signal: "SIGTERM",
    stdout: "",
    stderr,
    error: Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
    }),
  };
}
