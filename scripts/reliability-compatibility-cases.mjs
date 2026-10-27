import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { importPre0059 } from './lib/import-reliability-pre0059.mjs';
import { migrationManifest, sqlTransport } from './krw-usd-rc-rehearsal.mjs';

/** A separate empty database in the caller's already verified disposable local
 * cluster. No URL, credential, user data, or production fallback is accepted. */
export async function runCompatibilityCases({ admin: clusterAdmin, report, connection }) {
  assert.equal(connection.host, '127.0.0.1');
  assert.equal(connection.database, 'postgres');
  const database = `reliability_compat_${randomUUID().replaceAll('-', '')}`;
  await clusterAdmin.query(`CREATE DATABASE ${database}`);
  const admin = new Pool({ ...connection, database, user: 'rc_admin' });
  const worker = new Pool({ ...connection, database, user: 'rc_writer' });
  const tenant = new Pool({ ...connection, database, user: 'varda_tenant_app' });
  const sessions = new Set();
  const sql = sqlTransport(worker, sessions), tenantSql = sqlTransport(tenant, sessions);
  const ports = { '@/db/client': { sqlClient: sql, db: drizzle(worker) }, '@/db/tenant-client': { getTenantSqlClient: () => tenantSql } };
  const owner = randomUUID(), account = randomUUID(), asset = randomUUID();
  const context = { ownerUserId: owner, role: 'user' };
  const check = async (name, run) => {
    const result = { name: `compatibility:${name}`, status: 'FAIL' };
    report.cases.push(result); await run(); result.status = 'PASS';
  };
  const mode = value => admin.query('select set_trade_reliability_mode($1,$2)', [value, 'Synthetic compatibility rehearsal']);
  const rejected = error => /trade_reliability|financial_writes_paused|financial_writer_incompatible|financial_release_not_activated|reliability.*(paused|version|compatible)|write_paused|write_version|compatible_required/i.test(error.message);
  let old, ledger, snapshots, cutoff, originalRows, originalSnapshotRows, oldEvidence, rebuiltEvidence;
  const cashEvent = (type, amount, at, sequence) => ({ operationId: randomUUID(), accountId: account, expectedSequence: sequence, event: { type, amount, currency: 'USD', at } });
  const position = (quantity, at, priceAt) => ({ id: asset, ownerId: owner, accountId: account, kind: 'holding', name: 'Synthetic compatibility unit', ticker: 'CMPT', market: 'us',
    observation: { quantity, price: '100', currency: 'USD', at, priceObservedAt: priceAt, priceFetchedAt: priceAt, basis: 'raw', source: 'kis' } });
  const evidence = (quantity, cash, sequence, at, capturedAt, priceAt) => ({ ownerId: owner, reporting: 'USD', asOf: capturedAt,
    current: { at, boundary: 'before', source: 'native_ledger_cutoff_v2', scopeComplete: true, positions: [position(quantity, at, priceAt),
      ...['KRW', 'USD'].map(currency => ({ id: `cash:${account}:${currency}`, ownerId: owner, accountId: account, kind: 'cash', name: currency,
        observation: { quantity: currency === 'USD' ? cash : '0', price: '1', currency, at, priceObservedAt: at, priceFetchedAt: at, basis: 'raw', source: 'native_ledger_cash' } }))] },
    history: [], trades: null, fx: [], ledgerComplete: true, nativeSequences: { [account]: sequence }, maxPriceAgeMs: 86400000, maxFxAgeMs: 86400000 });
  try {
    // This matrix intentionally upgrades 0058 to 0059, independent of later DDL.
    const manifest = (await migrationManifest()).filter(row => Number(row.tag.slice(0,4))<=59), last = manifest.at(-1);
    assert.match(last.tag, /^0059_/);
    const migrator = await admin.connect();
    try {
      await migrator.query('BEGIN');
      for (const migration of manifest.slice(0, -1)) await migrator.query(migration.sql);
      await migrator.query('COMMIT');
    } catch (error) { await migrator.query('ROLLBACK'); throw error; }
    finally { migrator.release(); }
    await admin.query('GRANT USAGE ON SCHEMA public TO rc_writer; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rc_writer; GRANT EXECUTE ON FUNCTION apply_native_portfolio_mutation(uuid,uuid,jsonb,jsonb) TO rc_writer');
    old = await importPre0059(ports);
    report.compatibilityBase = old.base;
    await admin.query("insert into app_users(id,status,role) values($1,'active','user')", [owner]);
    await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'compat','Synthetic compatibility','brokerage','USD')", [account, owner]);
    await admin.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,'compat','Synthetic compatibility unit','CMPT','us','USD','stock',10,100)", [asset, owner, account]);
    await check('old-app-with-0058-actual-writer-query-snapshot', async () => {
      assert.equal((await old.ledger.writeNativeMutation(context, { operationId: randomUUID(), accountId: account, expectedSequence: null,
        opening: { at: '2026-08-01T00:00:00Z', cash: { KRW: '0', USD: '1000' }, positions: [{ assetId: asset, quantity: '10', currency: 'USD', costLots: null }] } })).status, 'created');
      assert.equal((await old.ledger.writeNativeMutation(context, { operationId: randomUUID(), accountId: account, expectedSequence: 0,
        event: { type: 'sell', at: '2026-08-03T00:00:00Z', assetId: asset, quantity: '3', currency: 'USD', settlement: { amount: '330', currency: 'USD' }, fee: { amount: '0', currency: 'USD' }, tax: { amount: '0', currency: 'USD' } } })).status, 'created');
      const data = await old.ledger.readNativeLedger(context, account);
      assert.equal(data.accounts[0].state.cash.USD, '1330'); assert.equal(data.accounts[0].state.positions[0].quantity, '7');
      oldEvidence = evidence('7', '1330', 1, '2026-08-03T22:00:00.000Z', '2026-08-04T01:00:00Z', '2026-08-03T21:59:00Z');
      assert.equal((await old.snapshots.saveNativeCutoffSnapshots(context, oldEvidence, '2026-08-04', '2026-08-04T01:00:00Z')).created, 1);
    });
    await admin.query(last.sql);
    // Explicit grants, never blanket DML on the operator-only runtime control.
    await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON native_ledger_revisions,native_operation_cancellations,daily_snapshot_work TO rc_writer; GRANT SELECT ON effective_native_ledger_entries TO rc_writer; GRANT EXECUTE ON FUNCTION assert_daily_snapshot_fence(uuid,integer),assert_trade_reliability_write(boolean) TO rc_writer');
    [ledger, snapshots, cutoff] = await importWithPorts(['src/db/queries/native-portfolio-ledger.ts', 'src/db/queries/native-portfolio-snapshots.ts', 'src/lib/snapshots/native-cutoff-evidence.ts'], ports);
    await check('old-app-with-0059-before-incompatible-writes', async () => {
      assert.equal((await old.ledger.writeNativeMutation(context, cashEvent('deposit', '1', '2026-08-04T12:00:00Z', 1))).status, 'created');
      assert.equal((await old.ledger.writeNativeMutation(context, cashEvent('withdraw', '1', '2026-08-04T13:00:00Z', 2))).status, 'created');
      const before = await old.ledger.readNativeLedger(context, account), after = await ledger.readNativeLedger(context, account);
      assert.deepEqual(after.accounts[0].state, before.accounts[0].state);
      assert.deepEqual(after.entries, before.entries); assert.deepEqual(after.snapshots, before.snapshots);
      assert.equal(before.entries.length, 4); assert.equal(before.accounts[0].state.cash.USD, '1330');
      await assert.rejects(tenant.query("select set_trade_reliability_mode('paused','Untrusted caller')"), error => error.code === '42501');
      await assert.rejects(worker.query("select set_trade_reliability_mode('paused','App caller')"), error => error.code === '42501');
    });
    await check('mode-change-drains-inflight-financial-transaction', async () => {
      const active = await worker.connect(), operator = await admin.connect();
      let transition;
      try {
        await active.query('BEGIN');
        await active.query('update assets set updated_at=updated_at where id=$1', [asset]);
        transition = operator.query("select set_trade_reliability_mode('compatible','Drain existing synthetic transaction')");
        // Observe the actual blocking relation, not a sleep-based assumption.
        let waiting = false;
        for (let i = 0; i < 50 && !waiting; i++) {
          waiting = (await admin.query('select $1::int=any(pg_blocking_pids($2::int)) as waiting', [active.processID, operator.processID])).rows[0].waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(waiting, true, 'Operator must wait for the old in-flight write transaction');
        await active.query('COMMIT'); await transition;
      } finally { await active.query('ROLLBACK'); if (transition) await transition.catch(() => {}); active.release(); operator.release(); }
    });
    await check('waiting-writer-rechecks-pause-after-exclusive-switch', async () => {
      const active = await worker.connect(), operator = await admin.connect();
      let delayed;
      try {
        await operator.query('BEGIN');
        await operator.query("select set_trade_reliability_mode('paused','Synthetic pause racing an admitted version')");
        await active.query('BEGIN');
        await active.query("select set_config('app.trade_reliability_version','0059',true)");
        delayed = active.query('update assets set updated_at=updated_at where id=$1', [asset])
          .then(() => ({ rejected: false }), error => ({ rejected: true, message: error.message }));
        let waiting = false;
        for (let i = 0; i < 50 && !waiting; i++) {
          waiting = (await admin.query('select $1::int=any(pg_blocking_pids($2::int)) as waiting', [operator.processID, active.processID])).rows[0].waiting;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(waiting, true, 'Financial write must wait behind the operator mode transition');
        await operator.query('COMMIT');
        const result = await delayed;
        assert.equal(result.rejected, true);
        assert.match(result.message, /financial_writes_paused/, 'Statement begun before the commit must still observe the committed pause');
      } finally {
        await operator.query('ROLLBACK');
        if (delayed) await delayed;
        await active.query('ROLLBACK');
        active.release(); operator.release();
      }
      await mode('compatible');
    });
    await check('compatible-mode-rejects-old-app-private-helper-and-worker', async () => {
      const input = cashEvent('deposit', '1', '2026-08-05T12:00:00Z', 3);
      await assert.rejects(old.ledger.writeNativeMutation(context, input), rejected);
      const state = (await ledger.readNativeLedger(context, account)).accounts[0];
      const next = { ...state.state, at: input.event.at, sequence: 4, cash: { ...state.state.cash, USD: '1331' } };
      const changes = [{ accountId: account, expectedState: state.state, expectedAssets: state.assets, next,
        event: { ...input.event, id: input.operationId, sequence: 4, source: 'user_native_ledger' }, effect: { cashLegs: [{ currency: 'USD', delta: '1', kind: 'external_in' }] }, entryId: randomUUID(), serviceDate: '2026-08-05', newAsset: null }];
      await assert.rejects(worker.query('select apply_native_portfolio_mutation($1,$2,$3,$4)', [owner, input.operationId, JSON.stringify(input), JSON.stringify(changes)]), rejected);
      const late = evidence('7', '1330', 3, '2026-08-05T22:00:00.000Z', '2026-08-06T01:00:00Z', '2026-08-05T21:59:00Z');
      await assert.rejects(old.snapshots.saveNativeCutoffSnapshots(context, late, '2026-08-06', '2026-08-06T01:00:00Z'), rejected);
      assert.equal((await ledger.readNativeLedger(context, account)).accounts[0].state.cash.USD, '1330');
      assert.equal((await admin.query('select count(*)::int n from daily_portfolio_snapshots where account_id=$1', [account])).rows[0].n, 1);
    });
    const missing = { operationId: randomUUID(), accountId: account, expectedSequence: 3,
      event: { type: 'buy', at: '2026-08-02T00:00:00Z', assetId: asset, quantity: '2', currency: 'USD', settlement: { amount: '200', currency: 'USD' }, fee: { amount: '0', currency: 'USD' }, tax: { amount: '0', currency: 'USD' } },
      history: { reason: 'Synthetic missing trade', notInOpening: true } };
    const rawRows = () => admin.query('select id,native_data from event_ledger_entries where account_id=$1 order by native_sequence', [account]).then(result => result.rows);
    await check('first-revision-is-reader-incompatibility-boundary', async () => {
      originalRows = await rawRows();
      originalSnapshotRows = (await admin.query('select id,native_evidence from daily_portfolio_snapshots where account_id=$1', [account])).rows;
      assert.equal((await ledger.writeNativeMutation(context, missing)).status, 'created');
      const data = await ledger.readNativeLedger(context, account), oldData = await old.ledger.readNativeLedger(context, account);
      assert.equal(data.accounts[0].state.positions[0].quantity, '9'); assert.equal(data.accounts[0].state.cash.USD, '1130');
      assert.equal(data.entries.filter(row => row.data.event.type === 'buy').length, 1);
      assert.equal(oldData.entries.filter(row => row.data.event.type === 'buy').length, 0, 'Old reader cannot see the replayed missing buy');
      assert.equal(data.snapshots.length, 0); assert.equal(oldData.snapshots.length, 1, 'Old reader still exposes the invalidated valuation');
      assert.deepEqual((await rawRows()).slice(0, originalRows.length), originalRows);
    });
    await check('new-app-rebuilds-and-old-projection-cannot-read-revision-snapshot', async () => {
      const data = await ledger.readNativeLedger(context, account);
      const observations = await ledger.readNativeSnapshotObservations(context, account);
      const rebuilt = cutoff.buildNativeCutoffEvidence(oldEvidence, { ...data, observations }, '2026-08-04', '2026-08-04T01:00:00Z');
      rebuiltEvidence = rebuilt;
      assert.equal(rebuilt.current.positions.find(row => row.id === asset).observation.quantity, '9');
      assert.equal(rebuilt.current.positions.find(row => row.id === `cash:${account}:USD`).observation.quantity, '1130');
      assert.equal((await snapshots.saveNativeCutoffSnapshots(context, rebuilt, '2026-08-04', '2026-08-04T01:00:00Z')).created, 1);
      const oldData = await old.ledger.readNativeLedger(context, account);
      assert.equal(oldData.snapshots.length, 2);
      assert.throws(() => old.projection.attachNativeLedgerEvidence({ ...oldEvidence, asOf: '2026-08-06T01:00:00Z' }, oldData, 'account'), /native_snapshot_duplicate/);
      assert.equal((await ledger.readNativeLedger(context, account)).snapshots.length, 1);
    });
    await check('injected-failure-pause-read-recovery-and-lossless-compatible-resume', async () => {
      const revision = (await admin.query('select * from native_ledger_revisions where account_id=$1', [account])).rows;
      const failed = await worker.connect();
      try {
        await failed.query('BEGIN'); await failed.query("select set_config('app.trade_reliability_version','0059',true)");
        await failed.query('update assets set current_price=99 where id=$1', [asset]);
        await assert.rejects(failed.query('select 1/0'), error => error.code === '22012');
        await failed.query('ROLLBACK');
      } finally { await failed.query('ROLLBACK'); failed.release(); }
      await mode('paused');
      const current = await ledger.readNativeLedger(context, account);
      assert.equal(current.accounts[0].state.positions[0].quantity, '9'); assert.equal(current.accounts[0].state.cash.USD, '1130');
      assert.equal(await ledger.readNativeOperation(context, missing.operationId), 'committed');
      assert.equal((await ledger.writeNativeMutation(context, missing)).status, 'existing', 'Recovery of an already committed ID requires no new financial write');
      await assert.rejects(ledger.writeNativeMutation(context, cashEvent('deposit', '1', '2026-08-06T12:00:00Z', 4)), rejected);
      await assert.rejects(old.ledger.writeNativeMutation(context, cashEvent('deposit', '1', '2026-08-06T12:00:00Z', 4)), rejected);
      await assert.rejects(snapshots.saveNativeCutoffSnapshots(context, rebuiltEvidence, '2026-08-04', '2026-08-04T01:00:00Z'), rejected);
      await assert.rejects(mode('legacy'), /trade_reliability|irreversible|revision|legacy|compatible/i);
      assert.deepEqual((await admin.query('select * from native_ledger_revisions where account_id=$1', [account])).rows, revision);
      assert.deepEqual((await rawRows()).slice(0, originalRows.length), originalRows);
      assert.deepEqual((await admin.query('select id,native_evidence from daily_portfolio_snapshots where id=$1', [originalSnapshotRows[0].id])).rows, originalSnapshotRows);
      assert.equal(Number((await admin.query('select current_price from assets where id=$1', [asset])).rows[0].current_price), 100);
      await mode('compatible');
      const resumed = await ledger.readNativeLedger(context, account);
      assert.deepEqual(resumed, current);
      assert.equal((await ledger.writeNativeMutation(context, missing)).status, 'existing');
      assert.deepEqual((await admin.query('select * from native_ledger_revisions where account_id=$1', [account])).rows, revision);
    });
    report.compatibilityRehearsal = { status: 'PASS', base: old.base, oldSources: 'complete-frozen-source-closure-verified-against-original-runtime-hashes', database: 'separate-disposable-local-postgresql', firstReaderIncompatibility: 'first_native_ledger_revision', recoveredQuantity: '9', recoveredCashUsd: '1130' };
  } finally { await Promise.allSettled([admin.end(), worker.end(), tenant.end()]); }
}
