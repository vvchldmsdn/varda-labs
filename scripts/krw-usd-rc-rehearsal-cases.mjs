import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { sqlTransport } from './krw-usd-rc-rehearsal.mjs';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account = '11111111-1111-4111-8111-111111111111', peer = '22222222-2222-4222-8222-222222222222';
const foreign = '33333333-3333-4333-8333-333333333333', legacy = '99999999-9999-4999-8999-999999999999';
const asset = '44444444-4444-4444-8444-444444444444';
const openingAt = '2026-08-01T00:00:00Z', eventAt = '2026-08-02T00:00:00Z';
const lockName = id => `varda.portfolio_mutation.v1:${id}`;

async function legacyRows(db) {
  return {
    accounts: (await db.query("select to_jsonb(a)-'native_state' as row from accounts a order by id")).rows,
    drafts: (await db.query('select * from portfolio_drafts order by id')).rows,
    plans: (await db.query('select * from investment_plans order by id')).rows,
    fx: (await db.query("select to_jsonb(f)-'observed_at'-'rate_kind' as row from fx_rates f order by id")).rows,
    budgets: (await db.query("select to_jsonb(b)-'provider'-'window_credits'-'credit_count' as row from market_provider_budgets b")).rows,
    ledger: (await db.query("select to_jsonb(e)-'native_data'-'native_sequence'-'native_operation_id' as row from event_ledger_entries e order by id")).rows,
  };
}

export async function seedLegacy(db) {
  await db.query("insert into app_users(id,status) values($1,'active'),($2,'active')", [owner, other]);
  for (const [id, user, code] of [[account, owner, 'rc-one'], [peer, owner, 'rc-two'], [foreign, other, 'rc-other'], [legacy, owner, 'rc-legacy']]) {
    await db.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,$3,'brokerage','KRW')", [id, user, code]);
  }
  await db.query("insert into portfolio_drafts(owner_user_id,id,input_json,engine_version) values($1,$2,'{\"synthetic\":true,\"amount\":100000}', 'amount_composition_v1')", [owner, randomUUID()]);
  await db.query("insert into investment_plans(owner_user_id,id,input_json,engine_version) values($1,$2,'{\"synthetic\":true}', 'deficit_proportional_capped_v1')", [owner, randomUUID()]);
  await db.query("insert into fx_rates(date,usdkrw,source) values('2026-07-31','1398.123456','rc_legacy')");
  await db.query('insert into market_provider_budgets(scope_hash) values($1)', ['0'.repeat(64)]);
  await db.query("insert into event_ledger_entries(canonical_owner_user_id,event_date,event_type,source,account,account_id,legacy_asset_id,asset_name,before_value,after_value) values($1,'2026-07-31','rc_legacy','base44_import','rc-legacy',$2,'rc-legacy-id','Synthetic legacy','100000','100000')", [owner, legacy]);
  return legacyRows(db);
}

export async function verifyLegacy(db, before) {
  assert.deepEqual(await legacyRows(db), before, '0048..0053 must preserve existing KRW values and JSON');
  assert.equal((await db.query('select count(*)::int as n from accounts where native_state is not null')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from fx_rates where observed_at is not null or rate_kind is not null')).rows[0].n, 0);
  assert.deepEqual((await db.query('select provider,window_credits,credit_count::text from market_provider_budgets')).rows, [{ provider: 'kis', window_credits: 0, credit_count: '0' }]);
}

async function waitForLockWaiters(admin, count) {
  const until = Date.now() + 1200;
  while (Date.now() < until) {
    const result = await admin.query("select count(distinct pid)::int as n from pg_locks where locktype='advisory' and not granted");
    if (result.rows[0].n >= count) return;
    await delay(15);
  }
  assert.fail(`expected_${count}_simultaneous_advisory_waiters`);
}

async function behindOwnerLock(admin, id, action, waiterCount = 2) {
  const blocker = await admin.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [lockName(id)]);
    // Attach rejection handling immediately; this is an actual pair of TCP transactions.
    pending = Promise.allSettled(action());
    await waitForLockWaiters(admin, waiterCount);
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const results = await pending;
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map(result => result.value);
}

async function behindJobRowLock(admin, key, action) {
  const blocker = await admin.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('select key from market_collection_jobs where key=$1 for update', [key]);
    pending = Promise.allSettled(action());
    const until = Date.now() + 1200;
    let waiting = false;
    while (Date.now() < until) {
      const row = (await admin.query("select count(*)::int as n from pg_stat_activity where usename='rc_writer' and wait_event_type='Lock'")).rows[0];
      if (row.n >= 2) { waiting = true; break; }
      await delay(15);
    }
    assert.equal(waiting, true, 'both persistence connections must wait on the held job row');
  } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const results = await pending;
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return results.map(result => result.value);
}

export async function runCases({ admin, worker, tenant, report }) {
  const sessions = new Set();
  const transport = sqlTransport(worker, sessions), tenantTransport = sqlTransport(tenant, sessions);
  const [ledger, snapshots, projection] = await importWithPorts([
    'src/db/queries/native-portfolio-ledger.ts', 'src/db/queries/native-portfolio-snapshots.ts', 'src/lib/native-portfolio-projection.ts',
  ], { '@/db/client': { sqlClient: transport }, '@/db/tenant-client': { getTenantSqlClient: () => tenantTransport } });
  async function check(name, callback) {
    const result = { name, status: 'FAIL' }; report.cases.push(result);
    await callback(); result.status = 'PASS';
  }
  const read = (id = account, user = owner) => ledger.readNativeLedger({ ownerUserId: user }, id);
  const write = (input, user = owner) => ledger.writeNativeMutation({ ownerUserId: user }, input);
  const open = (id, user = owner, amount = '1000') => write({ operationId: randomUUID(), accountId: id, expectedSequence: null,
    opening: { at: openingAt, cash: { KRW: '0', USD: amount }, positions: [] } }, user);
  const deposit = (sequence, amount = '0.25', id = account) => ({ operationId: randomUUID(), accountId: id, expectedSequence: sequence,
    event: { type: 'deposit', at: eventAt, amount, currency: 'USD' } });

  await check('runtime-roles-and-function-authority', async () => {
    const roles = (await admin.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('varda_tenant_app','rc_writer') order by rolname")).rows;
    assert.deepEqual(roles, [{ rolname: 'rc_writer', rolsuper: false, rolbypassrls: true }, { rolname: 'varda_tenant_app', rolsuper: false, rolbypassrls: false }]);
    const fn = (await admin.query("select prosecdef,proconfig from pg_proc where proname='apply_native_portfolio_mutation'")).rows[0];
    assert.equal(fn.prosecdef, false); assert.ok(fn.proconfig.includes('search_path=pg_catalog, public'));
    await assert.rejects(tenant.query('select apply_native_portfolio_mutation($1,$2,$3,$4)', [owner, randomUUID(), '{}', '[]']), error => error.code === '42501');
  });
  await check('rls-owner-boundary-and-local-context-reset', async () => {
    assert.equal((await tenant.query('select count(*)::int as n from accounts')).rows[0].n, 0);
    assert.equal((await read(account, other)).accounts.length, 0);
    assert.equal((await read(foreign, owner)).accounts.length, 0);
    assert.equal((await read(foreign, other)).accounts.length, 1);
    await assert.rejects(tenant.query("update accounts set name='invalid' where id=$1", [account]), error => error.code === '42501');
    assert.equal((await tenant.query('select count(*)::int as n from accounts')).rows[0].n, 0, 'transaction-local owner context must not leak from a pooled session');
    assert.equal((await open(account)).status, 'created'); assert.equal((await open(peer)).status, 'created'); assert.equal((await open(foreign, other)).status, 'created');
  });
  await check('same-event-concurrent-retry-exactly-once', async () => {
    const input = deposit(0);
    const results = await behindOwnerLock(admin, owner, () => [write(input), write(input)]);
    assert.deepEqual(results.map(result => result.status).sort(), ['created', 'existing']);
    const result = await read(); assert.equal(result.accounts[0].state.cash.USD, '1000.25'); assert.equal(result.entries.length, 2);
    assert.equal((await write({ ...input, event: { ...input.event, amount: '0.50' } })).status, 'conflict');
  });
  await check('same-owner-concurrent-stale-sequence-conflict', async () => {
    const results = await behindOwnerLock(admin, owner, () => [write(deposit(1)), write(deposit(1))]);
    assert.deepEqual(results.map(result => result.status).sort(), ['conflict', 'created']);
    assert.equal((await read()).accounts[0].state.cash.USD, '1000.5');
    assert.equal((await read()).accounts[0].state.sequence, 2);
  });
  await check('different-owner-write-proceeds-while-owner-lock-held', async () => {
    const blocker = await admin.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [lockName(owner)]);
      // The writer has its own 2-second lock timeout; owner B must finish before owner A is unlocked.
      assert.equal((await write(deposit(0, '0.75', foreign), other)).status, 'created');
      assert.equal((await read(foreign, other)).accounts[0].state.cash.USD, '1000.75');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  await check('repeatable-read-and-read-committed-snapshots', async () => {
    const first = await tenant.connect();
    try {
      await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await first.query("select set_config('app.current_user_id',$1,true)", [owner]);
      const query = 'select native_state from accounts where id=$1';
      const before = (await first.query(query, [account])).rows[0];
      assert.equal((await write(deposit(2))).status, 'created');
      assert.deepEqual((await first.query(query, [account])).rows[0], before);
      await first.query('COMMIT');
      assert.equal((await read()).accounts[0].state.sequence, 3);
    } finally { await first.query('ROLLBACK'); first.release(); }
  });
  await check('decimal-quantity-and-unique-event-constraint', async () => {
    const input = { operationId: randomUUID(), accountId: account, expectedSequence: 3,
      event: { type: 'buy', at: eventAt, assetId: asset, quantity: '0.000001', price: '10000', currency: 'USD' },
      newAsset: { id: asset, name: 'Synthetic rehearsal asset', ticker: 'TEST', market: 'us', currency: 'USD', assetType: 'stock' } };
    assert.equal((await write(input)).status, 'created');
    assert.equal((await admin.query('select quantity::text as quantity from assets where id=$1', [asset])).rows[0].quantity, '0.000001');
    assert.equal((await read()).accounts[0].state.cash.USD, '1000.74');
    await assert.rejects(admin.query(`insert into event_ledger_entries(id,canonical_owner_user_id,event_date,event_type,source,account_id,legacy_asset_id,asset_name,before_value,after_value,native_sequence,native_operation_id,native_data)
      select gen_random_uuid(),canonical_owner_user_id,event_date,event_type,source,account_id,legacy_asset_id,asset_name,before_value,after_value,native_sequence,gen_random_uuid(),native_data from event_ledger_entries where native_operation_id=$1`, [input.operationId]), error => error.code === '23505');
    await assert.rejects(admin.query('update assets set quantity=quantity+1 where id=$1', [asset]), error => error.code === 'N0001');
    assert.equal((await read()).accounts[0].state.positions[0].quantity, '0.000001');
  });
  await check('snapshot-transfer-concurrency-fence', async () => {
    const captureAt = new Date().toISOString();
    const peerLedger = await read(peer);
    const evidence = projection.attachNativeLedgerEvidence({ ownerId: owner, reporting: 'USD', asOf: captureAt,
      current: { at: captureAt, source: 'isolated fixture', scopeComplete: false, positions: [] }, history: [], trades: null, fx: [], maxFxAgeMs: 0, maxPriceAgeMs: 0 }, peerLedger, 'account');
    const input = { operationId: randomUUID(), accountId: account, expectedSequence: 4,
      event: { type: 'transfer', direction: 'out', at: new Date(Date.parse(captureAt) - 1000).toISOString(), amount: '10', currency: 'USD', peerAccountId: peer } };
    input.event.transferId = input.operationId;
    // Hold the owner lock in the snapshot transport after both writers have read.
    const blocker = await admin.connect();
    let transfer;
    try {
      await blocker.query('BEGIN'); await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [lockName(owner)]);
      transfer = write(input); transfer.catch(() => {});
      await waitForLockWaiters(admin, 1);
      const captureTransport = { ...transport, transaction: async (build) => {
        const results = []; for (const command of build({ query: (text, parameters = []) => ({ text, parameters }) })) results.push((await blocker.query(command.text, command.parameters)).rows);
        return results;
      } };
      const [capturing] = await importWithPorts(['src/db/queries/native-portfolio-snapshots.ts'], { '@/db/client': { sqlClient: captureTransport } });
      assert.equal((await capturing.saveNativeSnapshots({ ownerUserId: owner }, evidence)).created, 1);
      await blocker.query('COMMIT');
      assert.deepEqual(await transfer, { status: 'invalid', reason: 'event_precedes_recorded_snapshot' });
      assert.equal((await read()).accounts[0].state.sequence, 4);
      assert.equal((await read(peer)).accounts[0].state.cash.USD, '1000');
      assert.equal((await snapshots.saveNativeSnapshots({ ownerUserId: owner }, evidence)).created, 0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); if (transfer) await Promise.allSettled([transfer]); }
  });
  await check('force-rls-applies-to-non-bypass-table-owner', async () => {
    const tables = ['market_provider_reservations', 'market_provider_observations', 'market_provider_action_coverage', 'market_provider_corporate_actions', 'native_contribution_plans'];
    for (const table of tables) {
      const row = (await admin.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass', [table])).rows[0];
      assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true });
    }
    const doc = { version: 'native_contribution_plan_v1', result: { context: { profitCurrency: 'USD', reportingCurrency: 'USD' } } };
    await admin.query("insert into native_contribution_plans(owner_user_id,id,scope_key,reporting_currency,request_json,document_json) values($1,$2,'all','USD','{}',$3)", [owner, randomUUID(), doc]);
    await admin.query('ALTER TABLE native_contribution_plans OWNER TO rc_table_owner');
    const client = await admin.connect();
    try {
      await client.query('BEGIN; SET LOCAL ROLE rc_table_owner');
      assert.equal((await client.query('select count(*)::int as n from native_contribution_plans')).rows[0].n, 0);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    const rows = await tenantTransport.transaction(tx => [tx.query("select set_config('app.current_user_id',$1,true)", [other]), tx.query('select * from native_contribution_plans')]);
    assert.deepEqual(rows[1], []);
    const own = await tenantTransport.transaction(tx => [tx.query("select set_config('app.current_user_id',$1,true)", [owner]), tx.query('select * from native_contribution_plans')]);
    assert.equal(own[1].length, 1);
  });
  await check('timezone-instant-and-microseconds', async () => {
    const client = await tenant.connect();
    try {
      await client.query("BEGIN; SET LOCAL TIME ZONE 'America/New_York'");
      const row = (await client.query("select $1::timestamptz=$2::timestamptz as same,extract(microseconds from $1::timestamptz)::text as micros", ['2026-09-01T07:00:00.123456+09:00', '2026-08-31T22:00:00.123456Z'])).rows[0];
      assert.deepEqual(row, { same: true, micros: '123456' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await providerCases({ admin, transport, check, tenant });
  assert.ok(sessions.size >= 3, 'multiple TCP backend sessions must actually be used');
  report.distinctBackendSessions = sessions.size;
}

async function providerCases({ admin, transport, check, tenant }) {
  const listing = { instrumentKey: 'us:ARCX:VOO', ticker: 'VOO', symbol: 'VOO', micCode: 'ARCX', exchange: 'NYSE', type: 'ETF', currency: 'USD', exchangeTimezone: 'America/New_York' };
  const target = { key: listing.instrumentKey, ticker: 'VOO', market: 'us', currency: 'USD', accounts: [], assetIds: [], assetNames: [] };
  const timestamp = Math.floor(Date.now() / 1000) - 30;
  const http = async endpoint => {
    const meta = { symbol: 'VOO', currency: 'USD', exchange: 'NYSE', mic_code: 'ARCX', exchange_timezone: 'America/New_York', type: 'ETF', interval: '1day' };
    if (endpoint === '/quote') return { ...meta, close: '500.123456789123456789', last_quote_at: timestamp };
    if (endpoint === '/time_series') return { meta, values: [{ datetime: '2026-08-10', close: '100.01' }] };
    if (endpoint === '/splits') return { meta, splits: [{ date: '2026-08-10', ratio: 2, from_factor: 1, to_factor: 2 }] };
    if (endpoint === '/dividends') return { meta, dividends: [] };
    throw new Error('unexpected_fixture_http');
  };
  const [queue, collector, adapter, store, budget] = await importWithPorts([
    'src/lib/market-data/collection-queue.ts', 'src/lib/market-data/twelve-data-collection.ts', 'src/lib/market-data/providers/twelve-data.ts',
    'src/lib/market-data/twelve-data-store.ts', 'src/lib/market-data/twelve-data-budget.ts',
  ], { '@/db/client': { sqlClient: transport }, './twelve-data-http': { fetchTwelveDataPayload: http }, 'next/server': { after: () => {} } });
  const config = { provider: { mode: 'live', apiKey: 'local-fixture-no-credential', listings: [listing], audience: 'internal_validation',
    license: { status: 'confirmed', reference: 'local-fixture-only', cacheScope: 'rc-local', expiresAt: new Date(Date.now() + 86400000),
      datasets: ['us_quote', 'us_daily_raw', 'us_splits', 'us_dividends'], audiences: ['internal_validation'], quoteDelay: 'delayed' },
    release: { approved: true, reference: 'local-fixture-only' } },
    budget: { httpRequestsPerMinute: 100, apiCreditsPerMinute: 200, minimumIntervalMs: 0 },
    storage: { retentionSeconds: 86400, quoteFreshSeconds: 600, fxFreshSeconds: 600, historyFreshSeconds: 3600 },
    isFresh: async () => false, persist: async () => 'written' };
  const provider = adapter.createTwelveDataMarketDataProvider({ ...config.provider, reserve: async () => true });
  async function claim(input) {
    const [job] = collector.getTwelveDataCollectionJobs([input], config);
    const partition = { provider: 'twelve_data', scopeHash: job.key.split(':')[1] };
    await Promise.all([queue.enqueueProviderCollectionJobs(partition, [job]), queue.enqueueProviderCollectionJobs(partition, [job])]);
    const claimed = await Promise.all([queue.claimMarketCollection(partition), queue.claimMarketCollection(partition)]);
    assert.equal(claimed.filter(Boolean).length, 1);
    assert.equal((await admin.query('select request_count from market_collection_jobs where key=$1', [job.key])).rows[0].request_count, 2);
    return claimed.find(Boolean);
  }
  await check('duplicate-provider-quote-job-claim-persist-query', async () => {
    const job = await claim({ kind: 'live', target });
    const quotes = await provider.fetchLiveQuotes([target], { requestedAt: new Date(), dryRun: false });
    const payload = { dataset: 'us_quote', target, listing, rows: quotes.rows };
    assert.deepEqual(await behindJobRowLock(admin, job.key, () => [store.persistTwelveDataEvidence(job, payload, config), store.persistTwelveDataEvidence(job, payload, config)]), ['written', 'written']);
    assert.equal((await admin.query("select count(*)::int as n from market_provider_observations where dataset='us_quote'")).rows[0].n, 1);
    const evidence = await store.queryTwelveDataEvidence({ kind: 'live', target, asOf: new Date().toISOString() }, config);
    assert.equal(evidence.status, 'admitted'); assert.equal(evidence.prices[0].value, '500.123456789123456789');
    assert.equal(evidence.prices[0].observedAt, new Date(timestamp * 1000).toISOString());
    await queue.finishMarketCollection(job, { ok: true, code: 'collected' });
    assert.equal(await store.persistTwelveDataEvidence(job, payload, config), 'stale_claim');
  });
  await check('same-corporate-action-concurrent-retry-and-row-lock', async () => {
    const job = await claim({ kind: 'history', target, startDate: '2026-08-10', endDate: '2026-08-10' });
    const requestedAt = new Date();
    assert.equal(job.startDate, '2026-06-06'); assert.equal(job.endDate, '2026-08-10');
    const prices = await provider.fetchHistoricalClosePrices([target], { requestedAt, dryRun: false, startDate: job.startDate, endDate: job.endDate });
    const actions = [];
    for (const type of ['split', 'dividend']) actions.push((await provider.fetchCorporateActions(target, type, job.startDate, job.endDate, requestedAt)).coverage);
    const payload = { dataset: 'us_daily_raw', target, listing, rows: prices.rows, actions };
    assert.deepEqual(await behindJobRowLock(admin, job.key, () => [store.persistTwelveDataEvidence(job, payload, config), store.persistTwelveDataEvidence(job, payload, config)]), ['written', 'written']);
    const row = (await admin.query('select count(*)::int as n,min(from_factor)::text as before,min(to_factor)::text as after from market_provider_corporate_actions')).rows[0];
    assert.deepEqual(row, { n: 1, before: '1.000000000000000000', after: '2.000000000000000000' });
    const evidence = await store.queryTwelveDataEvidence({ kind: 'history', target, startDate: '2026-08-10', endDate: '2026-08-10', asOf: new Date().toISOString() }, config);
    assert.equal(evidence.corporateActions.length, 1); assert.equal(evidence.analysisEligible, false);
    assert.equal(evidence.corporateActions[0].date, '2026-08-10'); assert.equal(evidence.prices[0].exchangeDate, '2026-08-10');
    await queue.finishMarketCollection(job, { ok: true, code: 'collected' });
  });
  await check('duplicate-credit-reservation-and-provider-rls', async () => {
    const scope = budget.twelveDataBudgetScope('local-fixture-no-credential');
    const reservation = budget.twelveDataReservationId(randomUUID(), 0);
    const results = await Promise.all([1, 2].map(() => budget.reserveTwelveDataRequest(scope, reservation, { httpRequests: 1, apiCredits: 1 }, config.budget)));
    assert.deepEqual(results.map(result => result.status).sort(), ['duplicate', 'granted']);
    const row = (await admin.query('select request_count,credit_count::text from market_provider_budgets where scope_hash=$1', [scope])).rows[0];
    assert.deepEqual(row, { request_count: 1, credit_count: '1' });
    for (const table of ['market_provider_observations', 'market_provider_action_coverage', 'market_provider_corporate_actions', 'market_provider_reservations']) {
      await assert.rejects(tenant.query(`select * from ${table}`), error => error.code === '42501');
    }
  });
}
