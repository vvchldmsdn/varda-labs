import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const RC_TAGS = [
  '0048_reporting_currency_inputs', '0049_twelve_data_collection', '0050_native_portfolio_ledger',
  '0051_market_provider_observations', '0052_native_legacy_lifecycle_guard', '0053_native_contribution_plans',
];

/** No URL, existing data directory, environment-file or remote-host option exists. */
export function parseOptions(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--validate-only')) return { execute: false };
  if (args.length !== 3 || args[0] !== '--execute-local' || args[1] !== '--pg-bin' || !path.isAbsolute(args[2])) {
    throw new Error('Use --validate-only or --execute-local --pg-bin <absolute PostgreSQL bin directory>');
  }
  return { execute: true, bin: args[2] };
}

/** Do not inherit DB credentials, provider secrets, PG service files or Node preload hooks. */
export function childEnvironment(environment) {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL']);
  return Object.fromEntries(Object.entries(environment).filter(([key]) => allowed.has(key.toUpperCase())));
}

export function within(parent, target) {
  const relative = path.relative(parent, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export async function migrationManifest(root = ROOT) {
  const journal = JSON.parse(await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
  assert.equal(journal.dialect, 'postgresql');
  assert.deepEqual(journal.entries.slice(48,54).map(entry => entry.tag), RC_TAGS, 'RC migration range changed; review this runner');
  assert.deepEqual(journal.entries.slice(54).map(entry => entry.tag), ['0054_simulation_executions','0055_simulation_execution_admission','0056_native_tenant_mutation'], 'Review any migration after execution admission');
  const seen = new Set();
  let previousTime = -1;
  return Promise.all(journal.entries.map(async (entry, position) => {
    assert.equal(entry.idx, position, 'migration index gap/reorder');
    assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
    assert.equal(Number(entry.tag.slice(0, 4)), position);
    assert.ok(entry.when > previousTime, 'migration timestamp must increase');
    previousTime = entry.when;
    assert.ok(!seen.has(entry.tag), 'duplicate migration tag'); seen.add(entry.tag);
    const sql = await readFile(path.join(root, 'drizzle', `${entry.tag}.sql`), 'utf8');
    assert.ok(sql.trim());
    return { tag: entry.tag, when: entry.when, sha256: createHash('sha256').update(sql).digest('hex'), sql };
  }));
}

export async function prerequisites(bin) {
  let pgDriver = false;
  try { import.meta.resolve('pg'); pgDriver = true; } catch { /* No installation is performed. */ }
  const binaries = {};
  for (const name of ['initdb', 'pg_ctl', 'postgres']) {
    const file = bin && path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
    try { if (file) await access(file); binaries[name] = Boolean(file); } catch { binaries[name] = false; }
  }
  return { pgDriver, binaries, available: pgDriver && Object.values(binaries).every(Boolean) };
}

function nativeCommand(file, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: environment, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data.toString(); });
    child.on('error', () => reject(new Error(`native_command_unavailable:${path.basename(file)}`)));
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`native_command_failed:${path.basename(file)}:${code}`)));
  });
}

async function localPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export function transactionSql(options = {}) {
  const isolation = { ReadCommitted: 'READ COMMITTED', RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE' };
  const level = isolation[options.isolationLevel ?? 'ReadCommitted'];
  if (!level) throw new Error('rehearsal_unknown_isolation');
  return `BEGIN ISOLATION LEVEL ${level}${options.readOnly ? ' READ ONLY' : ' READ WRITE'}`;
}

/** Match the application's Neon transaction surface; each transaction owns one TCP session. */
export function sqlTransport(pool, sessions) {
  return {
    async query(text, parameters = []) {
      const client = await pool.connect();
      try { sessions.add(client.processID); return (await client.query(text, parameters)).rows; }
      finally { client.release(); }
    },
    async transaction(build, options = {}) {
      const commands = build({ query: (text, parameters = []) => ({ text, parameters }) });
      const client = await pool.connect();
      try {
        sessions.add(client.processID);
        await client.query(transactionSql(options));
        const results = [];
        for (const command of commands) results.push((await client.query(command.text, command.parameters)).rows);
        await client.query('COMMIT');
        return results;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}

async function executeLocal(options, manifest) {
  const ready = await prerequisites(options.bin);
  if (!ready.available) return { status: 'NOT RUN', reason: 'local_postgresql_or_pg_driver_missing', prerequisites: ready };
  const bin = await realpath(options.bin);
  const workspace = await realpath(ROOT);
  const outputRoot = path.join(workspace, 'output', 'krw-usd-rc-rehearsal');
  await mkdir(outputRoot, { recursive: true });
  assert.ok(within(workspace, await realpath(outputRoot)), 'output directory must resolve inside this workspace');
  const runDirectory = await mkdtemp(path.join(outputRoot, 'local-'));
  assert.ok(within(await realpath(outputRoot), await realpath(runDirectory)));
  const dataDirectory = path.join(runDirectory, 'cluster');
  const passwordFile = path.join(runDirectory, 'bootstrap-password');
  const password = randomBytes(32).toString('hex');
  const port = await localPort();
  const environment = childEnvironment(process.env);
  const command = name => path.join(bin, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  const version = (await nativeCommand(command('postgres'), ['--version'], environment)).trim();
  assert.match(version, /PostgreSQL\) (1[6-9]|[2-9]\d)\./, 'Use PostgreSQL 16 or newer; record its exact version');
  const { Pool } = await import('pg');
  let startupAttempted = false, admin, worker, tenant;
  const report = { status: 'FAIL', version, migrations: manifest.map(({ sql: ignored, ...entry }) => { void ignored; return entry; }), cases: [] };
  try {
    await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' });
    await nativeCommand(command('initdb'), ['-D', dataDirectory, '--username=rc_admin', '--encoding=UTF8', '--auth=scram-sha-256', `--pwfile=${passwordFile}`], environment);
    await unlink(passwordFile);
    // A lost free-port race fails startup. It never falls back to an existing server.
    startupAttempted = true;
    await nativeCommand(command('pg_ctl'), ['-D', dataDirectory, '-l', path.join(runDirectory, 'postgres.log'), '-w', '-t', '30', 'start', '-o', `-h 127.0.0.1 -p ${port} -c unix_socket_directories="" -c timezone=UTC -c max_connections=24 -c shared_buffers=32MB -c log_min_error_statement=panic`], environment);
    const connection = { host: '127.0.0.1', port, database: 'postgres', password, ssl: false,
      connectionTimeoutMillis: 2000, statement_timeout: 15000, application_name: 'cairn-rc-local', options: '', max: 8 };
    admin = new Pool({ ...connection, user: 'rc_admin' });
    const identity = (await admin.query("select current_setting('data_directory') as directory,host(inet_server_addr()) as address,current_database() as database")).rows[0];
    assert.equal(await realpath(identity.directory), await realpath(dataDirectory));
    assert.equal(identity.address, '127.0.0.1'); assert.equal(identity.database, 'postgres');
    // Role provisioning is separate from the migration journal in this project.
    // These are new cluster-local roles, never an alteration of existing deployed roles.
    await admin.query(`CREATE ROLE varda_tenant_app LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT PASSWORD '${password}';
      CREATE ROLE rc_writer LOGIN NOSUPERUSER BYPASSRLS NOINHERIT PASSWORD '${password}';
      CREATE ROLE rc_table_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;`);
    const { seedLegacy, verifyLegacy, runCases } = await import('./krw-usd-rc-rehearsal-cases.mjs');
    await admin.query('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial primary key,hash text not null,created_at bigint);');
    async function applyBatch(entries) {
      const client = await admin.connect();
      const completed = [];
      try {
        await client.query("BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';");
        for (const entry of entries) {
          report.failedMigration = entry.tag;
          const begin = Date.now();
          for (const statement of entry.sql.split('--> statement-breakpoint').filter(value => value.trim())) await client.query(statement);
          await client.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)', [entry.sha256, entry.when]);
          completed.push({ name: `migration:${entry.tag}`, status: 'PASS', elapsedMs: Date.now() - begin });
        }
        await client.query('COMMIT');
        delete report.failedMigration;
        report.cases.push(...completed);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    // Match PgDialect.migrate's single transaction for all pending migrations.
    // The two phases model a deployment already at 0047, then the pending RC batch.
    await applyBatch(manifest.slice(0, 48));
    const before = await seedLegacy(admin);
    const release = manifest.slice(48), rollback = await admin.connect();
    try {
      await rollback.query('BEGIN');
      await rollback.query(release[0].sql); await rollback.query(release[1].sql);
      await assert.rejects(rollback.query('SELECT 1/0'), error => error.code === '22012');
      await rollback.query('ROLLBACK');
      assert.equal((await rollback.query("select to_regclass('public.market_provider_reservations') as name")).rows[0].name, null);
      assert.equal((await rollback.query("select count(*)::int as n from information_schema.columns where table_name='fx_rates' and column_name='observed_at'")).rows[0].n, 0);
      report.cases.push({ name: 'release-batch-error-rolls-back-ddl', status: 'PASS' });
    } finally { await rollback.query('ROLLBACK'); rollback.release(); }
    await applyBatch(release);
    await verifyLegacy(admin, before);
    report.cases.push({ name: 'legacy-rows-preserved', status: 'PASS' });
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n, manifest.length);
    await admin.query(`GRANT USAGE ON SCHEMA public TO varda_tenant_app,rc_writer,rc_table_owner;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rc_writer;
      GRANT EXECUTE ON FUNCTION apply_native_portfolio_mutation(uuid,uuid,jsonb,jsonb) TO rc_writer;`);
    worker = new Pool({ ...connection, user: 'rc_writer' });
    tenant = new Pool({ ...connection, user: 'varda_tenant_app' });
    if (options.sharedExecution) {
      const { runSharedProcessCases } = await import('./simulation-execution-process-cases.mjs');
      await runSharedProcessCases({ admin, connection, environment, report });
    } else await runCases({ admin, worker, tenant, report });
    report.status = 'PASS';
  } catch (error) {
    // Provider payloads, SQL parameter values and credentials are deliberately omitted.
    report.errorCode = error.code ?? (error.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'REHEARSAL_FAILED');
    report.status = 'FAIL';
  } finally {
    await Promise.allSettled([admin?.end(), worker?.end(), tenant?.end()]);
    if (startupAttempted) {
      try { await nativeCommand(command('pg_ctl'), ['-D', dataDirectory, '-w', '-t', '30', 'stop', '-m', 'fast'], environment); report.clusterStopped = true; }
      catch { report.clusterStopped = false; report.status = 'FAIL'; }
    }
    try { await unlink(passwordFile); } catch { /* Already removed, or initdb never started. */ }
    await writeFile(path.join(runDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return { ...report, reportPath: path.join(runDirectory, 'report.json') };
}

export async function main(args) {
  const options = parseOptions(args);
  const manifest = await migrationManifest();
  if (!options.execute) return { status: 'NOT RUN', validation: 'PASS', migrationCount: manifest.length,
    migrationTail: RC_TAGS, prerequisites: await prerequisites(), reason: 'validate_only_does_not_connect_or_apply_sql' };
  return executeLocal(options, manifest);
}

export async function rehearseSharedExecution(args) {
  const options = parseOptions(args), manifest = await migrationManifest();
  if (!options.execute) return { status: 'BLOCKED', validation: 'PASS', prerequisites: await prerequisites(), reason: 'real_postgresql_not_executed', migrationCount: manifest.length };
  const result = await executeLocal({ ...options, sharedExecution: true }, manifest);
  return { ...result, status: result.status === 'NOT RUN' ? 'BLOCKED' : result.status };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  // Finish module evaluation before cases import this runner's SQL transport.
  main(process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'FAIL' ? 1 : report.validation === 'PASS' || report.status === 'PASS' ? 0 : 2;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
