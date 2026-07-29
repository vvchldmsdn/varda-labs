import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";

const NEON_CLI_PACKAGE = "neonctl@2.38.1";
const NEON_CLI_VERSION = "2.38.1";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const BRANCH_NAME_PATTERN =
  /^preview\/codex\/legacy-account-owner-assignment-rehearsal-[0-9a-f-]+$/;
const NOT_FOUND_PATTERN =
  /^ERROR: FetchBranchWithParent(?:\r?\n|$)/;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;
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
const PROCESS_ENV_KEYS = new Set([
  "APPDATA",
  "COMSPEC",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
  "npm_config_cache",
].map((key) => key.toLowerCase()));

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_NEON_CLI =
  NEON_CLI_PACKAGE;

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
  npxCliPath,
  configDirectory,
  repositoryRoot,
  expiresAt,
  processEnvironment = process.env,
  nodeExecutable = process.execPath,
  spawn = spawnSync,
  now = () => new Date(),
  monotonicNow = () => performance.now(),
} = {}) {
  if (
    typeof npxCliPath !== "string" ||
    !isAbsolute(npxCliPath) ||
    typeof configDirectory !== "string" ||
    !isAbsolute(configDirectory) ||
    typeof repositoryRoot !== "string" ||
    !isAbsolute(repositoryRoot) ||
    typeof nodeExecutable !== "string" ||
    !isAbsolute(nodeExecutable) ||
    typeof spawn !== "function" ||
    typeof now !== "function" ||
    typeof monotonicNow !== "function" ||
    !processEnvironment ||
    typeof processEnvironment !== "object"
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  const expiration = parseExpiration(expiresAt, now);
  const childEnvironment =
    createMinimalNeonProcessEnvironment(processEnvironment);
  let versionVerified = false;

  function execute(args, mode, deadline = null) {
    if (!versionVerified) {
      const version = runProcess(
        ["--version"],
        remainingProcessTimeout(deadline),
      );
      if (
        version.status !== 0 ||
        version.signal !== null ||
        version.stdout.trim() !== NEON_CLI_VERSION
      ) {
        throw adapterError("neon_cli_version_invalid");
      }
      versionVerified = true;
    }

    const result = runProcess(
      [
        ...args,
        "--config-dir",
        configDirectory,
        "--output",
        "json",
        "--no-color",
        "--no-analytics",
      ],
      remainingProcessTimeout(deadline),
    );
    if (mode === "status") {
      if (result.status !== 0 || result.signal !== null) {
        throw adapterError("neon_cli_execution_failed");
      }
      return null;
    }
    if (mode === "maybe_json" && isExactNotFound(result)) {
      return null;
    }
    if (mode === "child_json" && isExactNotFound(result)) {
      throw adapterError("neon_cli_exact_not_found");
    }
    if (
      result.status !== 0 ||
      result.signal !== null ||
      result.stdout.length === 0
    ) {
      throw adapterError("neon_cli_execution_failed");
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw adapterError("neon_cli_response_invalid");
    }
  }

  function runProcess(args, timeoutMs) {
    let result;
    try {
      result = spawn(
        nodeExecutable,
        [
          npxCliPath,
          "--yes",
          NEON_CLI_PACKAGE,
          ...args,
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: childEnvironment,
          maxBuffer: MAX_OUTPUT_BYTES,
          shell: false,
          timeout: timeoutMs,
          windowsHide: true,
        },
      );
    } catch {
      throw adapterError("neon_cli_execution_failed");
    }
    if (isTimedOutProcessResult(result)) {
      throw adapterError("neon_cli_timeout");
    }
    return projectProcessResult(result);
  }

  function remainingProcessTimeout(deadline) {
    if (deadline === null) return DEFAULT_PROCESS_TIMEOUT_MS;
    const current = readMonotonicNow(monotonicNow);
    const remaining = Math.floor(deadline - current);
    if (remaining < 1) throw adapterError("neon_cli_timeout");
    return Math.min(remaining, DEFAULT_PROCESS_TIMEOUT_MS);
  }

  function executeChildRead(args, deadline, stage) {
    try {
      return execute(args, "child_json", deadline);
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
      return projectControlPlaneAttestation({
        branchResponse: execute(
          branchGetArgs(projectId, parentBranchId),
          "json",
        ),
        endpointResponse: execute(
          branchEndpointsArgs(projectId, parentBranchId),
          "json",
        ),
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
      const response = execute(
        [
          "api",
          `/projects/${projectId}/branches`,
          "--method",
          "POST",
          "--data",
          createBranchRequest({
            branchName,
            parentBranchId,
            expiresAt: expiration,
          }),
        ],
        "json",
      );
      return projectCreatedBranch(response);
    },
    async reconcileChildByExactName({
      projectId,
      branchName,
      timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
    }) {
      assertProjectId(projectId);
      assertBranchName(branchName);
      const deadline = createProcessDeadline({
        timeoutMs,
        monotonicNow,
      });
      try {
        return projectCreatedBranchFromExactNameList(
          executeChildRead(
            branchListSearchArgs(projectId, branchName),
            deadline,
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
      timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
    }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      assertBranchName(branchName);
      const deadline = createProcessDeadline({
        timeoutMs,
        monotonicNow,
      });
      return projectControlPlaneAttestation({
        branchResponse: executeChildRead(
          branchGetArgs(projectId, branchId),
          deadline,
          "branch_get",
        ),
        endpointResponse: executeChildRead(
          branchEndpointsArgs(projectId, branchId),
          deadline,
          "endpoint_list_get",
        ),
        expectedEndpointId: null,
        expectedExpiresAt: expiration,
        now,
        diagnoseChildRead: true,
      });
    },
    async deleteChild({ projectId, branchId }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      execute(
        [
          "api",
          `/projects/${projectId}/branches/${branchId}`,
          "--method",
          "DELETE",
        ],
        "status",
      );
    },
    async checkChildNotFound({ projectId, branchId }) {
      assertProjectId(projectId);
      assertBranchId(branchId);
      return (
        execute(
          branchGetArgs(projectId, branchId),
          "maybe_json",
        ) === null
      );
    },
  });
}

export function createMinimalNeonProcessEnvironment(source) {
  if (!source || typeof source !== "object") {
    throw adapterError("neon_adapter_options_invalid");
  }
  const result = Object.create(null);
  let keys;
  try {
    keys = Object.getOwnPropertyNames(source);
  } catch {
    throw adapterError("neon_adapter_options_invalid");
  }
  for (const key of keys) {
    if (!PROCESS_ENV_KEYS.has(key.toLowerCase())) continue;
    const value = ownDataValue(source, key);
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

function branchGetArgs(projectId, branchIdOrName) {
  return [
    "api",
    `/projects/${projectId}/branches/${encodeURIComponent(
      branchIdOrName,
    )}`,
  ];
}

function branchListSearchArgs(projectId, branchName) {
  return [
    "api",
    `/projects/${projectId}/branches?search=${encodeURIComponent(
      branchName,
    )}&limit=10000&include_deleted=false`,
  ];
}

function branchEndpointsArgs(projectId, branchId) {
  return [
    "api",
    `/projects/${projectId}/branches/${branchId}/endpoints`,
  ];
}

function createBranchRequest({
  branchName,
  parentBranchId,
  expiresAt,
}) {
  return JSON.stringify({
    branch: {
      name: branchName,
      parent_id: parentBranchId,
      expires_at: expiresAt,
      protected: false,
    },
    endpoints: [{ type: "read_write" }],
  });
}

function projectCreatedBranch(response) {
  const branch = requireObject(response, "branch");
  return Object.freeze({
    branchId: requirePattern(
      branch,
      "id",
      BRANCH_ID_PATTERN,
      "neon_cli_response_invalid",
    ),
    branchName: requirePattern(
      branch,
      "name",
      BRANCH_NAME_PATTERN,
      "neon_cli_response_invalid",
    ),
  });
}

function projectCreatedBranchFromExactNameList(
  response,
  expectedBranchName,
) {
  const branches = ownDataValue(response, "branches");
  const pagination = requireObject(response, "pagination");
  if (
    !Array.isArray(branches) ||
    ownDataValue(pagination, "next") !== null
  ) {
    throw adapterError("neon_cli_response_invalid");
  }

  const exactMatches = [];
  for (const branch of branches) {
    if (
      !branch ||
      typeof branch !== "object" ||
      Array.isArray(branch)
    ) {
      throw adapterError("neon_cli_response_invalid");
    }
    const branchName = requireString(
      branch,
      "name",
      "neon_cli_response_invalid",
    );
    if (branchName === expectedBranchName) {
      exactMatches.push(branch);
    }
  }
  if (exactMatches.length === 0) return null;
  if (exactMatches.length !== 1) {
    throw adapterError("neon_cli_response_invalid");
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
    "neon_cli_response_invalid",
  );
  const expiresAt = ownDataValue(branch, "expires_at");
  return Object.freeze({
    projectId: requirePattern(
      branch,
      "project_id",
      PROJECT_ID_PATTERN,
      "neon_cli_response_invalid",
    ),
    parentBranchId: ownStringOrNull(branch, "parent_id"),
    branchId: requirePattern(
      branch,
      "id",
      BRANCH_ID_PATTERN,
      "neon_cli_response_invalid",
    ),
    branchName: requireString(
      branch,
      "name",
      "neon_cli_response_invalid",
    ),
    branchState,
    branchReady: branchState === "ready",
    default: ownDataValue(branch, "default"),
    primary: ownDataValue(branch, "primary"),
    protected: ownDataValue(branch, "protected"),
    autoExpires:
      expectedExpiresAt !== null &&
      expiresAt === expectedExpiresAt &&
      typeof expiresAt === "string" &&
      Number.isFinite(Date.parse(expiresAt)) &&
      Date.parse(expiresAt) > currentTime.valueOf(),
  });
}

function projectControlPlaneEndpoint({
  endpointResponse,
  expectedEndpointId,
}) {
  const endpoints = ownDataValue(endpointResponse, "endpoints");
  if (!Array.isArray(endpoints)) {
    throw adapterError("neon_cli_response_invalid");
  }
  const readWriteEndpoints = endpoints.filter(
    (endpoint) =>
      ownDataValue(endpoint, "type") === "read_write",
  );
  if (readWriteEndpoints.length !== 1) {
    throw adapterError("neon_cli_response_invalid");
  }
  const endpoint = readWriteEndpoints[0];
  const endpointId = requirePattern(
    endpoint,
    "id",
    ENDPOINT_ID_PATTERN,
    "neon_cli_response_invalid",
  );
  const endpointState = requireString(
    endpoint,
    "current_state",
    "neon_cli_response_invalid",
  );
  const endpointDisabled = ownDataValue(endpoint, "disabled");
  if (typeof endpointDisabled !== "boolean") {
    throw adapterError("neon_cli_response_invalid");
  }
  if (
    expectedEndpointId !== null &&
    endpointId !== expectedEndpointId
  ) {
    throw adapterError("neon_cli_response_invalid");
  }
  return Object.freeze({
    endpointId,
    endpointProjectId: requirePattern(
      endpoint,
      "project_id",
      PROJECT_ID_PATTERN,
      "neon_cli_response_invalid",
    ),
    endpointBranchId: requirePattern(
      endpoint,
      "branch_id",
      BRANCH_ID_PATTERN,
      "neon_cli_response_invalid",
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

function projectProcessResult(result) {
  const status = ownDataValue(result, "status");
  const signal = ownDataValue(result, "signal");
  const stdout = ownDataValue(result, "stdout");
  const stderr = ownDataValue(result, "stderr");
  if (
    !Number.isInteger(status) ||
    !(signal === null || typeof signal === "string") ||
    typeof stdout !== "string" ||
    typeof stderr !== "string" ||
    Buffer.byteLength(stdout, "utf8") > MAX_OUTPUT_BYTES ||
    Buffer.byteLength(stderr, "utf8") > MAX_OUTPUT_BYTES
  ) {
    throw adapterError("neon_cli_execution_failed");
  }
  return { status, signal, stdout, stderr };
}

function isTimedOutProcessResult(result) {
  const error = ownDataValue(result, "error");
  return (
    error &&
    typeof error === "object" &&
    ownDataValue(error, "code") === "ETIMEDOUT"
  );
}

function createProcessDeadline({ timeoutMs, monotonicNow }) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_PROCESS_TIMEOUT_MS
  ) {
    throw adapterError("neon_adapter_input_invalid");
  }
  return readMonotonicNow(monotonicNow) + timeoutMs;
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

function isExactNotFound(result) {
  return (
    result.status !== 0 &&
    result.signal === null &&
    result.stdout.length === 0 &&
    NOT_FOUND_PATTERN.test(result.stderr)
  );
}

function parseExpiration(value, now) {
  const currentTime = now();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (
    !(currentTime instanceof Date) ||
    !Number.isFinite(currentTime.valueOf()) ||
    !Number.isFinite(parsed) ||
    parsed <= currentTime.valueOf()
  ) {
    throw adapterError("neon_adapter_options_invalid");
  }
  return new Date(parsed).toISOString();
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
    throw adapterError("neon_cli_response_invalid");
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

function childReadError(error, stage) {
  const code = ownDataValue(error, "code");
  const reason = childReadReason(code);
  return adapterError(
    typeof code === "string" ? code : "neon_cli_execution_failed",
    { stage, reason },
  );
}

function childReadReason(code) {
  if (code === "neon_cli_exact_not_found") {
    return "exact_not_found";
  }
  if (code === "neon_cli_timeout") return "timeout";
  if (code === "neon_cli_response_invalid") {
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
