import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { guardProductionDatabaseTarget } from '../src/lib/deployment/production-database-target.ts';

/** Narrow additive migration, run inside Vercel only. Credentials never leave the remote build. */
export async function migrateContributionEffects(client) {
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')).entries;
  const entry = journal.find(row => row.tag === '0064_contribution_effects');
  const previous = journal.find(row => row.idx === entry.idx - 1);
  const sql = readFileSync(new URL('../drizzle/0064_contribution_effects.sql', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  await client.query('begin');
  try {
    await client.query("set local lock_timeout='5s';set local statement_timeout='30s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended('cairn.release.contribution-effects.v1',0))");
    const latest = (await client.query('select hash,created_at from drizzle.__drizzle_migrations order by created_at desc limit 1')).rows[0];
    if (Number(latest?.created_at) === entry.when && latest.hash === hash) {
      // An identical retry is safe; verify the applied security boundary below.
    } else {
      if (Number(latest?.created_at) !== previous.when) throw new Error('migration_frontier_mismatch');
      if ((await client.query("select to_regclass('public.contribution_effects') as table_name")).rows[0].table_name) throw new Error('untracked_table_exists');
      await client.query(sql);
      await client.query('insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)', [hash, entry.when]);
    }
    const verified = (await client.query(`select c.relrowsecurity and c.relforcerowsecurity
      and exists(select 1 from pg_policies where schemaname='public' and tablename='contribution_effects' and policyname='contribution_effects_tenant_v1')
      and exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='contribution_effects_preserve_basis' and t.tgenabled='O') as ok
      from pg_class c where c.oid='public.contribution_effects'::regclass`)).rows[0]?.ok;
    if (!verified) throw new Error('migration_verification_failed');
    await client.query('commit');
    return { migration: entry.tag, verified: true, existingFinancialRowsChanged: false };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let client;
  try {
    if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production' || process.env.CAIRN_CONTRIBUTION_EFFECTS_MIGRATE !== '1') throw new Error('release_build_required');
    guardProductionDatabaseTarget(process.env);
    client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED, connectionTimeoutMillis: 15000 });
    await client.connect();
    console.log(JSON.stringify(await migrateContributionEffects(client)));
  } catch (error) {
    // Driver errors can include connection details: never print the raw error or environment.
    const reasons = ['release_build_required', 'migration_frontier_mismatch', 'untracked_table_exists', 'migration_verification_failed'];
    const reason = reasons.includes(error?.message) ? error.message : 'target_or_connection_unavailable';
    console.error(`Contribution effects migration failed (${reason}); deployment was not activated.`);
    process.exitCode = 1;
  } finally { await client?.end(); }
}
