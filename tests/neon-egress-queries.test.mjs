import assert from 'node:assert/strict';
import { it } from 'node:test';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { buildPortfolioDashboardSnapshotTrend } from '../src/lib/portfolio-dashboard-snapshots.ts';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tenantContext = { ownerUserId: owner };
const scope = { kind: 'account', key: `account:${accountId}`, accountId, accountCode: 'brokerage', label: 'Brokerage' };
const holding = { id: assetId, accountId, canonicalOwnerUserId: owner, account: 'brokerage', ticker: 'TEST', market: 'us', currency: 'USD', quantity: '0.896567', assetType: 'etf', legacyBase44Id: null };
const portfolio = { snapshotDate: '2026-11-01', account: 'brokerage', totalMarketValue: '12000', totalCost: null, totalPnl: null, totalReturnPct: null, nativeEvidence: { privatePayload: 'x'.repeat(5000) } };

async function dashboardFixture({ basisRead = async () => [], accountRows = [{ id: accountId, code: 'brokerage', nativeState: {sequence: 1} }],
  all = false, targetRows, selectedAssets = [holding], selectedScope } = {}) {
  const trace = [], nativeCalls = [];
  const dialect = new PgDialect();
  const db = { select(projection) {
    const request = { projection, table: null, predicate: null };
    const builder = {
      from(table) { request.table = getTableName(table); return builder; },
      innerJoin() { return builder; },
      where(predicate) { request.predicate = dialect.sqlToQuery(predicate); return builder; },
      orderBy() { return builder; }, limit() { return builder; },
      then(resolve, reject) {
        trace.push(request);
        let rows = request.table === 'assets' ? selectedAssets
          : request.table === 'accounts' ? accountRows
          : request.table === 'daily_portfolio_snapshots' ? [portfolio]
          : request.table === 'live_price_quotes' ? [{ ticker: 'TEST', price: '100.125', currency: 'USD' }]
          : request.projection?.count ? [{ count: 0 }] : [];
        if (projection) rows = rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key]])));
        return Promise.resolve(rows).then(resolve, reject);
      },
    }; return builder;
  } };
  const [reader] = await importWithPorts(['src/db/queries/portfolio-dashboard.ts'], {
    '@/db/client': { db },
    '@/db/queries/portfolio-analysis-scope-targets': { getPortfolioAnalysisScopeTargets: async () => targetRows ?? ({ includesAllOwnedAccounts: all, wholeAccountIds: [accountId], directAssetIds: [] }) },
    '@/db/queries/tenant-group-reads': { loadActiveTenantAllocationGroups: async () => [] },
    '@/db/queries/tenant-settings': { loadLatestTenantPortfolioSettingsRows: async () => [{ usdKrwRate: '1400' }] },
    '@/db/queries/portfolio-fx-rates': { loadUsablePortfolioFxRows: async () => [{ rateDate: '2026-11-01', usdKrw: '1400' }] },
    '@/db/queries/native-investment-basis': { loadNativeInvestmentBasis: async (...args) => { nativeCalls.push('basis'); return basisRead(...args); } },
    '@/db/queries/native-legacy-trades': {
      loadNativeHoldingCosts: async () => { nativeCalls.push('cost'); return []; },
      loadNativeLegacyTrades: async () => { nativeCalls.push('trades'); return []; },
    },
  });
  return { trace, nativeCalls, read: (sourceMode, includeInvestmentReturn) => reader.getReadOnlyTenantPortfolioDashboardSources({ tenantContext, includeInvestmentReturn,
    scope: selectedScope ?? (all ? {kind: 'all', key: 'all', label: 'All'} : scope), serviceDate: '2026-11-02', sourceMode }) };
}

it('valuation demand preserves scoped fractional holdings, quotes and FX without downloading unused dashboard history', async () => {
  const full = await dashboardFixture(), current = await dashboardFixture();
  const before = await full.read(), after = await current.read('valuation', true);
  assert.equal(before.investmentReturnBasis, null);
  for (const key of ['accountRows', 'assetRows', 'settingsRows', 'recentFxRows', 'liveQuoteRows']) assert.deepEqual(after[key], before[key], key);
  assert.equal(after.assetRows[0].quantity, '0.896567');
  assert.deepEqual(after.recentPortfolioRows, []);
  assert.deepEqual(after.recentPositionRows, []);
  assert.deepEqual(after.eventRows, []);
  assert.equal(after.investmentReturnBasis, null);
  assert.deepEqual(current.nativeCalls, []);
  const tables = current.trace.map(read => read.table);
  for (const table of ['daily_portfolio_snapshots', 'daily_position_snapshots', 'event_ledger_entries', 'asset_price_snapshots']) assert.equal(tables.includes(table), false, table);
  const assets = current.trace.find(read => read.table === 'assets');
  assert.ok(assets.predicate.params.includes(owner));
  assert.ok(assets.predicate.params.includes(accountId));
  assert.deepEqual(full.nativeCalls, ['basis', 'cost', 'trades']);
});

it('full dashboard excludes native payloads in SQL and its smaller snapshot projection preserves null-aware trends', async () => {
  const f = await dashboardFixture(), result = await f.read();
  const events = f.trace.find(read => read.table === 'event_ledger_entries');
  assert.match(events.predicate.sql, /"event_ledger_entries"\."native_data" is null/);
  assert.ok(events.predicate.params.includes(owner));
  assert.ok(events.predicate.params.includes(accountId));
  assert.equal('nativeEvidence' in result.recentPortfolioRows[0], false);
  assert.deepEqual(buildPortfolioDashboardSnapshotTrend(result.recentPortfolioRows), buildPortfolioDashboardSnapshotTrend([portfolio]));
  assert.equal(buildPortfolioDashboardSnapshotTrend(result.recentPortfolioRows)[0].totalPnl, null);
});

it('fails closed for stale or unavailable scoped ledger evidence while healthy and legacy accounts stay comparable', async () => {
  const healthy = {id: accountId, code: 'brokerage', nativeState: {sequence: 3}};
  const stale = {id: assetId, code: 'isa', nativeState: {sequence: 2}};
  const legacy = {id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', code: 'savings', nativeState: null};
  const scopeRead = await dashboardFixture({accountRows: [healthy, stale, legacy], all: true,
    basisRead: async () => [{accountId, sourceSequence: 3, splits: []}, {accountId: assetId, sourceSequence: 1, splits: []}]});
  const result = await scopeRead.read('full', true);
  assert.deepEqual(result.movementEventRows.map(row => [row.account, row.eventType]), [['isa', 'ledger_evidence_unavailable']]);
  assert.equal(result.investmentReturnBasis, null);
  const basisReads = [];
  const failed = await dashboardFixture({ accountRows: [healthy, stale, legacy], basisRead: async (context, asOf, inclusive, selectedId) => {
    basisReads.push([context.ownerUserId, selectedId]);
    throw new Error('isolated injected failure');
  }});
  const failedResult = await failed.read('full', true);
  assert.deepEqual(failedResult.movementEventRows.map(row => row.account), ['brokerage']);
  assert.equal(failedResult.investmentReturnBasis, null);
  assert.deepEqual(basisReads, [[owner, accountId]]);
});

it('shares one verified ledger read for cost and trades, exposing only the selected group holdings and cost fields', async () => {
  const selected = {assetId, currency: 'USD', quantity: '0.896567', costKrw: '828000'};
  const privateId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const otherSelected = {...selected, assetId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', costKrw: null};
  const resultRows = [{accountId, sourceSequence: 1, splits: [], trades: [{memo: 'private'}], positions: [
    {...selected, costLots: ['private']}, otherSelected, {...selected, assetId: privateId}]},
    {accountId: privateId, sourceSequence: 2, splits: [], positions: [{...selected, costKrw: '1'}]}];
  const selectedGroup = await dashboardFixture({ basisRead: async () => resultRows, selectedAssets: [holding, {...holding, id: otherSelected.assetId}],
    selectedScope: {kind: 'portfolio_group', portfolioGroupId: privateId, key: 'group', label: 'Group'},
    targetRows: {includesAllOwnedAccounts: false, wholeAccountIds: [], directAssetIds: [assetId, otherSelected.assetId]} });
  assert.deepEqual((await selectedGroup.read('full', true)).investmentReturnBasis, {positions: [selected, otherSelected]});
  assert.deepEqual(selectedGroup.nativeCalls, ['basis', 'cost', 'trades']);

  const legacy = await dashboardFixture({ accountRows: [{id: accountId, code: 'brokerage', nativeState: null}] });
  assert.deepEqual((await legacy.read('full', true)).investmentReturnBasis, {positions: []});
  assert.deepEqual(legacy.nativeCalls, []);
});

it('SQL event filtering preserves legacy SQL-null and JSON-null rows while excluding native state', async () => {
  const f = await dashboardFixture(); await f.read();
  const { sql, params } = f.trace.find(read => read.table === 'event_ledger_entries').predicate;
  const local = new PGlite();
  try {
    await local.exec(`create table accounts (id uuid, canonical_owner_user_id uuid, is_active boolean, code text);
      create table event_ledger_entries (id text, account_id uuid, asset_id uuid, legacy_asset_id text, account text, is_sample boolean,
        event_date date, native_data jsonb, canonical_owner_user_id uuid, source text, broker_recovery_data jsonb);`);
    await local.query('insert into accounts values ($1,$2,true,\'brokerage\')', [accountId, owner]);
    for (const [id, payload] of [['sql-null', null], ['json-null', 'null'], ['native-state', '{"state":{"positions":[]}}']]) {
      await local.query('insert into event_ledger_entries values ($1,$2,$3,null,\'brokerage\',false,\'2026-11-01\',$4::jsonb,$5,null,null)', [id, accountId, assetId, payload, owner]);
    }
    await local.query(`insert into event_ledger_entries values
      ('wrong-owner',$1,$2,null,'brokerage',false,'2026-11-01',null,$2,null,null),
      ('overnight',$1,$2,null,'brokerage',false,'2026-11-03',null,$3,'broker_recovery_v1','{"executedAt":"2026-11-03T01:00:00+09:00"}'),
      ('tomorrow-date-only',$1,$2,null,'brokerage',false,'2026-11-03',null,$3,'broker_recovery_v1','{}')`, [accountId, assetId, owner]);
    const result = await local.query(`select event_ledger_entries.id from event_ledger_entries join accounts on accounts.id=event_ledger_entries.account_id where ${sql} order by event_ledger_entries.id`, params);
    assert.deepEqual(result.rows.map(row => row.id), ['json-null', 'overnight', 'sql-null']);
  } finally { await local.close(); }
});

async function nativeFixture({ entriesComplete = true } = {}) {
  const requests = [];
  const accounts = [{ id: accountId, state: { positions: [{ assetId, quantity: '0.896567' }] } }];
  const entries = [{ id: 'event', accountId, data: { event: { type: 'opening' }, state: accounts[0].state } }];
  const snapshots = [{ accountId, evidence: { immutable: true } }];
  const sql = { transaction: async (callback, options) => {
    assert.equal(options.readOnly, true);
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return Promise.all(callback({ query: (text, params) => {
      requests.push({ text, params });
      if (text.startsWith('select set_config')) return [];
      if (text.startsWith('select a.id')) return accounts;
      if (text.includes('from effective_native_ledger_entries')) return [{ complete: entriesComplete, rows: entries }];
      if (text.includes('from daily_portfolio_snapshots')) return [{ complete: true, rows: snapshots }];
      throw Error('unexpected SQL');
    } }));
  } };
  const [reader] = await importWithPorts(['src/db/queries/native-portfolio-ledger.ts'], { '@/db/tenant-client': { getTenantSqlClient: () => sql } });
  return { reader, requests, accounts, entries, snapshots };
}

it('investment ledger reads omit snapshots without claiming missing history is complete', async () => {
  const f = await nativeFixture();
  const result = await f.reader.readNativeLedger(tenantContext, accountId, { includeSnapshots: false });
  assert.deepEqual(result.accounts, f.accounts);
  assert.deepEqual(result.entries, f.entries);
  assert.deepEqual(result.snapshots, []);
  assert.equal(result.historyComplete, false);
  assert.equal(result.entriesComplete, true);
  assert.equal(f.requests.some(row => row.text.includes('from daily_portfolio_snapshots')), false);
  assert.ok(f.requests.every(row => row.params[0] === owner));
  assert.equal(f.requests.find(row => row.text.includes('from effective_native_ledger_entries')).params[1], accountId);
});

it('default ledger retains complete snapshot evidence and refuses incomplete events in either mode', async () => {
  const f = await nativeFixture();
  const result = await f.reader.readNativeLedger(tenantContext, accountId);
  assert.equal(result.historyComplete, true);
  assert.deepEqual(result.snapshots, f.snapshots);
  for (const includeSnapshots of [false, true]) {
    const incomplete = await nativeFixture({ entriesComplete: false });
    const blocked = await incomplete.reader.readNativeLedger(tenantContext, accountId, { includeSnapshots });
    assert.equal(blocked.entriesComplete, false);
    assert.equal(blocked.historyComplete, false);
    assert.deepEqual(blocked.entries, []);
    assert.deepEqual(blocked.snapshots, []);
  }
});

it('investment-basis caller explicitly omits unused history while still rejecting an incomplete ledger', async () => {
  const calls = [];
  let complete = true;
  const [reader] = await importWithPorts(['src/db/queries/native-investment-basis.ts'], {
    '@/db/queries/native-portfolio-ledger': { readNativeLedger: async (...args) => {
      calls.push(args);
      return { accounts: [], entries: [], snapshots: [], accountsComplete: true, entriesComplete: complete, historyComplete: false };
    } },
    '@/db/client': { sqlClient: { query() { throw Error('An empty ledger must not read historical FX'); } } },
  });
  assert.deepEqual(await reader.loadNativeInvestmentBasis(tenantContext), []);
  assert.deepEqual(calls[0], [tenantContext, undefined, { includeSnapshots: false }]);
  complete = false;
  await assert.rejects(reader.loadNativeInvestmentBasis(tenantContext), /investment_history_incomplete/);
});

async function targetFixture() {
  const trace = { structures: [], policies: [], queries: [] };
  let value = 12000, policyStatus = 'missing';
  const row = { accountCode: 'brokerage', accountId, accountName: 'Brokerage', assetId, assetName: 'TEST', assetType: 'etf', market: 'us', currency: 'USD', ticker: 'TEST', quantity: '0.896567', currentPrice: '100', averageCost: null, fractionalKrwValue: null, fractionalAvgCost: null };
  const db = { select(projection) {
    let table, predicate;
    const chain = { from(input) { table = getTableName(input); return chain; }, innerJoin() { return chain; }, where(input) { predicate = new PgDialect().sqlToQuery(input); return chain; }, orderBy() { return chain; }, limit() { return chain; },
      then(resolve, reject) {
        trace.queries.push({ table, predicate });
        const rows = table === 'accounts' ? [{ id: accountId, code: 'brokerage', name: 'Brokerage' }] : [{ ...row }];
        return Promise.resolve(rows.map(item => Object.fromEntries(Object.keys(projection).map(key => [key, item[key]])))).then(resolve, reject);
      } };
    return chain;
  } };
  const [reader, beta] = await importWithPorts(['src/db/queries/portfolio-target-policy.ts', 'src/lib/cairn-v2/target-plan-read.ts'], {
    '@/db/client': { db },
    '@/db/queries/portfolio-analysis-scope-targets': { getPortfolioAnalysisScopeTargets: async args => ({ includesAllOwnedAccounts: false, wholeAccountIds: [args.scope.accountId], directAssetIds: [] }) },
    '@/db/queries/portfolio-structure': { getReadOnlyTenantPortfolioStructureForScope: async args => {
      trace.structures.push(args);
      return { holdingRows: [{ ...row, account: row.accountCode, name: row.assetName, currentValueKrw: value }], groupRows: [], usdKrwRate: 1400, dataHealth: {} };
    } },
    '@/db/queries/tenant-target-policies': { loadCurrentTenantPortfolioTargetPolicy: async args => {
      trace.policies.push(args); return { status: policyStatus, policy: null };
    } },
  });
  return { reader, beta, trace, change() { value = 13000; policyStatus = 'conflict'; } };
}

it('beta initial target and structure share valuation once, but later policy and valuation checks remain fresh', async () => {
  for (const targetFirst of [true, false]) {
    const f = await targetFixture(), ports = f.beta.createBetaInitialTargetReadPorts();
    const args = { tenantContext, scope, serviceDate: '2026-11-02' };
    const first = targetFirst ? ports.targets(args) : ports.structure(args);
    const second = targetFirst ? ports.structure(args) : ports.targets(args);
    const results = await Promise.all([first, second]);
    const before = results[targetFirst ? 0 : 1];
    assert.equal(before.rows[0].currentValueKrw, 12000);
    assert.equal(f.trace.structures.length, 1);
    assert.equal(f.trace.policies.length, 1);
    assert.equal(f.trace.queries.length, 3);
    f.change();
    const after = await ports.targets(args);
    assert.equal(after.rows[0].currentValueKrw, 13000);
    assert.equal(after.policyValidation.status, 'conflict');
    assert.equal(f.trace.structures.length, 2);
    assert.equal(f.trace.policies.length, 2);
    assert.equal(f.trace.queries.length, 6, 'account and holding identity checks stay fresh too');
    assert.ok(f.trace.queries.every(read => read.predicate.params.includes(owner)));
    const freshRequest = f.beta.createBetaInitialTargetReadPorts();
    await freshRequest.targets(args);
    assert.equal(f.trace.structures.length, 3, 'another request never reuses the old valuation');
  }
});

it('initial structure sharing never crosses owners, account scopes, service dates or roles', async () => {
  const f = await targetFixture(), ports = f.reader.createInitialPortfolioTargetReadPorts();
  const args = { tenantContext, scope, serviceDate: '2026-11-02' };
  await ports.structure(args);
  await ports.structure({ ...args });
  assert.equal(f.trace.structures.length, 1);
  for (const changed of [
    { ...args, tenantContext: { ownerUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } },
    { ...args, scope: { ...scope, accountId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } },
    { ...args, serviceDate: '2026-11-03' },
    { ...args, tenantContext: { ...tenantContext, role: 'admin' } },
  ]) await ports.structure(changed);
  assert.equal(f.trace.structures.length, 5);
  await f.reader.getReadOnlyTenantPortfolioTargetPolicyModel(args);
  await f.reader.getReadOnlyTenantPortfolioTargetPolicyModel(args);
  assert.equal(f.trace.structures.length, 7, 'canonical standalone reads always recheck current evidence');
});
