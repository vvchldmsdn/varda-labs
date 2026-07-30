import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "dotenv";

import {
  createLegacyAccountOwnerAssignmentNeonAdapter,
} from "./lib/legacy-account-owner-assignment-neon-adapter.mjs";
import {
  runLegacyAccountOwnerAssignmentRehearsalHost,
} from "./lib/legacy-account-owner-assignment-rehearsal-host.mjs";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const CONFIRMATION =
  "--confirm-single-disposable-owner-assignment-rehearsal";
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_ROOT =
  resolve(SCRIPT_DIRECTORY, "..");
export const LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_EVIDENCE_DIRECTORY =
  join(
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_ROOT,
    ".rehearsal-evidence",
  );

export async function runLegacyAccountOwnerAssignmentHostCli({
  args = process.argv.slice(2),
  baseEnv = process.env,
  repositoryRoot = LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_ROOT,
  evidenceDirectory =
    LEGACY_ACCOUNT_OWNER_ASSIGNMENT_HOST_EVIDENCE_DIRECTORY,
  clock = () => new Date(),
  loadEnvironment = () =>
    loadLegacyAccountOwnerAssignmentLocalEnvironment(repositoryRoot),
  makeEvidenceDirectory = ensureEvidenceDirectory,
  createAdapter =
    createLegacyAccountOwnerAssignmentNeonAdapter,
  runHost =
    runLegacyAccountOwnerAssignmentRehearsalHost,
  write = (value) => console.log(JSON.stringify(value)),
  writeError = (value) => console.error(JSON.stringify(value)),
  productionDatabasePolicy,
  expectedProductionSourceTargetFingerprint,
  previewDatabasePolicy,
  poolFactory,
} = {}) {
  let options;
  try {
    options = readLegacyAccountOwnerAssignmentHostOptions(args);
    if (
      !isAbsolute(repositoryRoot) ||
      !isAbsolute(evidenceDirectory)
    ) {
      throw new Error("Host paths are invalid.");
    }
  } catch {
    return outputFailure(
      hostCliFailure("host_options_invalid"),
      writeError,
    );
  }

  let neonApiKey;
  let runtimeEnvironment;
  try {
    assertAmbientNeonApiKeyAbsent(baseEnv);
    const localEnvironment = loadEnvironment();
    neonApiKey = readRequiredNeonApiKey(localEnvironment);
    runtimeEnvironment = mergeRuntimeEnvironment({
      baseEnv,
      localEnvironment,
    });
  } catch {
    return outputFailure(
      hostCliFailure("neon_api_key_invalid"),
      writeError,
    );
  }

  try {
    makeEvidenceDirectory(evidenceDirectory);
  } catch {
    return outputFailure(
      hostCliFailure("host_options_invalid"),
      writeError,
    );
  }

  let adapter;
  try {
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
      throw new Error("Host clock is invalid.");
    }
    adapter = createAdapter({
      apiKey: neonApiKey,
      expiresAt: new Date(
        now.valueOf() + 24 * 60 * 60 * 1000,
      ).toISOString(),
      now: clock,
    });
  } catch {
    return outputFailure(
      hostCliFailure("neon_adapter_options_invalid"),
      writeError,
    );
  }

  let result;
  try {
    result = await runHost({
      expectedSourceSha: options.expectedSourceSha,
      repositoryRoot,
      evidenceDirectory,
      baseEnv: runtimeEnvironment,
      projectId: options.projectId,
      parentBranchId: options.parentBranchId,
      productionEndpointId: options.productionEndpointId,
      ...adapter,
      productionDatabasePolicy,
      expectedProductionSourceTargetFingerprint,
      previewDatabasePolicy,
      poolFactory,
    });
  } catch {
    return outputFailure(
      hostCliFailure("host_execution_failed"),
      writeError,
    );
  }
  const resultStatus = ownDataValue(result, "status");
  if (!["passed", "failed"].includes(resultStatus)) {
    return outputFailure(
      hostCliFailure("host_execution_failed"),
      writeError,
    );
  }
  if (resultStatus === "passed") write(result);
  else writeError(result);
  return result;
}

export function loadLegacyAccountOwnerAssignmentLocalEnvironment(
  repositoryRoot,
  {
    readFile = readFileSync,
  } = {},
) {
  const parsed = parse(
    readFile(join(repositoryRoot, ".env.local"), {
      encoding: "utf8",
    }),
  );
  const localEnvironment = Object.create(null);

  for (const key of Object.keys(parsed)) {
    const value = ownDataValue(parsed, key);
    if (typeof value !== "string") {
      throw new Error("Local environment is invalid.");
    }
    localEnvironment[key] = value;
  }

  return localEnvironment;
}

export function readLegacyAccountOwnerAssignmentHostOptions(args) {
  if (!Array.isArray(args)) {
    throw new Error("Host arguments are invalid.");
  }
  const values = new Map();
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === CONFIRMATION) {
      if (confirmed) throw new Error("Confirmation is duplicated.");
      confirmed = true;
      continue;
    }
    if (
      ![
        "--expected-source-sha",
        "--project-id",
        "--parent-branch-id",
        "--production-endpoint-id",
      ].includes(key) ||
      values.has(key)
    ) {
      throw new Error("Host argument is invalid.");
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Host argument value is invalid.");
    }
    values.set(key, value);
    index += 1;
  }

  const expectedSourceSha = values.get("--expected-source-sha");
  const projectId = values.get("--project-id");
  const parentBranchId = values.get("--parent-branch-id");
  const productionEndpointId = values.get(
    "--production-endpoint-id",
  );
  if (
    !confirmed ||
    values.size !== 4 ||
    !SOURCE_SHA_PATTERN.test(expectedSourceSha ?? "") ||
    !PROJECT_ID_PATTERN.test(projectId ?? "") ||
    !BRANCH_ID_PATTERN.test(parentBranchId ?? "") ||
    !ENDPOINT_ID_PATTERN.test(productionEndpointId ?? "")
  ) {
    throw new Error("Host target is invalid.");
  }

  return Object.freeze({
    expectedSourceSha,
    projectId,
    parentBranchId,
    productionEndpointId,
  });
}

function ensureEvidenceDirectory(value) {
  mkdirSync(value, {
    mode: 0o700,
    recursive: true,
  });
  if (!existsSync(value)) {
    throw new Error("Evidence directory is unavailable.");
  }
}

function hostCliFailure(code) {
  return Object.freeze({
    host: "legacy_account_owner_assignment_rehearsal_host_v1",
    status: "failed",
    code,
    runId: null,
    invocationCounts: Object.freeze({
      branchCreate: 0,
      exactNameReconciliation: 0,
      branchDelete: 0,
      exactIdNotFoundCheck: 0,
    }),
    cleanup: null,
  });
}

function outputFailure(result, writeError) {
  writeError(result);
  return result;
}

function ownDataValue(value, key) {
  if (!value || typeof value !== "object") return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function readRequiredNeonApiKey(source) {
  const value = ownDataValue(source, "NEON_API_KEY");
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\s\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error("Neon API key is unavailable.");
  }
  return value;
}

function assertAmbientNeonApiKeyAbsent(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Host environment is unavailable.");
  }
  let current = source;
  const visited = new Set();
  while (current !== null) {
    if (visited.has(current)) {
      throw new Error("Host environment is invalid.");
    }
    visited.add(current);
    let descriptor;
    let prototype;
    try {
      descriptor = Object.getOwnPropertyDescriptor(
        current,
        "NEON_API_KEY",
      );
      prototype = Object.getPrototypeOf(current);
    } catch {
      throw new Error("Host environment is invalid.");
    }
    if (descriptor !== undefined) {
      throw new Error("Ambient Neon API key is not allowed.");
    }
    current = prototype;
  }
}

function mergeRuntimeEnvironment({
  baseEnv,
  localEnvironment,
}) {
  if (
    !baseEnv ||
    typeof baseEnv !== "object" ||
    !localEnvironment ||
    typeof localEnvironment !== "object"
  ) {
    throw new Error("Host environment is unavailable.");
  }
  const runtimeEnvironment = Object.create(null);
  copyEnvironmentData(runtimeEnvironment, baseEnv, {
    overwrite: false,
  });
  copyEnvironmentData(runtimeEnvironment, localEnvironment, {
    overwrite: false,
    excludedKeys: new Set(["NEON_API_KEY"]),
  });
  return runtimeEnvironment;
}

function copyEnvironmentData(
  target,
  source,
  { overwrite, excludedKeys = new Set() },
) {
  let descriptors;
  try {
    descriptors = Object.getOwnPropertyDescriptors(source);
  } catch {
    throw new Error("Host environment is invalid.");
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      excludedKeys.has(key) ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      (!overwrite &&
        Object.prototype.hasOwnProperty.call(target, key))
    ) {
      continue;
    }
    Object.defineProperty(target, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  const result =
    await runLegacyAccountOwnerAssignmentHostCli();
  if (result.status === "failed") process.exitCode = 1;
}
