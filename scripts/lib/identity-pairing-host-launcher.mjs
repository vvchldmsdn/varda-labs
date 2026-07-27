import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  IDENTITY_PAIRING_CATALOG_PREFLIGHT_FAILURE_CODES,
} from "./identity-pairing-catalog-preflight.mjs";
import {
  IDENTITY_PAIRING_REHEARSAL_STAGES,
} from "./identity-pairing-rehearsal-evidence.mjs";
import {
  IDENTITY_PAIRING_REHEARSAL_CONFIRMATION,
} from "./identity-pairing-host-target.mjs";

const LAUNCHER = "identity_pairing_host_launcher_v1";
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");
const IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

const MODE_POLICIES = Object.freeze({
  preflight: Object.freeze({
    scriptPath: fileURLToPath(
      new URL("../preflight-identity-pairing-catalog.mjs", import.meta.url),
    ),
    args: Object.freeze([]),
    successMarker: "audit",
    successValue: "identity_pairing_schema_catalog",
  }),
  rehearsal: Object.freeze({
    scriptPath: fileURLToPath(
      new URL(
        "../rehearse-identity-pairing-consume-writer.mjs",
        import.meta.url,
      ),
    ),
    args: Object.freeze([IDENTITY_PAIRING_REHEARSAL_CONFIRMATION]),
    successMarker: "rehearsal",
    successValue:
      "identity_pairing_atomic_consume_disposable_branch",
  }),
});

const SPAWN_ERROR_CODES = Object.freeze({
  EACCES: "host_spawn_eacces",
  EINVAL: "host_spawn_einval",
  ENOBUFS: "host_spawn_enobufs",
  ENOENT: "host_spawn_enoent",
  ENOMEM: "host_spawn_enomem",
  EPERM: "host_spawn_eperm",
});

const SAFE_PREFLIGHT_FAILURE_CODES = new Set(
  IDENTITY_PAIRING_CATALOG_PREFLIGHT_FAILURE_CODES,
);
const SAFE_REHEARSAL_STAGES = new Set(
  IDENTITY_PAIRING_REHEARSAL_STAGES,
);

export const IDENTITY_PAIRING_HOST_LAUNCHER = LAUNCHER;

export function createIdentityPairingHostCommand(
  mode,
  nodeExecutable = process.execPath,
) {
  const policy = requireModePolicy(mode);
  if (
    typeof nodeExecutable !== "string" ||
    nodeExecutable.length === 0
  ) {
    throw new Error("Identity pairing host executable is invalid.");
  }
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([
      "--no-warnings",
      policy.scriptPath,
      ...policy.args,
    ]),
  });
}

export function runIdentityPairingHostCommand({
  mode,
  cwd = process.cwd(),
  env = process.env,
  nodeExecutable = process.execPath,
  spawn = spawnSync,
} = {}) {
  let command;
  try {
    command = createIdentityPairingHostCommand(mode, nodeExecutable);
  } catch {
    return createIdentityPairingHostFailure({
      mode,
      code: "host_options_invalid",
    });
  }

  let result;
  try {
    result = spawn(command.command, command.args, {
      cwd,
      env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: MAX_CHILD_OUTPUT_BYTES,
    });
  } catch (error) {
    return createIdentityPairingHostFailure({
      mode,
      code: spawnFailureCode(error),
    });
  }
  return classifyIdentityPairingHostCommandResult({ mode, result });
}

export function classifyIdentityPairingHostCommandResult({
  mode,
  result,
}) {
  const policy = MODE_POLICIES[mode];
  if (!policy || !result || typeof result !== "object") {
    return createIdentityPairingHostFailure({
      mode,
      code: "host_child_protocol_invalid",
    });
  }

  const error = ownDataValue(result, "error");
  const status = ownDataValue(result, "status");
  const signal = ownDataValue(result, "signal");
  const stdout = ownDataValue(result, "stdout");
  const stderr = ownDataValue(result, "stderr");
  const childProtocolInvalid =
    [status, signal, stdout, stderr].some(
      (value) => value === MISSING || value === INVALID,
    ) || error === INVALID;
  const childSpawnError =
    error !== MISSING && error !== undefined && error !== null;
  if (
    childProtocolInvalid ||
    childSpawnError ||
    (!Number.isInteger(status) && status !== null) ||
    (signal !== null && !isSafeSignal(signal)) ||
    typeof stdout !== "string" ||
    typeof stderr !== "string"
  ) {
    return createIdentityPairingHostFailure({
      mode,
      code: childSpawnError
        ? spawnFailureCode(error)
        : "host_child_protocol_invalid",
      child: childMetadata({ status, signal, stdout, stderr }),
    });
  }

  const child = childMetadata({ status, signal, stdout, stderr });
  if (signal !== null) {
    return createIdentityPairingHostFailure({
      mode,
      code: "host_child_signaled",
      child,
    });
  }
  if (status === null) {
    return createIdentityPairingHostFailure({
      mode,
      code: "host_child_protocol_invalid",
      child,
    });
  }
  if (status === 0) {
    const evidence = parseExpectedSuccess(
      stdout,
      stderr,
      mode,
      policy,
    );
    if (evidence === null) {
      return createIdentityPairingHostFailure({
        mode,
        code: "host_child_success_protocol_invalid",
        child,
      });
    }
    return Object.freeze({
      launcher: LAUNCHER,
      mode,
      status: "passed",
      code: "host_child_passed",
      child,
      evidence,
    });
  }

  const childEvidence = parseExpectedFailure(stderr, stdout, mode);
  if (childEvidence === null) {
    return createIdentityPairingHostFailure({
      mode,
      code: "host_child_failure_protocol_invalid",
      child,
    });
  }
  return createIdentityPairingHostFailure({
    mode,
    code: "host_child_reported_failure",
    child,
    childEvidence,
  });
}

export function createIdentityPairingHostFailure({
  mode,
  code,
  child,
  childEvidence,
}) {
  const envelope = {
    launcher: LAUNCHER,
    mode: MODE_POLICIES[mode] ? mode : "unknown",
    status: "failed",
    code,
  };
  if (child !== undefined) envelope.child = child;
  if (childEvidence !== undefined) {
    envelope.childEvidence = childEvidence;
  }
  return Object.freeze(envelope);
}

function parseExpectedSuccess(stdout, stderr, mode, policy) {
  if (stderr.length !== 0) return null;
  const evidence = parseJsonRecord(stdout);
  if (
    evidence === null ||
    evidence.status !== "passed" ||
    evidence[policy.successMarker] !== policy.successValue
  ) {
    return null;
  }

  if (mode === "preflight") {
    if (
      evidence.state !== "present" ||
      evidence.readOnly !== true ||
      evidence.databaseWrites !== 0
    ) {
      return null;
    }
    return Object.freeze({
      audit: evidence.audit,
      status: evidence.status,
      state: evidence.state,
      readOnly: true,
      databaseWrites: 0,
    });
  }

  if (
    evidence.stage !== "completed" ||
    !SAFE_REHEARSAL_STAGES.has(evidence.lastCompletedCheck) ||
    evidence.poolReadiness !== true ||
    evidence.disposableBranchDmlAttempted !== true ||
    evidence.productionDatabaseWrites !== 0 ||
    evidence.branchDeletionRequired !== true
  ) {
    return null;
  }
  return Object.freeze({
    rehearsal: evidence.rehearsal,
    status: evidence.status,
    stage: evidence.stage,
    lastCompletedCheck: evidence.lastCompletedCheck,
    poolReadiness: true,
    disposableBranchDmlAttempted: true,
    productionDatabaseWrites: 0,
    branchDeletionRequired: true,
  });
}

function parseExpectedFailure(stderr, stdout, mode) {
  if (stdout.length !== 0) return null;
  const evidence = parseJsonRecord(stderr);
  if (evidence === null || evidence.status !== "failed") return null;

  if (mode === "preflight") {
    if (
      evidence.preflight !==
        "identity_pairing_catalog_child_audit" ||
      typeof evidence.code !== "string" ||
      !SAFE_PREFLIGHT_FAILURE_CODES.has(evidence.code)
    ) {
      return null;
    }
    return Object.freeze({
      preflight: evidence.preflight,
      status: evidence.status,
      code: evidence.code,
    });
  }

  if (
    evidence.rehearsal !==
      "identity_pairing_atomic_consume_disposable_branch" ||
    !SAFE_REHEARSAL_STAGES.has(evidence.stage) ||
    !(
      evidence.lastCompletedCheck === "none" ||
      SAFE_REHEARSAL_STAGES.has(evidence.lastCompletedCheck)
    ) ||
    typeof evidence.poolReadiness !== "boolean" ||
    typeof evidence.disposableBranchDmlAttempted !== "boolean" ||
    !isSafeIdentifier(evidence.code) ||
    evidence.productionDatabaseWrites !== 0 ||
    evidence.branchDeletionRequired !== true
  ) {
    return null;
  }
  return Object.freeze({
    rehearsal: evidence.rehearsal,
    status: evidence.status,
    stage: evidence.stage,
    lastCompletedCheck: evidence.lastCompletedCheck,
    poolReadiness: evidence.poolReadiness,
    disposableBranchDmlAttempted:
      evidence.disposableBranchDmlAttempted,
    code: evidence.code,
    productionDatabaseWrites: 0,
    branchDeletionRequired: true,
  });
}

function childMetadata({ status, signal, stdout, stderr }) {
  return Object.freeze({
    exitStatus: Number.isInteger(status) ? status : null,
    signal: isSafeSignal(signal) ? signal : null,
    stdoutPresent: typeof stdout === "string" && stdout.length > 0,
    stdoutBytes:
      typeof stdout === "string" ? Buffer.byteLength(stdout) : 0,
    stderrPresent: typeof stderr === "string" && stderr.length > 0,
    stderrBytes:
      typeof stderr === "string" ? Buffer.byteLength(stderr) : 0,
  });
}

function requireModePolicy(mode) {
  const policy = MODE_POLICIES[mode];
  if (!policy) {
    throw new Error("Identity pairing host mode is invalid.");
  }
  return policy;
}

function parseJsonRecord(raw) {
  try {
    const value = JSON.parse(raw);
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function spawnFailureCode(error) {
  const code = ownDataValue(error, "code");
  if (typeof code !== "string") return "host_spawn_failed";
  return SPAWN_ERROR_CODES[code] ?? "host_spawn_failed";
}

function ownDataValue(value, key) {
  if (!value || typeof value !== "object") return MISSING;
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

function isSafeSignal(value) {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 24 &&
      /^[A-Z0-9]+$/.test(value))
  );
}

function isSafeIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length <= 96 &&
    IDENTIFIER_PATTERN.test(value)
  );
}
