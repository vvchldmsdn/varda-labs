import { performance } from "node:perf_hooks";

const NEON_API_BASE_URL = "https://console.neon.tech/api/v2/";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const BRANCH_NAME_PATTERN =
  /^preview\/codex\/legacy-account-owner-assignment-rehearsal-[0-9a-f-]+$/;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");
const CHILD_READ_STAGES = new Set([
  "branch_list_search",
  "branch_get",
  "endpoint_list_get",
]);
const CHILD_READ_REASONS = new Set([
  "exact_not_found",
  "execution_failed",
  "response_invalid",
  "timeout",
]);
export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_API_BASE_URL =
  NEON_API_BASE_URL;

export class LegacyAccountOwnerAssignmentNeonAdapterError extends Error {
  constructor(code, readDiagnostic = null) {
    super("Legacy account owner-assignment Neon adapter failed.");
    this.name = "LegacyAccountOwnerAssignmentNeonAdapterError";
    Object.defineProperty(this, "code", {
      configurable: false,
      enumerable: true,
      value: code,
      writable: false,
    });
    const diagnostic = projectChildReadDiagnostic(readDiagnostic);
    if (diagnostic !== null) {
      for (const [key, value] of Object.entries(diagnostic)) {
        Object.defineProperty(this, key, {
          configurable: false,
          enumerable: true,
          value,
          writable: false,
        });
      }
    }
  }
}

export function createLegacyAccountOwnerAssignmentNeonAdapter({
  apiKey,
  expiresAt,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    typeof monotonicNow !== "function" ||
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > DEFAULT_REQUEST_TIMEOUT_MS
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  const bearerToken = parseApiKey(apiKey);
  const expiration = parseExpiration(expiresAt, now);

  async function request({
    path,
    method = "GET",
    body,
    expectedStatus = 200,
    notFoundMode = "error",
    deadline = null,
    parseBody = true,
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      remainingRequestTimeout({
        deadline,
        monotonicNow,
        requestTimeoutMs,
      }),
    );
    let response;
    let text;
    try {
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
      };
      let serializedBody;
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        serializedBody = JSON.stringify(body);
      }
      response = await fetchImpl(
        new URL(path.replace(/^\/+/, ""), NEON_API_BASE_URL),
        {
          method,
          headers,
          ...(serializedBody === undefined
            ? {}
            : { body: serializedBody }),
          redirect: "error",
          signal: controller.signal,
        },
      );
      text = await readResponseText(response);
    } catch (error) {
      if (
        error instanceof
        LegacyAccountOwnerAssignmentNeonAdapterError
      ) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw adapterError("neon_api_timeout");
      }
      throw adapterError("neon_api_execution_failed");
    } finally {
      clearTimeout(timeout);
    }

    const status = responseStatus(response);
    if (status === 404 && notFoundMode === "null") return null;
    if (status === 404 && notFoundMode === "throw") {
      throw adapterError("neon_api_exact_not_found");
    }
    const acceptedStatuses = Array.isArray(expectedStatus)
      ? expectedStatus
      : [expectedStatus];
    if (!acceptedStatuses.includes(status)) {
      throw adapterError("neon_api_execution_failed");
    }
    if (!parseBody) return null;
    if (
      text.length === 0 ||
      Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES
    ) {
      throw adapterError("neon_api_response_invalid");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw adapterError("neon_api_response_invalid");
    }
  }

  async function requestChildRead(options, stage) {
    try {
      return await request({
        ...options,
        notFoundMode: "throw",
      });
    } catch (error) {
      throw childReadError(error, stage);
    }
  }

  return Object.freeze({
    async attestProductionSource({
      projectId,
      parentBranchId,
      productionEndpointId,
    }) {
      assertProjectId(projectId);
      assertBranchId(parentBranchId);
      assertEndpointId(productionEndpointId);
      const [branchResponse, endpointResponse] =
        await Promise.all([
          request({
            path: branchGetPath(projectId, parentBranchId),
          }),
          request({
            path: branchEndpointsPath(
              projectId,
              parentBranchId,
            ),
          }),
        ]);
      return projectControlPlaneAttestation({
        branchResponse,
        endpointResponse,
        expectedEndpointId: productionEndpointId,
        expectedExpiresAt: null,
        now,
      });
    },
    async createChild({
      branchName,
      projectId,
      parentBranchId,
    }) {
      assertProjectId(projectId);
      assertBranchId(parentBranchId);
      assertBranchName(branchName);
      const response = await request({
        path: branchesPath(projectId),
        method: "POST",
        expectedStatus: 201,
        body: createBranchRequest({
          branchName,
          parentBranchId,
          expiresAt: expiration,
        }),
      });
      return projectCreatedBranch(response);
    },
    async reconcileChildByExactName({
      projectId,
      branchName,
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    }) {
      assertProjectId(projectId);
      assertBranchName(branchName);
      const deadline = createRequestDeadline({
        timeoutMs,
        monotonicNow,
      });
      try {
        return projectCreatedBranchFromExactNameList(
          await requestChildRead(
            {
              path: branchListSearchPath(
                projectId,
                branchName,
              ),
              deadline,
            },
            "branch_list_search",
          ),
          branchName,
        );
      } catch (error) {
        throw childReadError(error, "branch_list_search");
      }
    },
    async attestChild({
      projectId,
      branchId,
      branchName,
      timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      assertBranchName(branchName);
      const deadline = createRequestDeadline({
        timeoutMs,
        monotonicNow,
      });
      const [branchResponse, endpointResponse] =
        await Promise.all([
          requestChildRead(
            {
              path: branchGetPath(projectId, branchId),
              deadline,
            },
            "branch_get",
          ),
          requestChildRead(
            {
              path: branchEndpointsPath(
                projectId,
                branchId,
              ),
              deadline,
            },
            "endpoint_list_get",
          ),
        ]);
      return projectControlPlaneAttestation({
        branchResponse,
        endpointResponse,
        expectedEndpointId: null,
        expectedExpiresAt: expiration,
        now,
        diagnoseChildRead: true,
      });
    },
    async deleteChild({ projectId, branchId }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      await request({
        path: branchGetPath(projectId, branchId),
        method: "DELETE",
        expectedStatus: [200, 204],
        parseBody: false,
      });
    },
    async checkChildNotFound({ projectId, branchId }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      return (
        (await request({
          path: branchGetPath(projectId, branchId),
          notFoundMode: "null",
        })) === null
      );
    },
  });
}

function branchesPath(projectId) {
  return `/projects/${projectId}/branches`;
}

function branchGetPath(projectId, branchId) {
  return `${branchesPath(projectId)}/${branchId}`;
}

function branchListSearchPath(projectId, branchName) {
  const query = new URLSearchParams({
    search: branchName,
    limit: "10000",
    include_deleted: "false",
  });
  return `${branchesPath(projectId)}?${query.toString()}`;
}

function branchEndpointsPath(projectId, branchId) {
  return `${branchGetPath(projectId, branchId)}/endpoints`;
}

function createBranchRequest({
  branchName,
  parentBranchId,
  expiresAt,
}) {
  return {
    branch: {
      name: branchName,
      parent_id: parentBranchId,
      expires_at: expiresAt,
      protected: false,
    },
    endpoints: [{ type: "read_write" }],
  };
}

function projectCreatedBranch(response) {
  const branch = requireObject(response, "branch");
  return Object.freeze({
    branchId: requirePattern(
      branch,
      "id",
      BRANCH_ID_PATTERN,
      "neon_api_response_invalid",
    ),
    branchName: requirePattern(
      branch,
      "name",
      BRANCH_NAME_PATTERN,
      "neon_api_response_invalid",
    ),
  });
}

function projectCreatedBranchFromExactNameList(
  response,
  expectedBranchName,
) {
  const branches = ownDataValue(response, "branches");
  const pagination = optionalOwnDataValue(response, "pagination");
  if (!Array.isArray(branches) || pagination === INVALID) {
    throw adapterError("neon_api_response_invalid");
  }
  if (pagination !== MISSING) {
    if (
      !pagination ||
      typeof pagination !== "object" ||
      Array.isArray(pagination)
    ) {
      throw adapterError("neon_api_response_invalid");
    }
    const next = optionalOwnDataValue(pagination, "next");
    if (
      next === INVALID ||
      (next !== MISSING && next !== null)
    ) {
      throw adapterError("neon_api_response_invalid");
    }
  }

  const exactMatches = [];
  for (const branch of branches) {
    if (
      !branch ||
      typeof branch !== "object" ||
      Array.isArray(branch)
    ) {
      throw adapterError("neon_api_response_invalid");
    }
    const branchName = requireString(
      branch,
      "name",
      "neon_api_response_invalid",
    );
    if (branchName === expectedBranchName) {
      exactMatches.push(branch);
    }
  }
  if (exactMatches.length === 0) return null;
  if (exactMatches.length !== 1) {
    throw adapterError("neon_api_response_invalid");
  }
  return projectCreatedBranch({ branch: exactMatches[0] });
}

function projectControlPlaneAttestation({
  branchResponse,
  endpointResponse,
  expectedEndpointId,
  expectedExpiresAt,
  now,
  diagnoseChildRead = false,
}) {
  const currentTime = now();
  if (
    !(currentTime instanceof Date) ||
    !Number.isFinite(currentTime.valueOf())
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  const branch = projectControlPlaneRead(
    () =>
      projectControlPlaneBranch({
        branchResponse,
        expectedExpiresAt,
        currentTime,
      }),
    "branch_get",
    diagnoseChildRead,
  );
  const endpoint = projectControlPlaneRead(
    () =>
      projectControlPlaneEndpoint({
        endpointResponse,
        expectedEndpointId,
      }),
    "endpoint_list_get",
    diagnoseChildRead,
  );

  return Object.freeze({
    projectId: branch.projectId,
    parentBranchId: branch.parentBranchId,
    branchId: branch.branchId,
    branchName: branch.branchName,
    endpointId: endpoint.endpointId,
    endpointProjectId: endpoint.endpointProjectId,
    endpointBranchId: endpoint.endpointBranchId,
    endpointType: "read_write",
    branchState: branch.branchState,
    endpointState: endpoint.endpointState,
    endpointDisabled: endpoint.endpointDisabled,
    branchReady: branch.branchReady,
    endpointReady: endpoint.endpointReady,
    default: branch.default,
    primary: branch.primary,
    protected: branch.protected,
    autoExpires: branch.autoExpires,
  });
}

function projectControlPlaneBranch({
  branchResponse,
  expectedExpiresAt,
  currentTime,
}) {
  const branch = requireObject(branchResponse, "branch");
  const branchState = requireString(
    branch,
    "current_state",
    "neon_api_response_invalid",
  );
  const expiresAt = ownDataValue(branch, "expires_at");
  const defaultValue = ownDataValue(branch, "default");
  const primaryValue = optionalOwnDataValue(branch, "primary");
  const expectedExpiration =
    typeof expectedExpiresAt === "string"
      ? Date.parse(expectedExpiresAt)
      : NaN;
  const actualExpiration =
    typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  return Object.freeze({
    projectId: requirePattern(
      branch,
      "project_id",
      PROJECT_ID_PATTERN,
      "neon_api_response_invalid",
    ),
    parentBranchId: ownStringOrNull(branch, "parent_id"),
    branchId: requirePattern(
      branch,
      "id",
      BRANCH_ID_PATTERN,
      "neon_api_response_invalid",
    ),
    branchName: requireString(
      branch,
      "name",
      "neon_api_response_invalid",
    ),
    branchState,
    branchReady: branchState === "ready",
    default: defaultValue,
    primary:
      primaryValue === MISSING ? defaultValue : primaryValue,
    protected: ownDataValue(branch, "protected"),
    autoExpires:
      expectedExpiresAt !== null &&
      Number.isFinite(expectedExpiration) &&
      Number.isFinite(actualExpiration) &&
      actualExpiration === expectedExpiration &&
      actualExpiration > currentTime.valueOf(),
  });
}

function projectControlPlaneEndpoint({
  endpointResponse,
  expectedEndpointId,
}) {
  const endpoints = ownDataValue(endpointResponse, "endpoints");
  if (!Array.isArray(endpoints)) {
    throw adapterError("neon_api_response_invalid");
  }
  const readWriteEndpoints = endpoints.filter(
    (endpoint) =>
      ownDataValue(endpoint, "type") === "read_write",
  );
  if (readWriteEndpoints.length !== 1) {
    throw adapterError("neon_api_response_invalid");
  }
  const endpoint = readWriteEndpoints[0];
  const endpointId = requirePattern(
    endpoint,
    "id",
    ENDPOINT_ID_PATTERN,
    "neon_api_response_invalid",
  );
  const endpointState = requireString(
    endpoint,
    "current_state",
    "neon_api_response_invalid",
  );
  const endpointDisabled = ownDataValue(endpoint, "disabled");
  if (typeof endpointDisabled !== "boolean") {
    throw adapterError("neon_api_response_invalid");
  }
  if (
    expectedEndpointId !== null &&
    endpointId !== expectedEndpointId
  ) {
    throw adapterError("neon_api_response_invalid");
  }
  return Object.freeze({
    endpointId,
    endpointProjectId: requirePattern(
      endpoint,
      "project_id",
      PROJECT_ID_PATTERN,
      "neon_api_response_invalid",
    ),
    endpointBranchId: requirePattern(
      endpoint,
      "branch_id",
      BRANCH_ID_PATTERN,
      "neon_api_response_invalid",
    ),
    endpointState,
    endpointDisabled,
    endpointReady:
      ["active", "idle"].includes(endpointState) &&
      endpointDisabled === false,
  });
}

function projectControlPlaneRead(factory, stage, diagnoseChildRead) {
  try {
    return factory();
  } catch (error) {
    if (!diagnoseChildRead) throw error;
    throw childReadError(error, stage);
  }
}

function createRequestDeadline({ timeoutMs, monotonicNow }) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_REQUEST_TIMEOUT_MS
  ) {
    throw adapterError("neon_adapter_input_invalid");
  }
  return readMonotonicNow(monotonicNow) + timeoutMs;
}

function remainingRequestTimeout({
  deadline,
  monotonicNow,
  requestTimeoutMs,
}) {
  if (deadline === null) return requestTimeoutMs;
  const remaining = Math.floor(
    deadline - readMonotonicNow(monotonicNow),
  );
  if (remaining < 1) throw adapterError("neon_api_timeout");
  return Math.min(remaining, requestTimeoutMs);
}

async function readResponseText(response) {
  if (!response || typeof response !== "object") {
    throw adapterError("neon_api_execution_failed");
  }
  let body;
  try {
    body = response.body;
  } catch {
    throw adapterError("neon_api_execution_failed");
  }
  if (body === null) return "";
  if (!body || typeof body.getReader !== "function") {
    throw adapterError("neon_api_execution_failed");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (
        !chunk ||
        typeof chunk !== "object" ||
        typeof chunk.done !== "boolean"
      ) {
        throw adapterError("neon_api_response_invalid");
      }
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) {
        throw adapterError("neon_api_response_invalid");
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded-response failure remains authoritative.
        }
        throw adapterError("neon_api_response_invalid");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (
      error instanceof
      LegacyAccountOwnerAssignmentNeonAdapterError
    ) {
      throw error;
    }
    throw adapterError("neon_api_response_invalid");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing a consumed or canceled response must not change evidence.
    }
  }
}

function responseStatus(response) {
  const value = response?.status;
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw adapterError("neon_api_execution_failed");
  }
  return value;
}

function readMonotonicNow(monotonicNow) {
  let value;
  try {
    value = monotonicNow();
  } catch {
    throw adapterError("neon_adapter_options_invalid");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw adapterError("neon_adapter_options_invalid");
  }
  return value;
}

function parseApiKey(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\s\x00-\x1f\x7f]/.test(value)
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  return value;
}

function parseExpiration(value, now) {
  const currentTime = now();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  const normalized = Number.isFinite(parsed)
    ? Math.floor(parsed / 1000) * 1000
    : NaN;
  if (
    !(currentTime instanceof Date) ||
    !Number.isFinite(currentTime.valueOf()) ||
    !Number.isFinite(normalized) ||
    normalized <= currentTime.valueOf()
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  const expiration = new Date(normalized);
  return expiration.toISOString().replace(".000Z", "Z");
}

function assertProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw adapterError("neon_adapter_input_invalid");
  }
}

function assertBranchId(value) {
  if (typeof value !== "string" || !BRANCH_ID_PATTERN.test(value)) {
    throw adapterError("neon_adapter_input_invalid");
  }
}

function assertEndpointId(value) {
  if (typeof value !== "string" || !ENDPOINT_ID_PATTERN.test(value)) {
    throw adapterError("neon_adapter_input_invalid");
  }
}

function assertBranchName(value) {
  if (
    typeof value !== "string" ||
    !BRANCH_NAME_PATTERN.test(value)
  ) {
    throw adapterError("neon_adapter_input_invalid");
  }
}

function requireObject(value, key) {
  const result = ownDataValue(value, key);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw adapterError("neon_api_response_invalid");
  }
  return result;
}

function requireString(value, key, code) {
  const result = ownDataValue(value, key);
  if (typeof result !== "string" || result.length === 0) {
    throw adapterError(code);
  }
  return result;
}

function requirePattern(value, key, pattern, code) {
  const result = requireString(value, key, code);
  if (!pattern.test(result)) throw adapterError(code);
  return result;
}

function ownStringOrNull(value, key) {
  const result = ownDataValue(value, key);
  return typeof result === "string" && result.length > 0
    ? result
    : null;
}

function ownDataValue(value, key) {
  if (!value || typeof value !== "object") return MISSING;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return INVALID;
  }
  if (!descriptor || !("value" in descriptor)) return INVALID;
  return descriptor.value;
}

function optionalOwnDataValue(value, key) {
  if (!value || typeof value !== "object") return INVALID;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return INVALID;
  }
  if (!descriptor) return MISSING;
  if (!("value" in descriptor)) return INVALID;
  return descriptor.value;
}

function childReadError(error, stage) {
  const code = ownDataValue(error, "code");
  const reason = childReadReason(code);
  return adapterError(
    typeof code === "string" ? code : "neon_api_execution_failed",
    { stage, reason },
  );
}

function childReadReason(code) {
  if (code === "neon_api_exact_not_found") {
    return "exact_not_found";
  }
  if (code === "neon_api_timeout") return "timeout";
  if (code === "neon_api_response_invalid") {
    return "response_invalid";
  }
  return "execution_failed";
}

function projectChildReadDiagnostic(value) {
  if (value === null) return null;
  const stage = ownDataValue(value, "stage");
  const reason = ownDataValue(value, "reason");
  if (
    !CHILD_READ_STAGES.has(stage) ||
    !CHILD_READ_REASONS.has(reason)
  ) {
    return null;
  }
  return Object.freeze({ stage, reason });
}

function adapterError(code, readDiagnostic = null) {
  return new LegacyAccountOwnerAssignmentNeonAdapterError(
    code,
    readDiagnostic,
  );
}
