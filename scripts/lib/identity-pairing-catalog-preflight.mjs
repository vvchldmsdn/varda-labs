import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AUDIT_NAME = "identity_pairing_schema_catalog";
const AUDIT_SCRIPT_PATH = fileURLToPath(
  new URL("../audit-identity-pairing-schema.mjs", import.meta.url),
);
const MAX_CHILD_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_FAILURE_ENVELOPE_BYTES = 512;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");

const CHILD_FAILURE_CODES = Object.freeze({
  options: "catalog_preflight_child_options_failed",
  target_guard: "catalog_preflight_child_target_guard_failed",
  local_evidence: "catalog_preflight_child_local_evidence_failed",
  database_read: "catalog_preflight_child_database_read_failed",
  migration_plan: "catalog_preflight_child_migration_plan_failed",
  catalog_validation: "catalog_preflight_child_catalog_validation_failed",
  output: "catalog_preflight_child_output_failed",
});

const SPAWN_ERROR_CODES = Object.freeze({
  EACCES: "catalog_preflight_spawn_eacces",
  ENOBUFS: "catalog_preflight_spawn_enobufs",
  ENOENT: "catalog_preflight_spawn_enoent",
  ENOMEM: "catalog_preflight_spawn_enomem",
  EPERM: "catalog_preflight_spawn_eperm",
});

export const IDENTITY_PAIRING_CATALOG_PREFLIGHT_FAILURE_CODES = Object.freeze([
  ...Object.values(CHILD_FAILURE_CODES),
  ...Object.values(SPAWN_ERROR_CODES),
  "catalog_preflight_spawn_failed",
  "catalog_preflight_child_signaled",
  "catalog_preflight_child_protocol_invalid",
  "catalog_preflight_success_protocol_invalid",
  "catalog_preflight_evidence_invalid",
]);

export function createIdentityPairingCatalogAuditFailure(stage) {
  const code = CHILD_FAILURE_CODES[stage];
  if (!code) {
    throw new Error("Identity pairing catalog audit stage is not allowlisted.");
  }
  return Object.freeze({
    audit: AUDIT_NAME,
    status: "failed",
    stage,
    code,
  });
}

export function createIdentityPairingCatalogAuditCommand(
  nodeExecutable = process.execPath,
) {
  if (typeof nodeExecutable !== "string" || nodeExecutable.length === 0) {
    throw new Error("Identity pairing catalog audit executable is invalid.");
  }
  return Object.freeze({
    command: nodeExecutable,
    args: Object.freeze([
      "--no-warnings",
      AUDIT_SCRIPT_PATH,
      "--expect-state",
      "present",
    ]),
  });
}

export function runIdentityPairingCatalogAuditProcess({
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
} = {}) {
  let command;
  try {
    command = createIdentityPairingCatalogAuditCommand();
  } catch (error) {
    return failed(spawnFailureCode(error));
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
    return failed(spawnFailureCode(error));
  }
  return classifyIdentityPairingCatalogAuditProcessResult(result);
}

export function classifyIdentityPairingCatalogAuditProcessResult(result) {
  if (!result || typeof result !== "object") {
    return failed("catalog_preflight_child_protocol_invalid");
  }

  const error = ownDataValue(result, "error");
  if (error === INVALID) {
    return failed("catalog_preflight_child_protocol_invalid");
  }
  if (error !== MISSING && error !== undefined && error !== null) {
    return failed(spawnFailureCode(error));
  }

  const signal = ownDataValue(result, "signal");
  const status = ownDataValue(result, "status");
  const stdout = ownDataValue(result, "stdout");
  const stderr = ownDataValue(result, "stderr");
  if (
    signal === MISSING ||
    signal === INVALID ||
    status === MISSING ||
    status === INVALID ||
    stdout === MISSING ||
    stdout === INVALID ||
    stderr === MISSING ||
    stderr === INVALID
  ) {
    return failed("catalog_preflight_child_protocol_invalid");
  }
  if (typeof signal === "string" && signal.length > 0) {
    return failed("catalog_preflight_child_signaled");
  }
  if (signal !== null || !Number.isInteger(status)) {
    return failed("catalog_preflight_child_protocol_invalid");
  }
  if (typeof stdout !== "string" || typeof stderr !== "string") {
    return failed("catalog_preflight_child_protocol_invalid");
  }

  if (status !== 0) {
    const childFailure = parseChildFailureEnvelope(stderr);
    return failed(
      childFailure?.code ?? "catalog_preflight_child_protocol_invalid",
    );
  }

  const evidence = parseJsonRecord(stdout);
  if (
    evidence === null ||
    evidence.audit !== AUDIT_NAME ||
    evidence.status !== "passed"
  ) {
    return failed("catalog_preflight_success_protocol_invalid");
  }
  return Object.freeze({
    status: "passed",
    evidence,
  });
}

function parseChildFailureEnvelope(raw) {
  if (
    raw.length === 0 ||
    raw.length > MAX_FAILURE_ENVELOPE_BYTES
  ) {
    return null;
  }
  const envelope = parseJsonRecord(raw);
  if (envelope === null) return null;
  if (
    envelope.audit !== AUDIT_NAME ||
    envelope.status !== "failed" ||
    typeof envelope.stage !== "string" ||
    typeof envelope.code !== "string" ||
    CHILD_FAILURE_CODES[envelope.stage] !== envelope.code
  ) {
    return null;
  }
  const keys = Object.keys(envelope).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "audit" ||
    keys[1] !== "code" ||
    keys[2] !== "stage" ||
    keys[3] !== "status"
  ) {
    return null;
  }
  return envelope;
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
  if (typeof code !== "string") {
    return "catalog_preflight_spawn_failed";
  }
  return SPAWN_ERROR_CODES[code] ?? "catalog_preflight_spawn_failed";
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

function failed(code) {
  return Object.freeze({
    status: "failed",
    code,
  });
}
