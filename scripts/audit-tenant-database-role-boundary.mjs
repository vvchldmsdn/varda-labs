import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  assessTenantDatabaseRoleSecurity,
  guardTenantDatabaseRoleBoundary,
} from "../src/lib/deployment/tenant-database-role-boundary.ts";
import { sha256Fingerprint } from "../src/lib/deployment/preview-database-target.ts";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";

config({ path: ".env.local", quiet: true });

if (process.argv.length > 2) {
  throw new Error("This audit accepts no arguments and never writes");
}

const privilegedUrl = process.env.DATABASE_URL?.trim();
if (!privilegedUrl) throw new Error("DATABASE_URL is not set");
const productionTarget = guardProductionDatabaseTarget(process.env);

const tenantUrl = process.env.TENANT_DATABASE_URL?.trim();
if (!tenantUrl) {
  const evidence = await readDatabaseRoleEvidence(privilegedUrl);
  console.log(
    JSON.stringify(
      {
        audit: "tenant_database_role_boundary",
        readOnly: true,
        databaseSideEffects: false,
        selectCount: 1,
        status: "blocked",
        targetFingerprint: productionTarget.targetFingerprint,
        boundaryStatus: "tenant_database_url_missing",
        blockers: ["tenant_database_url_missing"],
        currentConnection: sanitizeEvidence(evidence),
        nextRequiredEnvironmentKey: "TENANT_DATABASE_URL",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  const boundary = guardTenantDatabaseRoleBoundary(process.env);
  const evidence = await readDatabaseRoleEvidence(tenantUrl);
  const assessment = assessTenantDatabaseRoleSecurity(boundary, evidence);

  console.log(
    JSON.stringify(
      {
        audit: "tenant_database_role_boundary",
        readOnly: true,
        databaseSideEffects: false,
        selectCount: 1,
        targetFingerprint: productionTarget.targetFingerprint,
        credentialBoundary: boundary,
        roleSecurity: assessment,
      },
      null,
      2,
    ),
  );
  if (assessment.status !== "role_boundary_passed") process.exitCode = 1;
}

async function readDatabaseRoleEvidence(databaseUrl) {
  const sql = neon(databaseUrl);
  const [row] = await sql.query(`
    with recursive inherited_roles(role_oid) as (
      select membership.roleid
      from pg_auth_members membership
      join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname = current_user

      union

      select membership.roleid
      from pg_auth_members membership
      join inherited_roles inherited on inherited.role_oid = membership.member
    ),
    public_table_owners as (
      select distinct relation.relowner as role_oid
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind in ('r', 'p')
    )
    select
      session_user::text as session_role,
      current_user::text as current_role,
      role.rolcanlogin as role_can_login,
      role.rolsuper as role_is_superuser,
      role.rolbypassrls as role_bypasses_rls,
      role.rolcreatedb as role_can_create_database,
      role.rolcreaterole as role_can_create_role,
      role.rolreplication as role_can_replicate,
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relowner = role.oid
      ) as role_owns_public_table_count,
      (
        select count(*)::int
        from inherited_roles inherited
        join pg_roles inherited_role on inherited_role.oid = inherited.role_oid
        where inherited_role.rolsuper
          or inherited_role.rolbypassrls
          or inherited.role_oid in (select role_oid from public_table_owners)
      ) as privileged_membership_count,
      has_schema_privilege(current_user, 'public', 'CREATE')
        as can_create_in_public_schema,
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
      ) as public_table_count,
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relrowsecurity
      ) as rls_enabled_public_table_count,
      (
        select count(*)::int
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind in ('r', 'p')
          and relation.relforcerowsecurity
      ) as rls_forced_public_table_count
    from pg_roles role
    where role.rolname = current_user
  `);

  if (!row) throw new Error("Current database role evidence was not returned");
  return {
    sessionRole: String(row.session_role),
    currentRole: String(row.current_role),
    roleCanLogin: row.role_can_login === true,
    roleIsSuperuser: row.role_is_superuser === true,
    roleBypassesRls: row.role_bypasses_rls === true,
    roleCanCreateDatabase: row.role_can_create_database === true,
    roleCanCreateRole: row.role_can_create_role === true,
    roleCanReplicate: row.role_can_replicate === true,
    roleOwnsPublicTableCount: Number(row.role_owns_public_table_count),
    privilegedMembershipCount: Number(row.privileged_membership_count),
    canCreateInPublicSchema: row.can_create_in_public_schema === true,
    publicTableCount: Number(row.public_table_count),
    rlsEnabledPublicTableCount: Number(row.rls_enabled_public_table_count),
    rlsForcedPublicTableCount: Number(row.rls_forced_public_table_count),
  };
}

function sanitizeEvidence(evidence) {
  return Object.freeze({
    roleFingerprint: sha256Fingerprint(evidence.currentRole),
    sessionRoleMatchesCurrentRole:
      evidence.sessionRole === evidence.currentRole,
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
  });
}
