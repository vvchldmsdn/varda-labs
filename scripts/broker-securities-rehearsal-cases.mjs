import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readBrokerRecoveryState, recoverBrokerSecurities, recoveryHash } from './lib/broker-securities-recovery.mjs';
import { resolveSnapshotCycle } from '../src/lib/snapshots/market-calendar.ts';

// The caller supplies its already isolated database. This module discovers no
// connection string, credentials or environment and calls no external services.
export async function runBrokerSecuritiesCases({ admin, report }) {
  const client = typeof admin.connect === 'function' ? await admin.connect() : admin;
  const check = async (name, run) => {
    const result = { name: `broker-recovery-${name}`, status: 'FAIL' };
    report.cases.push(result);
    try { await run(); } catch (error) {
      result.failure = { code: error.code ?? error.name, assertion: error.message?.split('\n')[0]?.slice(0, 180) };
      throw error;
    }
    result.status = 'PASS';
  };
  const apply = plan => recoverBrokerSecurities(client, plan, {
    write: true, confirmation: recoveryHash(plan), restoreVerified: true,
  });
  async function fixture({ archive = false, wasArchived = false } = {}) {
    const owner = randomUUID(), other = randomUUID(), account = randomUUID(), otherAccount = randomUUID();
    const asset = randomUUID(), otherAsset = randomUUID(), code = `broker-${account.slice(0, 8)}`;
    await client.query("insert into app_users(id,status) values($1,'active'),($2,'active')", [owner, other]);
    await client.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Synthetic broker','brokerage','KRW'),($4,$5,$6,'Unrelated owner','brokerage','KRW')", [account, owner, code, otherAccount, other, `other-${account.slice(0, 8)}`]);
    await client.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,average_cost,archived_at) values($1,$2,$3,$4,'Synthetic security','FIXTURE','korea','KRW','etf',4,30000,25000,case when $5 then now() else null end),($6,$7,$8,$9,'Other security','FIXTURE','korea','KRW','etf',19,40000,28000,null)", [asset, owner, account, code, wasArchived, otherAsset, other, otherAccount, `other-${account.slice(0, 8)}`]);
    const plan = {
      version: 1, id: randomUUID(), ownerId: owner, accountId: account,
      cashValuation: 'excluded', expectedStateHash: '',
      holdings: [{ id: asset, ticker: 'FIXTURE', market: 'korea', currency: 'KRW', name: 'Synthetic security', assetType: 'etf', startQuantity: '4', endQuantity: archive ? '0' : '5', averageCost: null, removeFractionalDisplay: false }],
      trades: [{ id: randomUUID(), rowId: 'synthetic-trade-1', assetId: asset, side: archive ? 'sell' : 'buy', quantity: archive ? '4' : '1', tradeDate: '2026-08-01', executionGross: { amount: archive ? '120000' : '30000', currency: 'KRW' }, cashSettlement: null, originalDisplay: null, fee: null, tax: null, evidence: ['synthetic isolated ledger'] }],
    };
    const refresh = async () => { plan.expectedStateHash = recoveryHash(await readBrokerRecoveryState(client, owner, account)); };
    const snapshot = async () => {
      const result = {};
      for (const table of ['accounts', 'assets', 'event_ledger_entries', 'broker_recovery_batches', 'portfolio_group_asset_memberships', 'holding_lifecycle_events', 'daily_portfolio_snapshots']) {
        result[table] = (await client.query(`select to_jsonb(t) as value from ${table} t where canonical_owner_user_id in ($1,$2) order by id`, [owner, other])).rows.map(row => row.value);
      }
      return result;
    };
    await refresh();
    return { owner, other, account, otherAccount, asset, otherAsset, plan, refresh, snapshot };
  }
  try {
    await check('dry-run-write-retry-and-other-owner-preservation', async () => {
      const f = await fixture(), before = await f.snapshot();
      assert.equal((await recoverBrokerSecurities(client, f.plan)).status, 'dry-run');
      assert.deepEqual(await f.snapshot(), before);
      assert.equal((await apply(f.plan)).status, 'applied');
      const after = await f.snapshot();
      assert.deepEqual(after.accounts, before.accounts, 'cash/native state is never initialized');
      assert.deepEqual(after.assets.filter(a => a.canonical_owner_user_id === f.other), before.assets.filter(a => a.canonical_owner_user_id === f.other));
      assert.equal(Number(after.assets.find(a => a.id === f.asset).quantity), 5);
      assert.equal((await apply(f.plan)).status, 'existing');
      assert.deepEqual(await f.snapshot(), after);
    });
    await check('archive-memberships-lifecycle-and-atomic-rollback', async () => {
      const f = await fixture({ archive: true }), serviceDate = resolveSnapshotCycle().snapshotDate;
      for (const [name, from, to] of [['past', '2026-01-01', '2026-02-01'], ['open', '2026-02-01', null], ['today', serviceDate, null]]) {
        const group = randomUUID();
        await client.query('insert into portfolio_groups(id,canonical_owner_user_id,name) values($1,$2,$3)', [group, f.owner, name]);
        await client.query('insert into portfolio_group_asset_memberships(canonical_owner_user_id,portfolio_group_id,asset_id,valid_from,valid_to) values($1,$2,$3,$4,$5)', [f.owner, group, f.asset, from, to]);
      }
      await f.refresh(); const before = await f.snapshot();
      assert.equal((await recoverBrokerSecurities(client, f.plan)).status, 'dry-run');
      assert.deepEqual(await f.snapshot(), before, 'dry-run rolls back membership deletions and lifecycle writes too');
      const failing = { query(sql, params) { return sql.startsWith('insert into event_ledger_entries') ? client.query('select 1/0') : client.query(sql, params); } };
      await assert.rejects(recoverBrokerSecurities(failing, f.plan, { write: true, confirmation: recoveryHash(f.plan), restoreVerified: true }), error => error.code === '22012');
      assert.deepEqual(await f.snapshot(), before);
      await apply(f.plan); const after = await f.snapshot();
      const memberships = after.portfolio_group_asset_memberships;
      assert.equal(memberships.length, 2);
      assert.equal(memberships.find(m => m.valid_from === '2026-01-01').valid_to, '2026-02-01');
      assert.equal(memberships.find(m => m.valid_from === '2026-02-01').valid_to, serviceDate);
      const asset = after.assets.find(a => a.id === f.asset);
      assert.equal(Number(asset.quantity), 0); assert.ok(asset.archived_at);
      assert.equal(after.holding_lifecycle_events.length, 1);
      const event = after.holding_lifecycle_events[0];
      assert.equal(event.event_type, 'archived'); assert.equal(event.previous_archived_at, null);
      assert.equal(event.resulting_archived_at, asset.archived_at, 'archive lifecycle must preserve database timestamp precision');
      assert.equal(event.resulting_asset_updated_at, asset.updated_at, 'lifecycle updated timestamp must exactly match the asset');
      const backedUp = after.broker_recovery_batches[0].before_state.memberships;
      assert.deepEqual(backedUp, before.portfolio_group_asset_memberships, 'deleted membership remains in batch rollback evidence');
    });
    await check('restoration-records-lifecycle-without-inventing-memberships', async () => {
      const f = await fixture({ wasArchived: true }); await apply(f.plan);
      const after = await f.snapshot(), event = after.holding_lifecycle_events[0];
      assert.equal(after.assets.find(a => a.id === f.asset).archived_at, null);
      assert.equal(event.event_type, 'restored'); assert.ok(event.previous_archived_at);
      assert.equal(event.resulting_archived_at, null);
      assert.deepEqual(after.portfolio_group_asset_memberships, []);
    });
    await check('generated-foreign-keys-protect-recovery-identity', async () => {
      const f = await fixture(); await apply(f.plan);
      assert.equal((await client.query('select broker_recovery_asset_id::text as id from event_ledger_entries where id=$1', [f.plan.trades[0].id])).rows[0].id, f.asset);
      await assert.rejects(client.query('delete from assets where id=$1', [f.asset]), error => ['23001', '23503'].includes(error.code) && error.constraint === 'event_broker_recovery_asset_owner_fk');
      // Changing only account would satisfy the owner FK; the generated account FK must stop it.
      const sameOwnerAccount = randomUUID();
      await client.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Another account','brokerage','KRW')", [sameOwnerAccount, f.owner, `extra-${sameOwnerAccount.slice(0, 8)}`]);
      await assert.rejects(client.query('update assets set account_id=$2 where id=$1', [f.asset, sameOwnerAccount]), error => error.code === '23503' && error.constraint === 'event_broker_recovery_asset_account_fk');
      await assert.rejects(client.query("update assets set canonical_owner_user_id=$2,account_id=$3,ticker='MOVED' where id=$1", [f.asset, f.other, f.otherAccount]), error => error.code === '23503' && error.constraint === 'event_broker_recovery_asset_owner_fk');
      await assert.rejects(client.query('update event_ledger_entries set asset_id=$2 where id=$1', [f.plan.trades[0].id, f.otherAsset]), /broker_recovery_asset_scope_mismatch/);
      await assert.rejects(client.query('update event_ledger_entries set broker_recovery_data=$2 where id=$1', [f.plan.trades[0].id, JSON.stringify({ rowId: 'missing-required-fields' })]), error => error.code === '23514');
    });
    await check('fractional-start-evidence-and-stale-state', async () => {
      const f = await fixture();
      f.plan.holdings[0].startQuantity = '4.25'; f.plan.holdings[0].endQuantity = '5.25';
      const before = await f.snapshot();
      await assert.rejects(apply(f.plan), /recovery_start_quantity_mismatch/);
      assert.deepEqual(await f.snapshot(), before);
      f.plan.holdings[0].fractionalQuantityBefore = '0.25';
      await assert.rejects(apply(f.plan), /fractional_quantity_requires_display_conversion/);
      f.plan.holdings[0].removeFractionalDisplay = true;
      await apply(f.plan);
      assert.equal(Number((await f.snapshot()).assets.find(a => a.id === f.asset).quantity), 5.25);
      const changed = await fixture();
      await client.query('update assets set current_price=31000 where id=$1', [changed.asset]);
      await assert.rejects(apply(changed.plan), /recovery_state_changed/);
    });
    await check('missing-current-quote-never-creates-zero-value-active-holding', async () => {
      const f = await fixture(), fresh = randomUUID();
      f.plan.holdings.push({ id: fresh, ticker: `NOQUOTE${fresh.slice(0, 8).toUpperCase()}`, market: 'us', currency: 'USD', name: 'Unpriced synthetic', assetType: 'stock', startQuantity: '0', endQuantity: '1', averageCost: null, removeFractionalDisplay: false });
      f.plan.trades.push({ ...f.plan.trades[0], id: randomUUID(), rowId: 'unpriced-row', assetId: fresh, side: 'buy', quantity: '1', executionGross: { amount: '100', currency: 'USD' } });
      const before = await f.snapshot();
      await assert.rejects(apply(f.plan), /recovery_new_holding_quote_missing/);
      assert.deepEqual(await f.snapshot(), before);
    });
    await check('tenant-isolation-and-write-denial', async () => {
      const f = await fixture(); await apply(f.plan);
      const asTenant = async (owner, sql, params) => {
        await client.query('begin');
        try {
          await client.query('set local role varda_tenant_app');
          if (owner) await client.query("select set_config('app.current_user_id',$1,true)", [owner]);
          return await client.query(sql, params);
        } finally { await client.query('rollback'); }
      };
      assert.equal((await asTenant(f.owner, 'select id from broker_recovery_batches where id=$1', [f.plan.id])).rows.length, 1);
      assert.equal((await asTenant(f.other, 'select id from broker_recovery_batches where id=$1', [f.plan.id])).rows.length, 0);
      assert.equal((await asTenant(null, 'select id from broker_recovery_batches where id=$1', [f.plan.id])).rows.length, 0);
      await assert.rejects(asTenant(f.owner, 'delete from broker_recovery_batches where id=$1', [f.plan.id]), error => error.code === '42501');
    });
  } finally { client.release?.(); }
}
