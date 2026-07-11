import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  EXPANDED_TENANT_TABLE_POLICIES,
  TRANSITIONAL_OWNER_COLUMN,
  USER_OWNED_TABLE_NAMES,
} from "./lib/tenant-ownership-policy.mjs";
import { classifyTenantExpandPhase } from "./lib/tenant-expand-phase.mjs";

config({ path: ".env.local", quiet: true });

if (process.argv.length > 2) {
  throw new Error("This audit accepts no arguments and never writes");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const expectedPublicTables = EXPANDED_TENANT_TABLE_POLICIES.map(
  ({ table }) => table,
).sort();
const expectedOwnerTables = [...USER_OWNED_TABLE_NAMES].sort();
const expectedOwnerIndexes = expectedOwnerTables
  .map((table) => `${table}_${TRANSITIONAL_OWNER_COLUMN}_idx`)
  .sort();
const expectedIdentityConstraints = [
  "app_users_pkey",
  "app_users_role_check",
  "app_users_status_check",
  "auth_identities_app_user_id_app_users_id_fk",
  "auth_identities_disabled_state_check",
  "auth_identities_pkey",
  "auth_identities_provider_check",
  "auth_identities_provider_subject_check",
  "auth_identities_status_check",
].sort();

const sql = neon(process.env.DATABASE_URL);

const publicTables = await sql.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
  order by table_name
`);
assert.deepEqual(
  publicTables.map(({ table_name }) => table_name),
  expectedPublicTables,
  "Phase 1C must leave exactly 24 classified public tables",
);

const ownerColumns = await sql.query(`
  select table_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public'
    and column_name = 'canonical_owner_user_id'
  order by table_name
`);
assert.deepEqual(
  ownerColumns.map(({ table_name }) => table_name),
  expectedOwnerTables,
  "canonical owner column table set changed",
);
for (const column of ownerColumns) {
  assert.equal(column.data_type, "uuid", `${column.table_name} owner type`);
  assert.equal(column.is_nullable, "YES", `${column.table_name} owner nullability`);
  assert.equal(column.column_default, null, `${column.table_name} owner default`);
}

const ownerIndexes = await sql.query(`
  select tablename, indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname like '%_canonical_owner_user_id_idx'
  order by indexname
`);
assert.deepEqual(
  ownerIndexes.map(({ indexname }) => indexname),
  expectedOwnerIndexes,
  "canonical owner index set changed",
);
for (const ownerIndex of ownerIndexes) {
  assert.ok(
    expectedOwnerTables.includes(ownerIndex.tablename),
    `${ownerIndex.indexname} is on an unexpected table`,
  );
  assert.match(ownerIndex.indexdef, /\(canonical_owner_user_id\)$/);
}

const [identityRows] = await sql.query(`
  select
    (select count(*)::int from app_users) as app_users,
    (
      select count(*)::int from app_users where status = 'provisioning'
    ) as provisioning_users,
    (
      select count(*)::int from app_users where status = 'active'
    ) as active_users,
    (
      select count(*)::int from app_users where status = 'disabled'
    ) as disabled_users,
    (
      select count(*)::int from app_users where role = 'user'
    ) as user_role_users,
    (
      select count(*)::int from app_users where role = 'admin'
    ) as admin_users,
    (select count(*)::int from auth_identities) as auth_identities
`);

const ownerStats = await sql.query(
  expectedOwnerTables
    .map(
      (table) => `
        select
          '${table}'::text as table_name,
          count(*)::int as row_count,
          count(*) filter (
            where "canonical_owner_user_id" is not null
          )::int as non_null_owner_rows
        from "${table}"
      `,
    )
    .join(" union all "),
);
for (const ownerStat of ownerStats) {
  assert.equal(
    Number(ownerStat.non_null_owner_rows),
    0,
    `${ownerStat.table_name} was unexpectedly backfilled`,
  );
}

const canonicalOwnerNonNullRows = ownerStats.reduce(
  (sum, row) => sum + Number(row.non_null_owner_rows),
  0,
);
const tenantPhase = classifyTenantExpandPhase({
  appUsers: identityRows.app_users,
  provisioningUsers: identityRows.provisioning_users,
  activeUsers: identityRows.active_users,
  disabledUsers: identityRows.disabled_users,
  userRoleUsers: identityRows.user_role_users,
  adminUsers: identityRows.admin_users,
  authIdentities: identityRows.auth_identities,
  canonicalOwnerNonNullRows,
});

const identityConstraints = await sql.query(`
  select c.conname, c.contype, c.confdeltype
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname in ('app_users', 'auth_identities')
  order by c.conname
`);
assert.deepEqual(
  identityConstraints.map(({ conname }) => conname),
  expectedIdentityConstraints,
  "identity constraint set changed",
);
const identityFk = identityConstraints.find(
  ({ conname }) =>
    conname === "auth_identities_app_user_id_app_users_id_fk",
);
assert.equal(identityFk?.contype, "f");
assert.equal(identityFk?.confdeltype, "r");

const financialOwnerConstraints = await sql.query(`
  select c.conname
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname not in ('app_users', 'auth_identities')
    and pg_get_constraintdef(c.oid) ilike '%canonical_owner_user_id%'
  order by c.conname
`);
assert.deepEqual(
  financialOwnerConstraints,
  [],
  "Phase 1C must not add financial owner constraints",
);

console.log(
  JSON.stringify(
    {
      audit: "tenant_expand_phase_aware",
      tenantPhase,
      readOnly: true,
      databaseSideEffects: false,
      selectCount: 7,
      publicTableCount: publicTables.length,
      identityTableRows: {
        appUsers: Number(identityRows.app_users),
        authIdentities: Number(identityRows.auth_identities),
      },
      appUserState: {
        provisioning: Number(identityRows.provisioning_users),
        active: Number(identityRows.active_users),
        disabled: Number(identityRows.disabled_users),
        userRole: Number(identityRows.user_role_users),
        adminRole: Number(identityRows.admin_users),
      },
      canonicalOwnerColumns: ownerColumns.length,
      canonicalOwnerIndexes: ownerIndexes.length,
      canonicalOwnerNonNullRows,
      userOwnedRows: ownerStats.reduce(
        (sum, row) => sum + Number(row.row_count),
        0,
      ),
      identityConstraintCount: identityConstraints.length,
      financialOwnerConstraintCount: financialOwnerConstraints.length,
    },
    null,
    2,
  ),
);
