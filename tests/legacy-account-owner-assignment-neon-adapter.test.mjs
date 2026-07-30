import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_API_BASE_URL,
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
const API_KEY = "synthetic-neon-api-key-never-use";
const RAW_SECRET =
  "postgresql://raw-user:raw-password@raw.example/db";

describe("legacy account owner-assignment Neon adapter", () => {
  it("uses the official REST contract and returns only allowlisted evidence", async () => {
    const calls = [];
    const responses = [
      jsonResponse(200, sourceBranchResponse()),
      jsonResponse(200, sourceEndpointResponse()),
      jsonResponse(201, {
        branch: childBranch(),
        endpoints: [childEndpoint()],
        connection_uris: [{ connection_uri: RAW_SECRET }],
      }),
      jsonResponse(200, {
        branches: [childBranch()],
        pagination: {},
      }),
      jsonResponse(200, { branch: childBranch() }),
      jsonResponse(200, childEndpointResponse()),
      jsonResponse(200, { branch: childBranch() }),
      textResponse(
        404,
        `provider detail with ${RAW_SECRET} must remain private`,
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
    const reconciled =
      await adapter.reconcileChildByExactName({
        projectId: PROJECT_ID,
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
      LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_API_BASE_URL,
      "https://console.neon.tech/api/v2/",
    );
    assert.deepEqual(source, expectedSourceAttestation());
    assert.deepEqual(child, {
      branchId: CHILD_BRANCH_ID,
      branchName: BRANCH_NAME,
    });
    assert.deepEqual(reconciled, child);
    assert.equal(attestation.branchId, CHILD_BRANCH_ID);
    assert.equal(attestation.endpointId, CHILD_ENDPOINT_ID);
    assert.equal(attestation.autoExpires, true);
    assert.equal(notFound, true);
    assert.equal(
      JSON.stringify({
        source,
        child,
        reconciled,
        attestation,
      }).includes(API_KEY),
      false,
    );
    assert.equal(
      JSON.stringify({
        source,
        child,
        reconciled,
        attestation,
      }).includes(RAW_SECRET),
      false,
    );
    assert.equal(responses.length, 0);

    for (const call of calls) {
      assert.equal(
        call.options.headers.Authorization,
        `Bearer ${API_KEY}`,
      );
      assert.equal(
        call.options.headers.Accept,
        "application/json",
      );
      assert.equal(call.options.redirect, "error");
      assert.ok(call.options.signal instanceof AbortSignal);
      assert.equal(
        String(call.url).startsWith(
          LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_API_BASE_URL,
        ),
        true,
      );
    }

    const createCall = calls.find(
      (call) => call.options.method === "POST",
    );
    assert.ok(createCall);
    assert.equal(
      String(createCall.url),
      `${LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_API_BASE_URL}` +
        `projects/${PROJECT_ID}/branches`,
    );
    assert.deepEqual(JSON.parse(createCall.options.body), {
      branch: {
        name: BRANCH_NAME,
        parent_id: PARENT_BRANCH_ID,
        expires_at: EXPIRES_AT,
        protected: false,
      },
      endpoints: [{ type: "read_write" }],
    });

    const searchCall = calls.find((call) =>
      String(call.url).includes("?"),
    );
    assert.ok(searchCall);
    assert.equal(searchCall.url.searchParams.get("search"), BRANCH_NAME);
    assert.equal(searchCall.url.searchParams.get("limit"), "10000");
    assert.equal(
      searchCall.url.searchParams.get("include_deleted"),
      "false",
    );
  });

  it("requires an in-memory API key and never falls back to CLI auth", () => {
    assert.throws(
      () =>
        createLegacyAccountOwnerAssignmentNeonAdapter({
          expiresAt: EXPIRES_AT,
          fetchImpl() {},
          now: () => new Date(NOW),
        }),
      (error) => {
        assert.equal(error.code, "neon_adapter_options_invalid");
        assert.equal(JSON.stringify(error).includes(API_KEY), false);
        return true;
      },
    );
  });

  it("accepts terminal list responses that omit pagination", async () => {
    const calls = [];
    const responses = [
      jsonResponse(200, { branches: [childBranch()] }),
    ];
    const adapter = createAdapter({ calls, responses });

    const child = await adapter.reconcileChildByExactName({
      projectId: PROJECT_ID,
      branchName: BRANCH_NAME,
    });

    assert.deepEqual(child, {
      branchId: CHILD_BRANCH_ID,
      branchName: BRANCH_NAME,
    });
    assert.equal(calls.length, 1);
  });

  it("returns null when a complete list has no exact-name match", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        jsonResponse(200, {
          branches: [
            {
              ...childBranch(),
              name: `${BRANCH_NAME}-other`,
            },
          ],
          pagination: { next: null },
        }),
      ],
    });

    assert.equal(
      await adapter.reconcileChildByExactName({
        projectId: PROJECT_ID,
        branchName: BRANCH_NAME,
      }),
      null,
    );
  });

  it("fails closed on incomplete or duplicate exact-name lists", async () => {
    for (const body of [
      {
        branches: [childBranch()],
        pagination: { next: "opaque-cursor" },
      },
      {
        branches: [childBranch(), childBranch()],
        pagination: { next: null },
      },
    ]) {
      const adapter = createAdapter({
        calls: [],
        responses: [jsonResponse(200, body)],
      });
      await assert.rejects(
        adapter.reconcileChildByExactName({
          projectId: PROJECT_ID,
          branchName: BRANCH_NAME,
        }),
        (error) => {
          assert.equal(error.code, "neon_api_response_invalid");
          assert.equal(error.stage, "branch_list_search");
          assert.equal(error.reason, "response_invalid");
          return true;
        },
      );
    }
  });

  it("classifies an exact child 404 without exposing response text", async () => {
    const adapter = createAdapter({
      calls: [],
      responses: [
        textResponse(404, `private provider response ${RAW_SECRET}`),
        jsonResponse(200, childEndpointResponse()),
      ],
    });

    await assert.rejects(
      adapter.attestChild({
        projectId: PROJECT_ID,
        branchId: CHILD_BRANCH_ID,
        branchName: BRANCH_NAME,
      }),
      (error) => {
        assert.equal(error.code, "neon_api_exact_not_found");
        assert.equal(error.stage, "branch_get");
        assert.equal(error.reason, "exact_not_found");
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
  });

  it("does not retry a non-idempotent create failure", async () => {
    const calls = [];
    const adapter = createAdapter({
      calls,
      responses: [
        textResponse(500, `private provider response ${RAW_SECRET}`),
      ],
    });

    await assert.rejects(
      adapter.createChild({
        projectId: PROJECT_ID,
        parentBranchId: PARENT_BRANCH_ID,
        branchName: BRANCH_NAME,
      }),
      (error) => {
        assert.equal(error.code, "neon_api_execution_failed");
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "POST");
  });

  it("accepts an already-absent delete response before exact-ID verification", async () => {
    const calls = [];
    const adapter = createAdapter({
      calls,
      responses: [textResponse(204, "")],
    });

    await adapter.deleteChild({
      projectId: PROJECT_ID,
      branchId: CHILD_BRANCH_ID,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, "DELETE");
  });

  it("requires an exact typed branch receipt from a successful create", async () => {
    const calls = [];
    const adapter = createAdapter({
      calls,
      responses: [
        jsonResponse(201, {
          branch: {
            ...childBranch(),
            id: "not-a-branch-id",
          },
        }),
      ],
    });

    await assert.rejects(
      adapter.createChild({
        projectId: PROJECT_ID,
        parentBranchId: PARENT_BRANCH_ID,
        branchName: BRANCH_NAME,
      }),
      (error) => {
        assert.equal(error.code, "neon_api_response_invalid");
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });

  it("classifies endpoint transport and schema failures at the endpoint stage", async () => {
    for (const endpointResponse of [
      textResponse(500, `private provider response ${RAW_SECRET}`),
      jsonResponse(200, { endpoints: "invalid" }),
    ]) {
      const adapter = createAdapter({
        calls: [],
        responses: [
          jsonResponse(200, { branch: childBranch() }),
          endpointResponse,
        ],
      });

      await assert.rejects(
        adapter.attestChild({
          projectId: PROJECT_ID,
          branchId: CHILD_BRANCH_ID,
          branchName: BRANCH_NAME,
        }),
        (error) => {
          assert.equal(error.stage, "endpoint_list_get");
          assert.equal(
            error.reason,
            endpointResponse.status === 500
              ? "execution_failed"
              : "response_invalid",
          );
          assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
          return true;
        },
      );
    }
  });

  it("classifies a bounded request timeout and aborts the request", async () => {
    let signal = null;
    const adapter =
      createLegacyAccountOwnerAssignmentNeonAdapter({
        apiKey: API_KEY,
        expiresAt: EXPIRES_AT,
        now: () => new Date(NOW),
        requestTimeoutMs: 5,
        fetchImpl(_url, options) {
          signal = options.signal;
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new Error(RAW_SECRET)),
              { once: true },
            );
          });
        },
      });

    await assert.rejects(
      adapter.createChild({
        projectId: PROJECT_ID,
        parentBranchId: PARENT_BRANCH_ID,
        branchName: BRANCH_NAME,
      }),
      (error) => {
        assert.equal(error.code, "neon_api_timeout");
        assert.equal(JSON.stringify(error).includes(RAW_SECRET), false);
        return true;
      },
    );
    assert.equal(signal.aborted, true);
  });

  it("rejects malformed and oversized JSON responses", async () => {
    for (const response of [
      textResponse(200, "{"),
      textResponse(200, "x".repeat(1024 * 1024 + 1)),
    ]) {
      const adapter = createAdapter({
        calls: [],
        responses: [response],
      });
      await assert.rejects(
        adapter.reconcileChildByExactName({
          projectId: PROJECT_ID,
          branchName: BRANCH_NAME,
        }),
        (error) => {
          assert.equal(error.code, "neon_api_response_invalid");
          assert.equal(error.stage, "branch_list_search");
          assert.equal(error.reason, "response_invalid");
          return true;
        },
      );
    }
  });
});

function createAdapter({ calls, responses }) {
  return createLegacyAccountOwnerAssignmentNeonAdapter({
    apiKey: API_KEY,
    expiresAt: EXPIRES_AT,
    now: () => new Date(NOW),
    fetchImpl(url, options) {
      calls.push({ url, options });
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected synthetic fetch.");
      }
      return Promise.resolve(response);
    },
  });
}

function jsonResponse(status, value) {
  return textResponse(status, JSON.stringify(value));
}

function textResponse(status, value) {
  return {
    status,
    async text() {
      return value;
    },
  };
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

function expectedSourceAttestation() {
  return {
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
  };
}
