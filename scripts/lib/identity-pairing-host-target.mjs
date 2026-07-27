export const IDENTITY_PAIRING_REHEARSAL_CONFIRMATION =
  "--confirm-isolated-identity-pairing-rehearsal";
export const IDENTITY_PAIRING_HOST_ENV_SOURCE =
  "identity_pairing_host_launcher_v1";

const MODES = new Set(["preflight", "rehearsal"]);
const CHILD_RUNTIME_ENV_KEYS = Object.freeze([
  "HOME",
  "SystemRoot",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);
const NEON_BRANCH_ID_PATTERN = /^br-[a-z0-9-]+$/;
const NEON_ENDPOINT_ID_PATTERN = /^ep-[a-z0-9-]+$/;
const REHEARSAL_BRANCH_NAME_PATTERN =
  /^preview\/codex\/identity-pairing-consume-rehearsal(?:-[a-z0-9-]+)?$/;
const MISSING = Symbol("missing");
const INVALID = Symbol("invalid");

export function prepareIdentityPairingHostEnvironment({
  baseEnv,
  branchId,
  branchName,
  endpointId,
}) {
  if (!baseEnv || typeof baseEnv !== "object") {
    throw new Error("Identity pairing host environment is invalid.");
  }
  if (
    typeof branchId !== "string" ||
    !NEON_BRANCH_ID_PATTERN.test(branchId)
  ) {
    throw new Error("Identity pairing host branch id is invalid.");
  }
  if (
    typeof branchName !== "string" ||
    !REHEARSAL_BRANCH_NAME_PATTERN.test(branchName)
  ) {
    throw new Error("Identity pairing host branch name is invalid.");
  }
  if (
    typeof endpointId !== "string" ||
    !NEON_ENDPOINT_ID_PATTERN.test(endpointId)
  ) {
    throw new Error("Identity pairing host endpoint id is invalid.");
  }

  const env = copyAllowlistedEnvironment(
    baseEnv,
    CHILD_RUNTIME_ENV_KEYS,
  );
  env.IDENTITY_PAIRING_HOST_ENV_SOURCE =
    IDENTITY_PAIRING_HOST_ENV_SOURCE;
  env.IDENTITY_PAIRING_REHEARSAL_BRANCH_ID = branchId;
  env.IDENTITY_PAIRING_REHEARSAL_BRANCH_NAME = branchName;

  const neonProjectId = ownPrimitiveString(baseEnv, "NEON_PROJECT_ID");
  if (neonProjectId !== null) {
    env.NEON_PROJECT_ID = neonProjectId;
  }

  const pooled = ownPrimitiveString(baseEnv, "DATABASE_URL");
  const unpooled = ownPrimitiveString(
    baseEnv,
    "DATABASE_URL_UNPOOLED",
  );
  if (pooled !== null && unpooled !== null) {
    env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL =
      rewriteNeonEndpoint(pooled, endpointId);
    env.IDENTITY_PAIRING_REHEARSAL_DATABASE_URL_UNPOOLED =
      rewriteNeonEndpoint(unpooled, endpointId);
  }

  return env;
}

export function readIdentityPairingHostOptions(args) {
  if (!Array.isArray(args)) {
    throw new Error("Identity pairing host arguments are invalid.");
  }
  const values = new Map();
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === IDENTITY_PAIRING_REHEARSAL_CONFIRMATION) {
      if (confirmed) {
        throw new Error("Identity pairing host confirmation is duplicated.");
      }
      confirmed = true;
      continue;
    }
    if (
      !["--mode", "--branch-id", "--branch-name", "--endpoint-id"].includes(
        key,
      ) ||
      values.has(key)
    ) {
      throw new Error("Identity pairing host argument is invalid.");
    }
    const value = args[index + 1];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    ) {
      throw new Error("Identity pairing host argument value is invalid.");
    }
    values.set(key, value);
    index += 1;
  }

  const mode = values.get("--mode");
  if (!MODES.has(mode)) {
    throw new Error("Identity pairing host mode is invalid.");
  }
  if (mode === "rehearsal" ? !confirmed : confirmed) {
    throw new Error("Identity pairing host confirmation is invalid.");
  }
  const branchId = values.get("--branch-id");
  const branchName = values.get("--branch-name");
  const endpointId = values.get("--endpoint-id");
  if (!branchId || !branchName || !endpointId) {
    throw new Error("Identity pairing host target is incomplete.");
  }
  return Object.freeze({
    mode,
    branchId,
    branchName,
    endpointId,
  });
}

function rewriteNeonEndpoint(rawUrl, endpointId) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Identity pairing host database URL is invalid.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Identity pairing host database protocol is invalid.");
  }
  const labels = parsed.hostname.split(".");
  if (
    labels.length < 2 ||
    !parsed.hostname.endsWith(".neon.tech")
  ) {
    throw new Error("Identity pairing host database endpoint is invalid.");
  }
  const pooled = labels[0].endsWith("-pooler");
  parsed.hostname = `${endpointId}${pooled ? "-pooler" : ""}.${labels
    .slice(1)
    .join(".")}`;
  return parsed.toString();
}

function copyAllowlistedEnvironment(value, keys) {
  const copy = {};
  for (const key of keys) {
    const item = ownDataValue(value, key);
    if (typeof item === "string") copy[key] = item;
  }
  return copy;
}

function ownPrimitiveString(value, key) {
  const item = ownDataValue(value, key);
  return typeof item === "string" && item.length > 0 ? item : null;
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
