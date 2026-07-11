export const TENANT_EXPAND_PHASES = Object.freeze({
  expandedEmpty: "expanded_empty",
  provisionedEmptyOwner: "provisioned_empty_owner",
});

export class TenantExpandPhaseError extends Error {
  constructor(code) {
    super("Tenant expand state is outside the approved phase contract");
    this.name = "TenantExpandPhaseError";
    this.code = code;
  }
}

export function classifyTenantExpandPhase(input) {
  const state = normalizeState(input);

  if (
    state.appUsers === 0 &&
    state.provisioningUsers === 0 &&
    state.activeUsers === 0 &&
    state.disabledUsers === 0 &&
    state.userRoleUsers === 0 &&
    state.adminUsers === 0 &&
    state.authIdentities === 0 &&
    state.canonicalOwnerNonNullRows === 0
  ) {
    return TENANT_EXPAND_PHASES.expandedEmpty;
  }

  if (
    state.appUsers === 1 &&
    state.provisioningUsers === 1 &&
    state.activeUsers === 0 &&
    state.disabledUsers === 0 &&
    state.userRoleUsers === 1 &&
    state.adminUsers === 0 &&
    state.authIdentities === 0 &&
    state.canonicalOwnerNonNullRows === 0
  ) {
    return TENANT_EXPAND_PHASES.provisionedEmptyOwner;
  }

  throw new TenantExpandPhaseError("unapproved_tenant_phase_state");
}

function normalizeState(input) {
  const normalized = {};
  for (const key of [
    "appUsers",
    "provisioningUsers",
    "activeUsers",
    "disabledUsers",
    "userRoleUsers",
    "adminUsers",
    "authIdentities",
    "canonicalOwnerNonNullRows",
  ]) {
    const value = Number(input[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TenantExpandPhaseError("invalid_tenant_phase_count");
    }
    normalized[key] = value;
  }

  if (
    normalized.provisioningUsers +
      normalized.activeUsers +
      normalized.disabledUsers !==
      normalized.appUsers ||
    normalized.userRoleUsers + normalized.adminUsers !== normalized.appUsers
  ) {
    throw new TenantExpandPhaseError("inconsistent_app_user_counts");
  }

  return normalized;
}
