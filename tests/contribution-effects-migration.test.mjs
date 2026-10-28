import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrateContributionEffects } from '../scripts/migrate-contribution-effects.mjs';
import { getVercelBuildSteps } from '../scripts/vercel-build.mjs';

test('remote migration is opt-in, additive, atomic and safe to retry', async () => {
  assert.deepEqual(getVercelBuildSteps('production'), ['build']);
  assert.deepEqual(getVercelBuildSteps('production', { CAIRN_CONTRIBUTION_EFFECTS_MIGRATE: '1' }), ['build', 'db:release:contribution-effects']);
  const db = new PGlite();
  const client = { query: async (sql, params) => !params && sql.includes(';') ? (await db.exec(sql)).at(-1) : db.query(sql, params) };
  try {
    await db.exec(`create role varda_tenant_app;create table app_users(id uuid primary key);create table accounts(id uuid primary key,canonical_owner_user_id uuid,is_active boolean);create function investment_plan_tenant_active() returns boolean language sql as 'select true';create schema drizzle;create table drizzle.__drizzle_migrations(id serial,hash text,created_at bigint);insert into drizzle.__drizzle_migrations(hash,created_at) values('prior',0);`);
    await assert.rejects(migrateContributionEffects(client), /frontier/);
    assert.equal((await db.query("select to_regclass('public.contribution_effects') as name")).rows[0].name, null);
    await db.exec('update drizzle.__drizzle_migrations set created_at=1790899200000');
    assert.equal((await migrateContributionEffects(client)).verified, true);
    assert.equal((await migrateContributionEffects(client)).verified, true);
    assert.equal((await db.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows[0].n, 2);
    await db.exec('alter table contribution_effects disable row level security');
    await assert.rejects(migrateContributionEffects(client), /verification/);
  } finally { await db.close(); }
});
