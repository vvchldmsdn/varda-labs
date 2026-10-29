import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// These two release boundaries supplement the existing 0000-0026 catalog gate.
// Never infer schema equivalence from a migration hash exception alone.
const TABLES = "'member_activity_daily','member_activity_profiles','contribution_effects'";
export async function readPreviewReleaseCatalog(query) {
  const statements = {
    tables: `select relname as name, relrowsecurity as rls, relforcerowsecurity as forced from pg_class where relnamespace='public'::regnamespace and relname in (${TABLES}) order by relname`,
    columns: `select table_name, column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, datetime_precision, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in (${TABLES}) order by table_name, ordinal_position`,
    // PostgreSQL 18 catalogs NOT NULL separately; columns.is_nullable already
    // verifies it on both PostgreSQL 17 (Neon) and 18 (local PGlite).
    constraints: `select c.relname as table_name, k.conname as name, k.contype as type, k.convalidated as validated, pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid where k.contype <> 'n' and c.relnamespace='public'::regnamespace and c.relname in (${TABLES}) order by c.relname,k.conname`,
    indexes: `select tablename as table_name,indexname as name,indexdef as definition from pg_indexes where schemaname='public' and tablename in (${TABLES}) order by tablename,indexname`,
    policies: `select tablename as table_name,policyname as name,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in (${TABLES}) order by tablename,policyname`,
    triggers: `select c.relname as table_name,t.tgname as name,t.tgenabled as enabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname in (${TABLES}) order by c.relname,t.tgname`,
    functions: `select p.proname as name,p.prosecdef as security_definer,p.proconfig as config,pg_get_functiondef(p.oid) as definition from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='contribution_effects_preserve_basis' order by p.proname`,
    grants: `select c.relname as table_name,case when a.grantee=0 then 'PUBLIC' else r.rolname end as grantee,a.privilege_type,a.is_grantable from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a left join pg_roles r on r.oid=a.grantee where c.relnamespace='public'::regnamespace and c.relname in (${TABLES}) and (a.grantee=0 or r.rolname='varda_tenant_app') order by c.relname,grantee,a.privilege_type`,
  };
  return Object.fromEntries(await Promise.all(Object.entries(statements).map(async ([key, sql]) => [key, await query(sql)])));
}

export function assertPreviewReleaseCatalog(actual, expected) {
  for (const key of Object.keys(expected)) {
    // Avoid assertion diffs containing database definitions in deployment logs.
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) {
      throw new Error(`Preview 0047/0064 schema evidence differs: ${key}.`);
    }
  }
  assert.equal(Object.keys(actual).length, Object.keys(expected).length, 'Unexpected Preview schema evidence');
}

// Content hashes detect changes that row counts alone cannot detect. Only hashes
// leave the database; financial records and member identities are never logged.
export const PREVIEW_PROTECTED_TABLES = Object.freeze([
  'accounts', 'assets', 'event_ledger_entries', 'holding_onboarding_evidence',
  'holding_state_corrections', 'holding_lifecycle_events', 'daily_portfolio_snapshots',
  'daily_position_snapshots', 'native_contribution_plans', 'contribution_effects',
  'member_activity_daily', 'member_activity_profiles',
]);
export async function readPreviewProtectedContent(query) {
  const rows = await query(PREVIEW_PROTECTED_TABLES.map(name =>
    `select '${name}' as table_name, count(*)::text as row_count, md5(coalesce(string_agg(row_hash, '' order by row_hash),'')) as content_hash from (select md5(to_jsonb(t)::text) as row_hash from public.${name} t) protected_rows`
  ).join(' union all ') + ' order by table_name');
  return rows;
}
export function assertPreviewProtectedContentPreserved(before, after) {
  assert.equal(before.length, PREVIEW_PROTECTED_TABLES.length, 'Preview preservation evidence is incomplete');
  assert.equal(after.length, PREVIEW_PROTECTED_TABLES.length, 'Preview preservation evidence is incomplete');
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Preview migration changed protected row content');
}
export function previewContentDigest(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
