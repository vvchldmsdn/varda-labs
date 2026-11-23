import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { readPreviewReleaseCatalog, assertPreviewReleaseCatalog, readPreviewProtectedContent, assertPreviewProtectedContentPreserved, PREVIEW_PROTECTED_TABLES } from '../scripts/lib/preview-release-catalog.mjs';

const expected = JSON.parse(readFileSync(new URL('../scripts/fixtures/preview-release-catalog.json', import.meta.url), 'utf8'));
test('Preview current catalog attests actual activity, contribution, performance and reviewed-history SQL', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role varda_tenant_app; create table app_users(id uuid primary key); create table accounts(id uuid primary key,canonical_owner_user_id uuid,is_active boolean); create function investment_plan_tenant_active() returns boolean language sql as 'select false';`);
    await db.exec('create table daily_portfolio_snapshots(id uuid primary key); alter table accounts add unique(id,canonical_owner_user_id)');
    for (const tag of ['0047_member_activity','0064_contribution_effects','0065_snapshot_closing_performance','0066_account_history_reviews']) await db.exec(readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint',''));
    const read = () => readPreviewReleaseCatalog(async q => (await db.query(q)).rows);
    assertPreviewReleaseCatalog(await read(), expected);
    for (const sql of [
      'alter table member_activity_daily no force row level security',
      'alter table member_activity_profiles alter column display_name type varchar(200)',
      'grant select on member_activity_profiles to varda_tenant_app',
      'alter table contribution_effects disable trigger contribution_effects_preserve_basis',
      'drop policy contribution_effects_tenant_v1 on contribution_effects',
      'alter table contribution_effects alter column document drop not null',
      'alter table contribution_effects drop constraint contribution_effects_revision_check',
      'drop index contribution_effects_owner_account_idx',
      'alter table daily_portfolio_snapshots drop column closing_performance',
      'alter table daily_portfolio_snapshots alter column closing_performance set not null',
      "alter table daily_portfolio_snapshots alter column closing_performance set default '{}'::jsonb",
      'alter table daily_portfolio_snapshots alter column closing_performance type json using closing_performance::json',
      'alter table account_history_reviews disable row level security',
      'alter policy account_history_reviews_owner on account_history_reviews using (true)',
      'grant select(evidence) on account_history_reviews to varda_tenant_app',
      'grant select(points) on account_history_reviews to public',
      'revoke select(points) on account_history_reviews from varda_tenant_app',
      'grant update on account_history_reviews to varda_tenant_app',
      'alter table account_history_reviews disable trigger account_history_reviews_immutable',
      'drop index account_history_reviews_latest',
    ]) {
      await db.exec('begin');
      try {
        await db.exec(sql);
        const changed = await read();
        assert.throws(() => assertPreviewReleaseCatalog(changed, expected), /schema evidence differs/);
      } finally { await db.exec('rollback'); }
    }
  } finally { await db.close(); }
});

test('Preview preservation detects edited content even when every row count is unchanged', async () => {
  const db = new PGlite();
  try {
    for (const table of PREVIEW_PROTECTED_TABLES) await db.exec(`create table ${table}(id integer primary key, quantity numeric); insert into ${table} values(1,1.234567);`);
    const read = () => readPreviewProtectedContent(async q => (await db.query(q)).rows);
    const before = await read();
    assertPreviewProtectedContentPreserved(before, await read());
    await db.exec('update event_ledger_entries set quantity=9 where id=1');
    const after = await read();
    assert.deepEqual(before.map(r => r.row_count), after.map(r => r.row_count));
    assert.throws(() => assertPreviewProtectedContentPreserved(before, after), /changed protected row content/);
    assert.throws(() => assertPreviewProtectedContentPreserved([], []), /incomplete/);
  } finally { await db.close(); }
});
