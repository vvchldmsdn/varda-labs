import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

import { sha256Fingerprint } from "../../src/lib/deployment/preview-database-target.ts";
import { TENANT_DATABASE_ROLE_NAME } from "../../src/lib/deployment/tenant-security-constants.ts";

export { TENANT_DATABASE_ROLE_NAME };
export const TENANT_DATABASE_ROLE_WRITE_CONFIRMATION =
  "CREATE_RESTRICTED_TENANT_ROLE";
export const TENANT_DATABASE_ROLE_ADVISORY_LOCK =
  "varda:tenant-database-role:v1";

const GENERATED_PASSWORD_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class TenantRoleProvisioningError extends Error {
  constructor(code) {
    super("Tenant database role provisioning is blocked");
    this.name = "TenantRoleProvisioningError";
    this.code = code;
  }
}

export function parseTenantRoleProvisioningArgs(argv) {
  let write = false;
  let confirmation = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write" && !write) {
      write = true;
      continue;
    }
    if (arg === "--confirm" && confirmation === null) {
      confirmation = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new TenantRoleProvisioningError(
      "unsupported_or_duplicate_argument",
    );
  }

  if (write && confirmation !== TENANT_DATABASE_ROLE_WRITE_CONFIRMATION) {
    throw new TenantRoleProvisioningError("missing_write_confirmation");
  }
  if (!write && confirmation !== null) {
    throw new TenantRoleProvisioningError("confirmation_without_write");
  }

  return Object.freeze({ write });
}

export function buildTenantRoleProvisioningPlan({
  roleState,
  tenantCredentialConfigured,
}) {
  const blockers = [];

  if (roleState.exists) {
    if (!roleState.roleCanLogin) blockers.push("role_cannot_login");
    if (roleState.roleIsSuperuser) blockers.push("role_is_superuser");
    if (roleState.roleBypassesRls) blockers.push("role_bypasses_rls");
    if (roleState.roleCanCreateDatabase) {
      blockers.push("role_can_create_database");
    }
    if (roleState.roleCanCreateRole) blockers.push("role_can_create_role");
    if (roleState.roleCanReplicate) blockers.push("role_can_replicate");
    if (roleState.roleInheritsPrivileges) {
      blockers.push("role_inherits_privileges");
    }
    if (roleState.roleOwnsPublicTableCount > 0) {
      blockers.push("role_owns_public_tables");
    }
    if (roleState.roleMembershipCount > 0) {
      blockers.push("role_has_memberships");
    }
    if (roleState.privilegedMembershipCount > 0) {
      blockers.push("role_inherits_privileged_membership");
    }
    if (!roleState.canConnectToDatabase) {
      blockers.push("role_cannot_connect_to_database");
    }
    if (!roleState.canUsePublicSchema) {
      blockers.push("role_cannot_use_public_schema");
    }
    if (roleState.canCreateInPublicSchema) {
      blockers.push("role_can_create_in_public_schema");
    }
    if (!tenantCredentialConfigured) {
      blockers.push("existing_role_credential_unavailable");
    }
  }

  const result =
    blockers.length > 0
      ? "blocked"
      : roleState.exists
        ? "already_provisioned"
        : "planned_create";

  return Object.freeze({
    operation: "tenant_database_role_provisioning",
    mode: "dry_run",
    result,
    roleFingerprint: sha256Fingerprint(TENANT_DATABASE_ROLE_NAME),
    tenantCredentialConfigured,
    plannedWrites: Object.freeze({
      databaseRoles: result === "planned_create" ? 1 : 0,
      tablePrivileges: 0,
      rlsPolicies: 0,
      applicationRows: 0,
    }),
    blockers: Object.freeze(blockers),
    committed: false,
    databaseSideEffects: false,
  });
}

export function generateTenantDatabasePassword(random = randomBytes) {
  const password = random(32).toString("base64url");
  if (!GENERATED_PASSWORD_PATTERN.test(password)) {
    throw new TenantRoleProvisioningError("generated_password_invalid");
  }
  return password;
}

export function buildTenantDatabaseUrl(privilegedUrl, password) {
  assertGeneratedPassword(password);
  const parsed = new URL(privilegedUrl);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new TenantRoleProvisioningError("database_url_protocol_invalid");
  }
  parsed.username = TENANT_DATABASE_ROLE_NAME;
  parsed.password = password;
  return parsed.toString();
}

export function readTenantPasswordFromUrl(tenantUrl) {
  const parsed = new URL(tenantUrl);
  if (parsed.username !== TENANT_DATABASE_ROLE_NAME) {
    throw new TenantRoleProvisioningError("tenant_role_name_mismatch");
  }
  assertGeneratedPassword(parsed.password);
  return parsed.password;
}

export function buildTenantRoleWriteStatements({ databaseName, password }) {
  assertGeneratedPassword(password);
  const role = quoteIdentifier(TENANT_DATABASE_ROLE_NAME);
  const database = quoteIdentifier(databaseName);
  const secret = quoteLiteral(password);

  return Object.freeze([
    `create role ${role} with login password ${secret} nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`,
    `grant connect on database ${database} to ${role}`,
    `grant usage on schema public to ${role}`,
    `revoke create on schema public from ${role}`,
  ]);
}

export function ensureTenantUrlInEnvLocal(
  filePath,
  tenantUrl,
  {
    readFile = readFileSync,
    appendFile = appendFileSync,
    parseEnvironment = parse,
  } = {},
) {
  const content = readFile(filePath, "utf8");
  const parsed = parseEnvironment(content);
  const existing = readOwnDataValue(parsed, "TENANT_DATABASE_URL");

  if (typeof existing === "string") {
    if (existing !== tenantUrl) {
      throw new TenantRoleProvisioningError(
        "tenant_database_url_already_differs",
      );
    }
    return Object.freeze({ updated: false });
  }

  const prefix = content.length === 0 || content.endsWith("\n") ? "" : "\n";
  appendFile(filePath, `${prefix}TENANT_DATABASE_URL=${tenantUrl}\n`, {
    encoding: "utf8",
  });
  return Object.freeze({ updated: true });
}

export function sanitizedProvisioningFailure(
  code,
  {
    localEnvironmentUpdated,
    databaseWriteAttempted,
    databaseWriteCompleted,
  },
) {
  return Object.freeze({
    operation: "tenant_database_role_provisioning",
    mode: "write",
    result: "blocked",
    roleFingerprint: sha256Fingerprint(TENANT_DATABASE_ROLE_NAME),
    localEnvironmentUpdated,
    blockers: Object.freeze([code]),
    committed: databaseWriteCompleted,
    databaseSideEffects: databaseWriteCompleted
      ? true
      : databaseWriteAttempted
        ? "unknown"
        : false,
    requiresReadOnlyReconciliation:
      databaseWriteAttempted && !databaseWriteCompleted,
  });
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertGeneratedPassword(password) {
  if (!GENERATED_PASSWORD_PATTERN.test(password)) {
    throw new TenantRoleProvisioningError("tenant_password_invalid");
  }
}

function readOwnDataValue(value, key) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
