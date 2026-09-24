import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { migrationManifest } from '../scripts/krw-usd-rc-rehearsal.mjs';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { runBrokerSecuritiesCases } from '../scripts/broker-securities-rehearsal-cases.mjs';
import {
  readBrokerRecoveryState, recoverBrokerSecurities, recoveryHash, validateBrokerRecoveryPlan, projectBrokerAcquisitionAverageCost,
} from '../scripts/lib/broker-securities-recovery.mjs';

it('rejects duplicate instrument identities without SQL even with different holding UUIDs', () => {
  const asset = randomUUID();
  const plan = {
    version: 1, id: randomUUID(), ownerId: randomUUID(), accountId: randomUUID(), cashValuation: 'excluded', expectedStateHash: 'a'.repeat(64),
    holdings: [{ id: asset, ticker: 'SYNTHETIC', market: 'us', currency: 'USD', name: 'Synthetic security', assetType: 'etf', startQuantity: '0', endQuantity: '1', averageCost: null, removeFractionalDisplay: false }],
    trades: [{ id: randomUUID(), rowId: 'synthetic', assetId: asset, side: 'buy', quantity: '1', tradeDate: '2026-08-01', executionGross: { amount: '10', currency: 'USD' }, fee: null, tax: null, evidence: ['synthetic fixture'] }],
  };
  assert.doesNotThrow(() => validateBrokerRecoveryPlan(plan));
  plan.holdings.push({ ...plan.holdings[0], id: randomUUID() });
  plan.trades.push({ ...plan.trades[0], id: randomUUID(), rowId: 'synthetic-duplicate', assetId: plan.holdings[1].id });
  assert.throws(() => validateBrokerRecoveryPlan(plan), /duplicate_recovery_instrument/);
});

// Real PostgreSQL constraints/transactions in process; no URLs, environment
it('preserves reported order price and exact acquisition total with explicit half-up projection without SQL', () => {
  const asset=randomUUID(), trade={id:randomUUID(),rowId:'basis',assetId:asset,side:'buy',quantity:'3',tradeDate:'2026-08-01',executionGross:{currency:'KRW',amount:'100'},orderUnitPrice:{currency:'KRW',amount:'32.123456'},fee:null,tax:null,evidence:['synthetic']};
  const holding={id:asset,ticker:'SYNTHETIC',market:'korea',currency:'KRW',name:'Synthetic',assetType:'etf',startQuantity:'0',endQuantity:'3',averageCost:'33.3333',removeFractionalDisplay:false,acquisitionBasis:{policy:'gross_buys_half_up_4dp_v1',feesIncluded:false,currency:'KRW',totalAmount:'100',quantity:'3'}};
  const plan={version:1,id:randomUUID(),ownerId:randomUUID(),accountId:randomUUID(),cashValuation:'excluded',expectedStateHash:'a'.repeat(64),holdings:[holding],trades:[trade]};
  assert.doesNotThrow(()=>validateBrokerRecoveryPlan(plan));
  assert.equal(projectBrokerAcquisitionAverageCost('1','32'),'0.0313');
  for(const edit of [p=>p.trades[0].orderUnitPrice.currency='USD',p=>p.trades[0].orderUnitPrice.amount='0',p=>p.holdings[0].acquisitionBasis.totalAmount='99',p=>p.holdings[0].averageCost='33.3334',p=>p.holdings[0].acquisitionBasis.feesIncluded=true,p=>p.holdings[0].acquisitionBasis.quantity='4']) {
    const bad=structuredClone(plan);edit(bad);assert.throws(()=>validateBrokerRecoveryPlan(bad));
  }
});

// Real PostgreSQL constraints/transactions in process; no URLs, environment
// files, provider ports, external authentication or persistent DB are used.
describe('broker securities recovery against the complete isolated SQL schema', () => {
  let db, nativeLedger;
  const client = { async query(sql, params = []) {
    const result = await db.query(sql, params);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };

  before(async () => {
    db = new PGlite();
    await db.exec('create role varda_tenant_app');
    for (const migration of await migrationManifest()) await db.exec(migration.sql);
    await db.exec('grant usage on schema public to varda_tenant_app');
    await db.exec("insert into live_price_quotes(ticker,market,currency,provider,source,quote_type,status,price,price_as_of,fetched_at) values('TESTUS','us','USD','kis','kis_synthetic_fixture','close','ok',211.25,now()-interval '1 hour',now()-interval '30 minutes')");
    const transport = tenant => ({ transaction: async build => db.transaction(async tx => {
      if (tenant) await tx.exec('set local role varda_tenant_app');
      const result = [];
      for (const command of build({ query: (sql, params = []) => ({ sql, params }) })) result.push((await tx.query(command.sql, command.params)).rows);
      return result;
    }) });
    [nativeLedger] = await importWithPorts(['src/db/queries/native-portfolio-ledger.ts'], {
      '@/db/client': { sqlClient: transport(false) },
      '@/db/tenant-client': { getTenantSqlClient: () => transport(true) },
    });
  });
  after(async () => { await db?.close(); });

  async function fixture() {
    const owner = randomUUID(), other = randomUUID(), account = randomUUID(), nativeAccount = randomUUID();
    const asset = randomUUID(), fresh = randomUUID(), cash = randomUUID(), snapshotId = randomUUID();
    const code = `recovery-${account.slice(0, 8)}`, nativeCode = `native-${account.slice(0, 8)}`;
    await db.query("insert into app_users(id,status) values($1,'active'),($2,'active')", [owner, other]);
    await db.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$3,$4,'Synthetic broker','brokerage','KRW'),($2,$3,$5,'Unrelated native','brokerage','USD')", [account, nativeAccount, owner, code, nativeCode]);
    assert.equal((await nativeLedger.writeNativeMutation({ ownerUserId: owner }, {
      operationId: randomUUID(), accountId: nativeAccount, expectedSequence: null,
      opening: { at: '2026-07-30T00:00:00Z', cash: { KRW: '120000', USD: '100.25' }, positions: [] },
    })).status, 'created');
    await db.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,average_cost,legacy_base44_id,fractional_krw_value,fractional_avg_cost) values($1,$2,$3,$4,'Original synthetic ETF','TESTKR','korea','KRW','etf',4,31000,28000,$5,15000,14000)", [asset, owner, account, code, randomUUID().replaceAll('-', '').slice(0, 24)]);
    await db.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,average_cost) values($1,$2,$3,$4,'Existing synthetic cash','CASHKRW','korea','KRW','cash',500000,1,null)", [cash, owner, account, code]);
    await db.query("insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,cash_value,total_market_value,total_cost,total_pnl,source) values($1,$2,$3,$4,'2026-07-31',500000,624000,612000,12000,'base44_import')", [snapshotId, owner, account, code]);
    await db.query("insert into account_balance_snapshots(canonical_owner_user_id,date,cash,brokerage) values($1,'2026-07-31',500000,124000)", [owner]);
    await db.query("insert into event_ledger_entries(canonical_owner_user_id,account_id,account,asset_id,legacy_asset_id,event_date,event_type,source,asset_name,before_value,after_value) values($1,$2,$3,$4,'original-event-asset','2026-07-31','correction','base44_import','Original synthetic ETF','old','new')", [owner, account, code, asset]);
    const before = await readBrokerRecoveryState(client, owner, account);
    const plan = {
      version: 1, id: randomUUID(), ownerId: owner, accountId: account, cashValuation: 'excluded', expectedStateHash: recoveryHash(before),
      holdings: [
        { id: asset, ticker: 'TESTKR', name: 'Original synthetic ETF', market: 'korea', currency: 'KRW', assetType: 'etf', startQuantity: '4', endQuantity: '5', averageCost: '27000', removeFractionalDisplay: true },
        { id: fresh, ticker: 'TESTUS', name: 'New synthetic US ETF', market: 'us', currency: 'USD', assetType: 'etf', startQuantity: '0', endQuantity: '2.5', averageCost: null, removeFractionalDisplay: false },
      ],
      trades: [
        { id: randomUUID(), rowId: 'test-row-1', assetId: asset, side: 'buy', quantity: '4', tradeDate: '2026-08-01', executionGross: { amount: '100000', currency: 'KRW' }, originalDisplay: null, cashSettlement: null, fee: null, tax: null, evidence: ['synthetic statement row 1'] },
        { id: randomUUID(), rowId: 'test-row-2', assetId: asset, side: 'sell', quantity: '3', tradeDate: '2026-08-02', executionGross: { amount: '90000', currency: 'KRW' }, originalDisplay: null, cashSettlement: null, fee: null, tax: null, evidence: ['synthetic statement row 2'] },
        { id: randomUUID(), rowId: 'test-row-3', assetId: fresh, side: 'buy', quantity: '2.5', tradeDate: '2026-08-03', executionGross: { amount: '500', currency: 'USD' }, originalDisplay: { amount: '650000', currency: 'KRW' }, cashSettlement: { amount: '500', currency: 'USD', date: '2026-08-05' }, fee: null, tax: null, evidence: ['synthetic statement row 3'] },
      ],
    };
    async function snapshot() {
      const result = {};
      for (const table of ['accounts', 'assets', 'event_ledger_entries', 'daily_portfolio_snapshots', 'account_balance_snapshots', 'broker_recovery_batches']) {
        result[table] = (await db.query(`select to_jsonb(t) as value from ${table} t where canonical_owner_user_id=$1 order by id`, [owner])).rows.map(row => row.value);
      }
      return result;
    }
    return { owner, other, account, nativeAccount, asset, fresh, cash, code, plan, before, snapshot };
  }
  const apply = (f, plan = f.plan) => recoverBrokerSecurities(client, plan, { write: true, confirmation: recoveryHash(plan), restoreVerified: true });

  it('executes the real dry-run writes and constraints then rolls back every row', async () => {
    const f = await fixture(), before = await f.snapshot(), queries = [];
    const observingClient = { query(sql, params) { queries.push(sql); return client.query(sql, params); } };
    const result = await recoverBrokerSecurities(observingClient, f.plan);
    assert.equal(result.status, 'dry-run'); assert.equal(result.holdings, 2); assert.equal(result.trades, 3);
    assert(queries.some(sql => sql.startsWith('insert into broker_recovery_batches')));
    assert.equal(queries.filter(sql => sql.startsWith('insert into event_ledger_entries')).length, 3);
    assert.equal(queries.at(-1), 'rollback');
    assert.deepEqual(await f.snapshot(), before);
  });

  it('applies exact evidence once while preserving cash, native state, history, IDs and unknown costs', async () => {
    const f = await fixture(), before = await f.snapshot();
    assert.equal((await apply(f)).status, 'applied');
    const after = await f.snapshot();
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.assets.find(a => a.id === f.cash), before.assets.find(a => a.id === f.cash));
    assert.deepEqual(after.daily_portfolio_snapshots, before.daily_portfolio_snapshots);
    assert.deepEqual(after.account_balance_snapshots, before.account_balance_snapshots);
    for (const old of before.event_ledger_entries) assert.deepEqual(after.event_ledger_entries.find(e => e.id === old.id), old);
    const kr = after.assets.find(a => a.id === f.asset), us = after.assets.find(a => a.id === f.fresh);
    assert.equal(Number(kr.quantity), 5); assert.equal(Number(kr.average_cost), 27000);
    assert.equal(kr.legacy_base44_id, before.assets.find(a => a.id === f.asset).legacy_base44_id);
    assert.equal(kr.fractional_krw_value, null); assert.equal(kr.fractional_avg_cost, null);
    assert.equal(Number(us.quantity), 2.5); assert.equal(us.average_cost, null); assert.equal(us.legacy_base44_id, null);
    assert.equal(Number(us.current_price), 211.25); assert.equal(us.price_status, 'ok'); assert.equal(us.price_source, 'kis_synthetic_fixture');
    const events = after.event_ledger_entries.filter(e => e.source === 'broker_recovery_v1');
    assert.equal(events.length, 3);
    const event = row => events.find(e => e.broker_recovery_data.rowId === row);
    assert.deepEqual([Number(event('test-row-1').quantity_delta), Number(event('test-row-2').quantity_delta), Number(event('test-row-3').quantity_delta)], [4, -3, 2.5]);
    assert.deepEqual([event('test-row-1').before_value, event('test-row-1').after_value, event('test-row-2').after_value, event('test-row-3').after_value].map(JSON.parse), [{ quantity: '4' }, { quantity: '8' }, { quantity: '5' }, { quantity: '2.5' }]);
    assert.equal(Number(event('test-row-1').amount_krw), 100000); assert.equal(Number(event('test-row-2').amount_krw), 90000);
    assert.equal(event('test-row-3').amount_krw, null); assert.equal(event('test-row-3').legacy_asset_id, null);
    for (const e of events) {
      assert.equal(e.price, null); assert.equal(e.fx_rate, null); assert.equal(e.native_data, null);
      assert.equal(e.broker_recovery_data.fee, null); assert.equal(e.broker_recovery_data.tax, null);
      assert.equal(e.broker_recovery_data.timePrecision, 'date_only');
    }
    assert.deepEqual(event('test-row-3').broker_recovery_data.cashSettlement, { amount: '500', currency: 'USD', date: '2026-08-05' });
    assert.equal(after.broker_recovery_batches.length, 1);
    assert.equal((await apply(f)).status, 'existing');
    assert.deepEqual(await f.snapshot(), after, 'retry must not change timestamps, quantity, events or evidence');
  });

  it('requires the exact manifest confirmation and separately verified restore before any query', async () => {
    const f = await fixture(), before = await f.snapshot(); let queries = 0;
    const observingClient = { query(...args) { queries++; return client.query(...args); } };
    await assert.rejects(recoverBrokerSecurities(observingClient, f.plan, { write: true, confirmation: '0'.repeat(64), restoreVerified: true }), /recovery_confirmation_mismatch/);
    await assert.rejects(recoverBrokerSecurities(observingClient, f.plan, { write: true, confirmation: recoveryHash(f.plan) }), /restore_not_verified/);
    assert.equal(queries, 0); assert.deepEqual(await f.snapshot(), before);
  });

  it('refuses owner mismatch and a native ledger account without touching either account', async () => {
    const f = await fixture(), before = await f.snapshot();
    await assert.rejects(apply(f, { ...f.plan, ownerId: f.other }), /recovery_account_not_unique/);
    await assert.rejects(apply(f, { ...f.plan, accountId: f.nativeAccount }), /recovery_native_account_forbidden/);
    assert.deepEqual(await f.snapshot(), before);
  });

  it('rejects a changed account state and a reused batch ID with different evidence', async () => {
    const f = await fixture();
    await db.query('update assets set quantity=7 where id=$1', [f.asset]);
    const changed = await f.snapshot();
    await assert.rejects(apply(f), /recovery_state_changed/);
    assert.deepEqual(await f.snapshot(), changed);
    const fresh = await fixture(); await apply(fresh); const saved = await fresh.snapshot();
    const edited = structuredClone(fresh.plan); edited.trades[0].evidence = ['changed synthetic evidence'];
    await assert.rejects(apply(fresh, edited), /recovery_id_conflict/);
    assert.deepEqual(await fresh.snapshot(), saved);
  });

  it('rolls back partial writes on an actual SQL failure after earlier inserts succeed', async () => {
    const f = await fixture(), before = await f.snapshot(); let inserted = 0;
    const failingClient = { async query(sql, params) {
      if (sql.startsWith('insert into event_ledger_entries') && ++inserted === 2) {
        // Raise an actual PostgreSQL error inside the open transaction.
        return client.query('select 1/0');
      }
      return client.query(sql, params);
    } };
    await assert.rejects(recoverBrokerSecurities(failingClient, f.plan, { write: true, confirmation: recoveryHash(f.plan), restoreVerified: true }), e => e.code === '22012');
    assert.equal(inserted, 2); assert.deepEqual(await f.snapshot(), before);
    assert.equal((await apply(f)).status, 'applied', 'rollback leaves the original plan retryable');
  });

  it('requires an explicit decision to clear a previous fractional display', async () => {
    const f = await fixture(), before = await f.snapshot(), unresolved = structuredClone(f.plan);
    unresolved.holdings[0].removeFractionalDisplay = false;
    await assert.rejects(apply(f, unresolved), /unresolved_fractional_display/);
    assert.deepEqual(await f.snapshot(), before);
    // A non-value-bearing existing display is preserved if removal was not requested.
    await db.query('update assets set fractional_krw_value=0,fractional_avg_cost=14000 where id=$1', [f.asset]);
    unresolved.expectedStateHash = recoveryHash(await readBrokerRecoveryState(client, f.owner, f.account));
    await apply(f, unresolved);
    const asset = (await f.snapshot()).assets.find(a => a.id === f.asset);
    assert.equal(Number(asset.fractional_krw_value), 0); assert.equal(Number(asset.fractional_avg_cost), 14000);
  });

  it('enforces tenant read isolation and denies application-role recovery writes', async () => {
    const f = await fixture(); await apply(f);
    const tenantRows = async owner => db.transaction(async tx => {
      await tx.exec('set local role varda_tenant_app');
      if (owner) await tx.query("select set_config('app.current_user_id',$1,true)", [owner]);
      return (await tx.query('select id::text from broker_recovery_batches where id=$1', [f.plan.id])).rows;
    });
    assert.equal((await tenantRows(f.owner)).length, 1);
    assert.deepEqual(await tenantRows(f.other), []); assert.deepEqual(await tenantRows(null), []);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec('set local role varda_tenant_app');
      await tx.query("select set_config('app.current_user_id',$1,true)", [f.owner]);
      await tx.query('update broker_recovery_batches set after_state=$1 where id=$2', ['{}', f.plan.id]);
    }), e => e.code === '42501');
  });

  it('rejects oversell, mismatched totals, duplicate evidence rows and inferred charges before SQL', async () => {
    const f = await fixture();
    for (const edit of [
      p => { p.trades[0].side = 'sell'; p.trades[0].quantity = '5'; },
      p => { p.holdings[1].endQuantity = '3'; },
      p => { p.trades[1].rowId = p.trades[0].rowId; },
      p => { p.trades[0].fee = { amount: '100', currency: 'KRW' }; },
      p => { p.trades[2].cashSettlement.date = '2026-08-02'; },
      p => { p.trades[2].executionGross.amount = '500.001'; },
    ]) {
      const bad = structuredClone(f.plan); edit(bad); assert.throws(() => validateBrokerRecoveryPlan(bad));
    }
  });

  it('passes the reusable SQL rehearsal cases, including generated FKs and archive lifecycle', async () => {
    const report = { cases: [] };
    await runBrokerSecuritiesCases({ admin: client, report });
    assert.equal(report.cases.length, 7);
    assert(report.cases.every(result => result.status === 'PASS'));
  });
});
