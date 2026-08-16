export async function readCurrentDatabaseRoleEvidence(sql) {
  const [row] = await sql.query(CURRENT_ROLE_EVIDENCE_SQL);
  if (!row) throw new Error("Current database role evidence was not returned");
  return normalizeCurrentRoleEvidence(row);
}

export async function readNamedDatabaseRoleState(sql, roleName) {
  const [row] = await sql.query(NAMED_ROLE_STATE_SQL, [roleName]);
  if (!row) {
    return Object.freeze({
      exists: false,
      roleName,
    });
  }

  return Object.freeze({
    exists: true,
    roleName: String(row.role_name),
    roleCanLogin: row.role_can_login === true,
    roleIsSuperuser: row.role_is_superuser === true,
    roleBypassesRls: row.role_bypasses_rls === true,
    roleCanCreateDatabase: row.role_can_create_database === true,
    roleCanCreateRole: row.role_can_create_role === true,
    roleCanReplicate: row.role_can_replicate === true,
    roleInheritsPrivileges: row.role_inherits_privileges === true,
    roleOwnsPublicTableCount: Number(row.role_owns_public_table_count),
    roleMembershipCount: Number(row.role_membership_count),
    privilegedMembershipCount: Number(row.privileged_membership_count),
    canConnectToDatabase: row.can_connect_to_database === true,
    canUsePublicSchema: row.can_use_public_schema === true,
    canCreateInPublicSchema: row.can_create_in_public_schema === true,
  });
}

export function sanitizeCurrentDatabaseRoleEvidence(evidence, fingerprint) {
  return Object.freeze({
    roleFingerprint: fingerprint(evidence.currentRole),
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

function normalizeCurrentRoleEvidence(row) {
  return Object.freeze({
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
  });
}

const CURRENT_ROLE_EVIDENCE_SQL = `
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
`;

const NAMED_ROLE_STATE_SQL = `
  with recursive inherited_roles(role_oid) as (
    select membership.roleid
    from pg_auth_members membership
    join pg_roles member_role on member_role.oid = membership.member
    where member_role.rolname = $1

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
    role.rolname as role_name,
    role.rolcanlogin as role_can_login,
    role.rolsuper as role_is_superuser,
    role.rolbypassrls as role_bypasses_rls,
    role.rolcreatedb as role_can_create_database,
    role.rolcreaterole as role_can_create_role,
    role.rolreplication as role_can_replicate,
    role.rolinherit as role_inherits_privileges,
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
      from inherited_roles
    ) as role_membership_count,
    (
      select count(*)::int
      from inherited_roles inherited
      join pg_roles inherited_role on inherited_role.oid = inherited.role_oid
      where inherited_role.rolsuper
        or inherited_role.rolbypassrls
        or inherited.role_oid in (select role_oid from public_table_owners)
    ) as privileged_membership_count,
    has_database_privilege(role.rolname, current_database(), 'CONNECT')
      as can_connect_to_database,
    has_schema_privilege(role.rolname, 'public', 'USAGE')
      as can_use_public_schema,
    has_schema_privilege(role.rolname, 'public', 'CREATE')
      as can_create_in_public_schema
  from pg_roles role
  where role.rolname = $1
`;
