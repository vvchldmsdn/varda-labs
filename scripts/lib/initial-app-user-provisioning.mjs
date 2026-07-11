import { createHash } from "node:crypto";

export const INITIAL_APP_USER_STATUS = "provisioning";
export const INITIAL_APP_USER_ROLE = "user";
export const INITIAL_APP_USER_WRITE_CONFIRMATION = "INITIAL_APP_USER_ONLY";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ProvisioningArgumentError extends Error {
  constructor(code) {
    super("Initial app-user provisioning arguments are invalid");
    this.name = "ProvisioningArgumentError";
    this.code = code;
  }
}

export function parseProvisioningArgs(argv) {
  let initialOwnerId = null;
  let write = false;
  let confirmation = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--initial-owner-id" && initialOwnerId === null) {
      initialOwnerId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--write" && !write) {
      write = true;
      continue;
    }
    if (arg === "--confirm" && confirmation === null) {
      confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new ProvisioningArgumentError("unsupported_or_duplicate_argument");
  }

  if (initialOwnerId === null || initialOwnerId.trim().length === 0) {
    throw new ProvisioningArgumentError("missing_initial_owner_id");
  }
  if (write && confirmation !== INITIAL_APP_USER_WRITE_CONFIRMATION) {
    throw new ProvisioningArgumentError("missing_write_confirmation");
  }
  if (!write && confirmation !== null) {
    throw new ProvisioningArgumentError("confirmation_without_write");
  }

  return Object.freeze({
    initialOwnerId: initialOwnerId.trim(),
    write,
  });
}

export function isCanonicalUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function buildInitialProvisioningPlan({ initialOwnerId, state }) {
  const validOwnerId = isCanonicalUuid(initialOwnerId);
  const ownerFingerprint = validOwnerId
    ? fingerprint(initialOwnerId.trim().toLowerCase())
    : null;
  const blockers = [];

  if (!validOwnerId) blockers.push("invalid_initial_owner_id");
  if (!state.schemaContractValid) blockers.push("identity_schema_mismatch");
  if (!state.writerReadiness.registryShadow) {
    blockers.push("writer_registry_not_shadow");
  }
  if (state.writerReadiness.runtimeOwnerIntegrationCount !== 0) {
    blockers.push("runtime_owner_integration_detected");
  }
  if (state.writerReadiness.httpCanonicalOwnerInputCount !== 0) {
    blockers.push("canonical_owner_http_input_detected");
  }
  if (state.writerReadiness.ownerInferencePathCount !== 0) {
    blockers.push("owner_inference_path_detected");
  }
  if (state.authIdentityCount !== 0) {
    blockers.push("auth_identity_preexists");
  }
  if (state.canonicalOwnerNonNullRows !== 0) {
    blockers.push("canonical_owner_preexists");
  }

  const appUserCount = state.appUsers.length;
  let candidateExact = false;

  if (appUserCount > 1) {
    blockers.push("multiple_app_users_exist");
  } else if (appUserCount === 1 && validOwnerId) {
    const existing = state.appUsers[0];
    const candidateMatches =
      existing.id.toLowerCase() === initialOwnerId.trim().toLowerCase();
    candidateExact =
      candidateMatches &&
      existing.status === INITIAL_APP_USER_STATUS &&
      existing.role === INITIAL_APP_USER_ROLE;

    if (!candidateMatches) {
      blockers.push("different_app_user_exists");
    } else if (!candidateExact) {
      blockers.push("existing_app_user_state_mismatch");
    }
  }

  let result = "blocked";
  if (blockers.length === 0) {
    result = appUserCount === 0 ? "planned_insert" : "already_provisioned";
  }

  const expectedAppUserCount =
    result === "planned_insert" ? 1 : appUserCount;
  const manifest = sanitizedManifest(state);

  return Object.freeze({
    operation: "initial_app_user_provisioning",
    mode: "dry_run",
    result,
    ownerFingerprint,
    manifestHash: fingerprint(stableStringify(manifest)),
    appUserCount: Object.freeze({
      current: appUserCount,
      expected: expectedAppUserCount,
    }),
    plannedWrites: Object.freeze({
      appUsers: result === "planned_insert" ? 1 : 0,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    }),
    guards: Object.freeze(manifest),
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(["actual_write_requires_separate_approval"]),
    committed: false,
    databaseSideEffects: false,
  });
}

export function blockedProvisioningOutput(blocker) {
  const manifest = {
    schemaContractValid: false,
    writerRegistryShadow: false,
    runtimeOwnerIntegrationCount: 0,
    httpCanonicalOwnerInputCount: 0,
    ownerInferencePathCount: 0,
    authIdentityCount: 0,
    canonicalOwnerNonNullRows: 0,
  };

  return Object.freeze({
    operation: "initial_app_user_provisioning",
    mode: "dry_run",
    result: "blocked",
    ownerFingerprint: null,
    manifestHash: fingerprint(stableStringify(manifest)),
    appUserCount: Object.freeze({ current: 0, expected: 0 }),
    plannedWrites: Object.freeze({
      appUsers: 0,
      authIdentities: 0,
      financialTables: 0,
      canonicalOwners: 0,
    }),
    guards: Object.freeze(manifest),
    blockers: Object.freeze([blocker]),
    warnings: Object.freeze([]),
    committed: false,
    databaseSideEffects: false,
  });
}

function sanitizedManifest(state) {
  return {
    schemaContractValid: state.schemaContractValid,
    writerRegistryShadow: state.writerReadiness.registryShadow,
    runtimeOwnerIntegrationCount:
      state.writerReadiness.runtimeOwnerIntegrationCount,
    httpCanonicalOwnerInputCount:
      state.writerReadiness.httpCanonicalOwnerInputCount,
    ownerInferencePathCount: state.writerReadiness.ownerInferencePathCount,
    authIdentityCount: state.authIdentityCount,
    canonicalOwnerNonNullRows: state.canonicalOwnerNonNullRows,
    identityColumnContract: state.schemaManifest.identityColumnContract,
    identityConstraintContract: state.schemaManifest.identityConstraintContract,
    identityIndexContract: state.schemaManifest.identityIndexContract,
    canonicalColumnContract: state.schemaManifest.canonicalColumnContract,
    canonicalIndexContract: state.schemaManifest.canonicalIndexContract,
  };
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
