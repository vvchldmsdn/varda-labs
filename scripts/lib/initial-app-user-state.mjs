import {
  evaluateSchemaManifest,
  readWriterReadiness,
} from "./initial-app-user-readiness.mjs";
import { USER_OWNED_TABLE_NAMES } from "./tenant-ownership-policy.mjs";

export async function readInitialProvisioningState(sql, root = process.cwd()) {
  const canonicalStatsSql = USER_OWNED_TABLE_NAMES.map(
    (table) => `
      select count(*) filter (
        where canonical_owner_user_id is not null
      )::int as non_null_rows
      from "${table}"
    `,
  ).join(" union all ");

  const [
    appUsers,
    authIdentityRows,
    canonicalStats,
    identityColumns,
    identityConstraints,
    identityIndexes,
    canonicalColumns,
    canonicalIndexes,
  ] = await Promise.all([
    sql.query(`
      select id::text, status, role
      from app_users
      order by created_at, id
    `),
    sql.query(`select count(*)::int as rows from auth_identities`),
    sql.query(canonicalStatsSql),
    sql.query(`
      select
        table_name,
        column_name,
        udt_name,
        is_nullable,
        character_maximum_length,
        column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('app_users', 'auth_identities')
      order by table_name, ordinal_position
    `),
    sql.query(`
      select
        c.conname,
        c.contype,
        c.confdeltype,
        pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      join pg_class r on r.oid = c.conrelid
      join pg_namespace n on n.oid = r.relnamespace
      where n.nspname = 'public'
        and r.relname in ('app_users', 'auth_identities')
      order by c.conname
    `),
    sql.query(`
      select indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and tablename in ('app_users', 'auth_identities')
      order by indexname
    `),
    sql.query(`
      select table_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'canonical_owner_user_id'
      order by table_name
    `),
    sql.query(`
      select tablename, indexname, indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname like '%_canonical_owner_user_id_idx'
      order by indexname
    `),
  ]);

  const schemaManifest = evaluateSchemaManifest({
    identityColumns,
    identityConstraints,
    identityIndexes,
    canonicalColumns,
    canonicalIndexes,
  });

  return Object.freeze({
    appUsers: Object.freeze(
      appUsers.map(({ id, status, role }) =>
        Object.freeze({ id, status, role }),
      ),
    ),
    authIdentityCount: Number(authIdentityRows[0]?.rows ?? 0),
    canonicalOwnerNonNullRows: canonicalStats.reduce(
      (sum, row) => sum + Number(row.non_null_rows),
      0,
    ),
    schemaContractValid: Object.values(schemaManifest).every(Boolean),
    schemaManifest: Object.freeze(schemaManifest),
    writerReadiness: Object.freeze(readWriterReadiness(root)),
  });
}
