import assert from 'node:assert/strict';
import { it } from 'node:test';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { childEnvironment, main, migrationManifest, parseOptions, RC_TAGS, sqlTransport, transactionSql, within } from '../scripts/krw-usd-rc-rehearsal.mjs';
import { seedLegacy, verifyLegacy } from '../scripts/krw-usd-rc-rehearsal-cases.mjs';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { randomUUID } from 'node:crypto';

it('rehearsal refuses arbitrary connection and existing-cluster options before side effects', () => {
  for (const args of [['--database-url', 'postgres://example/production'], ['--execute-local'], ['--execute-local', '--pg-bin', 'relative'],
    ['--execute-local', '--pg-bin', path.resolve('bin'), '--data-directory', path.resolve('existing')], ['--validate-only', '--execute-local']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.deepEqual(parseOptions([]), { execute: false });
  assert.deepEqual(parseOptions(['--execute-local', '--pg-bin', path.resolve('bin')]), { execute: true, bin: path.resolve('bin') });
});

it('rehearsal subprocess environment excludes ambient credentials and preload hooks', () => {
  assert.deepEqual(childEnvironment({ Path: 'system-tools', SystemRoot: 'system', TEMP: 'temp', DATABASE_URL: 'forbidden',
    PGHOST: 'forbidden', PGSERVICEFILE: 'forbidden', PGPASSFILE: 'forbidden', PGOPTIONS: 'forbidden',
    NODE_OPTIONS: '--import=untrusted', TWELVE_DATA_API_KEY: 'forbidden', CAIRN_TWELVE_DATA_ENABLED: 'true' }),
  { Path: 'system-tools', SystemRoot: 'system', TEMP: 'temp' });
});

it('rehearsal containment rejects parent/sibling paths and the output root itself', () => {
  const root = path.resolve('output/krw-usd-rc-rehearsal');
  assert.equal(within(root, path.join(root, 'local-fresh')), true);
  assert.equal(within(root, root), false);
  assert.equal(within(root, path.dirname(root)), false);
  assert.equal(within(root, `${root}-other`), false);
});

it('validate-only reports NOT RUN and ordered migrations without SQL or environment loading', async () => {
  const report = await main(['--validate-only']);
  assert.equal(report.status, 'NOT RUN'); assert.equal(report.validation, 'PASS'); assert.equal(report.migrationCount, 57);
  assert.deepEqual(report.migrationTail, RC_TAGS);
  const manifest = await migrationManifest();
  assert.ok(manifest.every(row => /^[a-f0-9]{64}$/.test(row.sha256)));
});

it('TCP transport preserves isolation/read-only semantics and rejects unknown options', () => {
  assert.equal(transactionSql({ isolationLevel: 'RepeatableRead', readOnly: true }), 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(transactionSql({ isolationLevel: 'ReadCommitted' }), 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');
  assert.throws(() => transactionSql({ isolationLevel: 'ReadUncommitted;DROP' }));
});

it('TCP transport rolls back and releases a failed transaction and keeps parameter values bound', async () => {
  const seen = [], sessions = new Set(); let released = false;
  const client = { processID: 1001, query: async (text, parameters) => {
    seen.push({ text, parameters }); if (text === 'failing') throw new Error('fixture'); return { rows: [] };
  }, release: () => { released = true; } };
  const sql = sqlTransport({ connect: async () => client }, sessions);
  await assert.rejects(sql.transaction(tx => [tx.query('select $1', ["';DROP TABLE data;--"]), tx.query('failing')]), /fixture/);
  assert.deepEqual(seen.map(row => row.text), ['BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE', 'select $1', 'failing', 'ROLLBACK']);
  assert.deepEqual(seen[1].parameters, ["';DROP TABLE data;--"]); assert.equal(released, true); assert.ok(sessions.has(1001));
});

it('TCP transport allocates independent sessions for simultaneous transactions', async () => {
  let id = 0, entered = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const sessions = new Set();
  const sql = sqlTransport({ connect: async () => ({ processID: ++id, release() {}, query: async text => {
    if (text === 'work') { entered++; if (entered === 2) release(); await barrier; }
    return { rows: [] };
  } }) }, sessions);
  await Promise.all([sql.transaction(tx => [tx.query('work')]), sql.transaction(tx => [tx.query('work')])]);
  assert.equal(sessions.size, 2);
});

it('complete migration chain, legacy transition and actual native writer work in PGlite (not server concurrency)', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE varda_tenant_app');
    let before;
    for (const entry of await migrationManifest()) {
      await db.exec(entry.sql);
      if (entry.tag.startsWith('0047_')) before = await seedLegacy(db);
    }
    await verifyLegacy(db, before);
    const rows = (await db.query("select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('market_provider_observations','market_provider_action_coverage','market_provider_corporate_actions','native_contribution_plans')")).rows;
    assert.equal(rows.length, 4); assert.ok(rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
    const transport = tenant => ({ transaction: async build => db.transaction(async tx => {
      if (tenant) await tx.exec('SET LOCAL ROLE varda_tenant_app');
      const result = [];
      for (const query of build({ query: (text, parameters = []) => ({ text, parameters }) })) result.push((await tx.query(query.text, query.parameters)).rows);
      return result;
    }) });
    await db.exec('GRANT USAGE ON SCHEMA public TO varda_tenant_app');
    const [ledger, projection, snapshots] = await importWithPorts([
      'src/db/queries/native-portfolio-ledger.ts', 'src/lib/native-portfolio-projection.ts', 'src/db/queries/native-portfolio-snapshots.ts',
    ], { '@/db/client': { sqlClient: transport(false) }, '@/db/tenant-client': { getTenantSqlClient: () => transport(true) } });
    const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account = '11111111-1111-4111-8111-111111111111', asset = randomUUID();
    const context = { ownerUserId: owner };
    assert.equal((await ledger.writeNativeMutation(context, { operationId: randomUUID(), accountId: account, expectedSequence: null,
      opening: { at: '2026-08-01T00:00:00Z', cash: { KRW: '0', USD: '1000.75' }, positions: [] } })).status, 'created');
    assert.equal((await ledger.writeNativeMutation(context, { operationId: randomUUID(), accountId: account, expectedSequence: 0,
      event: { type: 'buy', at: '2026-08-02T00:00:00Z', assetId: asset, quantity: '0.000001', price: '10000', currency: 'USD' },
      newAsset: { id: asset, name: 'Synthetic rehearsal asset', ticker: 'TEST', market: 'us', currency: 'USD', assetType: 'stock' } })).status, 'created');
    const actual = await ledger.readNativeLedger(context, account);
    assert.equal(actual.accounts[0].state.cash.USD, '1000.74');
    const at = new Date().toISOString();
    const evidence = projection.attachNativeLedgerEvidence({ ownerId: owner, reporting: 'USD', asOf: at,
      current: { at, source: 'synthetic rehearsal', scopeComplete: false, positions: [{ id: asset, ownerId: owner, accountId: account, name: 'Synthetic rehearsal asset',
        observation: { at, quantity: '0.000001', price: '10000', currency: 'USD', basis: 'raw', source: 'synthetic rehearsal' } }] },
      history: [], trades: null, fx: [], maxPriceAgeMs: 0, maxFxAgeMs: 0 }, actual, 'account');
    assert.equal((await snapshots.saveNativeSnapshots(context, evidence)).created, 1);
  } finally { await db.close(); }
});
