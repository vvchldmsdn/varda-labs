import {
  parseNeonDatabaseUrl,
  sha256Fingerprint,
} from "./preview-database-target.ts";

export const TENANT_DATABASE_ROLE_BOUNDARY_POLICY = Object.freeze({
  policyId: "tenant_database_role_boundary_v1",
  privilegedEnvironmentKey: "DATABASE_URL",
  tenantEnvironmentKey: "TENANT_DATABASE_URL",
});

export type TenantDatabaseRoleBoundaryEnvironment = {
  [key: string]: string | undefined;
  DATABASE_URL?: string;
  TENANT_DATABASE_URL?: string;
};

export type TenantDatabaseRoleBoundary = {
  policyId: typeof TENANT_DATABASE_ROLE_BOUNDARY_POLICY.policyId;
  status: "credential_boundary_passed";
  endpointFingerprint: string;
  databaseFingerprint: string;
  privilegedRoleFingerprint: string;
  tenantRoleFingerprint: string;
  credentialSeparation: "distinct_role_and_secret";
};

export type DatabaseRoleEvidence = {
  sessionRole: string;
  currentRole: string;
  roleCanLogin: boolean;
  roleIsSuperuser: boolean;
  roleBypassesRls: boolean;
  roleCanCreateDatabase: boolean;
  roleCanCreateRole: boolean;
  roleCanReplicate: boolean;
  roleOwnsPublicTableCount: number;
  privilegedMembershipCount: number;
  canCreateInPublicSchema: boolean;
  publicTableCount: number;
  rlsEnabledPublicTableCount: number;
  rlsForcedPublicTableCount: number;
};

export type DatabaseRoleSecurityAssessment = {
  policyId: typeof TENANT_DATABASE_ROLE_BOUNDARY_POLICY.policyId;
  status: "role_boundary_passed" | "blocked";
  roleFingerprint: string;
  sessionRoleMatchesCurrentRole: boolean;
  roleCanLogin: boolean;
  roleIsSuperuser: boolean;
  roleBypassesRls: boolean;
  roleCanCreateDatabase: boolean;
  roleCanCreateRole: boolean;
  roleCanReplicate: boolean;
  roleOwnsPublicTableCount: number;
  privilegedMembershipCount: number;
  canCreateInPublicSchema: boolean;
  publicTableCount: number;
  rlsEnabledPublicTableCount: number;
  rlsForcedPublicTableCount: number;
  blockers: readonly string[];
  rlsPolicyStatus: "separate_gate_not_evaluated";
};

export function guardTenantDatabaseRoleBoundary(
  environment: TenantDatabaseRoleBoundaryEnvironment,
): TenantDatabaseRoleBoundary {
  const privilegedUrl = requiredValue(
    environment.DATABASE_URL,
    TENANT_DATABASE_ROLE_BOUNDARY_POLICY.privilegedEnvironmentKey,
  );
  const tenantUrl = requiredValue(
    environment.TENANT_DATABASE_URL,
    TENANT_DATABASE_ROLE_BOUNDARY_POLICY.tenantEnvironmentKey,
  );
  const privileged = parseNeonDatabaseUrl(privilegedUrl);
  const tenant = parseNeonDatabaseUrl(tenantUrl);

  if (
    privileged.endpointId !== tenant.endpointId ||
    privileged.databaseName !== tenant.databaseName
  ) {
    throw new Error(
      "Privileged and tenant database URLs must identify the same Neon database target.",
    );
  }
  if (privileged.username === tenant.username) {
    throw new Error(
      "TENANT_DATABASE_URL must use a database role distinct from DATABASE_URL.",
    );
  }
  if (privileged.password === tenant.password) {
    throw new Error(
      "TENANT_DATABASE_URL must use a credential secret distinct from DATABASE_URL.",
    );
  }

  return Object.freeze({
    policyId: TENANT_DATABASE_ROLE_BOUNDARY_POLICY.policyId,
    status: "credential_boundary_passed",
    endpointFingerprint: sha256Fingerprint(tenant.endpointId),
    databaseFingerprint: sha256Fingerprint(tenant.databaseName),
    privilegedRoleFingerprint: sha256Fingerprint(privileged.username),
    tenantRoleFingerprint: sha256Fingerprint(tenant.username),
    credentialSeparation: "distinct_role_and_secret",
  });
}

export function assessTenantDatabaseRoleSecurity(
  boundary: TenantDatabaseRoleBoundary,
  evidence: DatabaseRoleEvidence,
): DatabaseRoleSecurityAssessment {
  const blockers: string[] = [];
  const sessionRoleFingerprint = sha256Fingerprint(evidence.sessionRole);
  const currentRoleFingerprint = sha256Fingerprint(evidence.currentRole);
  const sessionRoleMatchesCurrentRole =
    evidence.sessionRole === evidence.currentRole;

  if (sessionRoleFingerprint !== boundary.tenantRoleFingerprint) {
    blockers.push("session_role_does_not_match_tenant_credential");
  }
  if (currentRoleFingerprint !== boundary.tenantRoleFingerprint) {
    blockers.push("current_role_does_not_match_tenant_credential");
  }
  if (!sessionRoleMatchesCurrentRole) {
    blockers.push("session_role_and_current_role_differ");
  }
  if (!evidence.roleCanLogin) blockers.push("role_cannot_login");
  if (evidence.roleIsSuperuser) blockers.push("role_is_superuser");
  if (evidence.roleBypassesRls) blockers.push("role_bypasses_rls");
  if (evidence.roleCanCreateDatabase) blockers.push("role_can_create_database");
  if (evidence.roleCanCreateRole) blockers.push("role_can_create_role");
  if (evidence.roleCanReplicate) blockers.push("role_can_replicate");
  if (evidence.roleOwnsPublicTableCount > 0) {
    blockers.push("role_owns_public_tables");
  }
  if (evidence.privilegedMembershipCount > 0) {
    blockers.push("role_inherits_privileged_membership");
  }
  if (evidence.canCreateInPublicSchema) {
    blockers.push("role_can_create_in_public_schema");
  }

  return Object.freeze({
    policyId: boundary.policyId,
    status: blockers.length === 0 ? "role_boundary_passed" : "blocked",
    roleFingerprint: currentRoleFingerprint,
    sessionRoleMatchesCurrentRole,
    roleCanLogin: evidence.roleCanLogin,
    roleIsSuperuser: evidence.roleIsSuperuser,
    roleBypassesRls: evidence.roleBypassesRls,
    roleCanCreateDatabase: evidence.roleCanCreateDatabase,
    roleCanCreateRole: evidence.roleCanCreateRole,
    roleCanReplicate: evidence.roleCanReplicate,
    roleOwnsPublicTableCount: evidence.roleOwnsPublicTableCount,
    privilegedMembershipCount: evidence.privilegedMembershipCount,
    canCreateInPublicSchema: evidence.canCreateInPublicSchema,
    publicTableCount: evidence.publicTableCount,
    rlsEnabledPublicTableCount: evidence.rlsEnabledPublicTableCount,
    rlsForcedPublicTableCount: evidence.rlsForcedPublicTableCount,
    blockers: Object.freeze([...blockers]),
    rlsPolicyStatus: "separate_gate_not_evaluated",
  });
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for the tenant database role boundary.`);
  }
  return normalized;
}
