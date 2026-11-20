import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

const [home, simulation, history, contract, sql] = await importWithPorts([
  'src/lib/cairn-v2/home-read.ts', 'src/lib/cairn-v2/home-simulation-read.ts',
  'src/lib/cairn-v2/home-history-read.ts', 'src/lib/cairn-v2/read-contract.ts', 'src/lib/cairn-v2/history-read-sql.ts',
], {});
const binding = 'a'.repeat(64), otherBinding = 'b'.repeat(64);
const epoch = '11111111-1111-4111-8111-111111111111';
const scope = { kind: 'account', key: 'account:owned', accountId: 'owned', accountCode: 'brokerage', label: 'Owned' };
const context = { mode: 'domain', scope: scope.key, currency: 'KRW', fixture: 'standard' };
const parent = () => ({ context, view: contract.blankDomainView('ready', ''), displayBinding: binding, readReceipt: 'parent-read-1', readEpoch: epoch, historyWindow: 'recent' });
const evidence = () => ({ selectedScope: scope, readStatus: 'ready', observationPolicy: 'production_observed_v1', portfolioRows: [], recoveredReturn: null });

test('bounded reads time out, clear completed timers and distinguish explicit cancellation', async t => {
  const [{ startBoundedRead, LAZY_READ_TIMEOUT_MS }] = await importWithPorts(['src/lib/cairn-v2/bounded-read.ts'], {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, finish;
  const stalled = startBoundedRead(value => { signal = value; return new Promise(resolve => { finish = resolve; }); });
  const timedOut = assert.rejects(stalled.promise, /read_timeout/);
  t.mock.timers.tick(LAZY_READ_TIMEOUT_MS - 1); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await timedOut; assert.equal(signal.aborted, true);
  finish('late result'); await Promise.resolve();
  const completed = startBoundedRead(async value => { signal = value; return 'complete'; });
  assert.equal(await completed.promise, 'complete');
  t.mock.timers.tick(LAZY_READ_TIMEOUT_MS); assert.equal(signal.aborted, false);
  const cancelled = startBoundedRead(value => { signal = value; return new Promise(() => {}); });
  const rejected = assert.rejects(cancelled.promise, /read_cancelled/);
  cancelled.cancel(); await rejected; assert.equal(signal.aborted, true);
  t.mock.timers.tick(LAZY_READ_TIMEOUT_MS);
});

test('home initial read requests bounded history and never starts simulation, even when ready', async () => {
  let researchCalls = 0, options;
  const read = parent();
  const result = await home.readBetaHome({ mode: 'domain', scope: scope.key }, {
    domain: async (_params, value) => { options = value; return read; },
    simulation: async () => { researchCalls++; throw new Error('not requested'); },
  });
  assert.deepEqual(options, { includeHeatmap: true, includeCurrentValue: true, historyWindow: 'recent' });
  assert.deepEqual(result, { read }); assert.equal(researchCalls, 0);
});

test('simulation request keeps exact research context and refresh epoch, without planning inputs', () => {
  const c = { ...context, horizon: '63', end: '2026-10-30', cashAmountKrw: '1230000', excludeSell: 'private-selection' };
  const url = new URL(simulation.homeSimulationRequest(c, epoch), 'https://example.test');
  assert.equal(url.pathname, '/beta/api/simulation'); assert.equal(url.searchParams.get('scope'), scope.key);
  assert.equal(url.searchParams.get('_betaRead'), epoch); assert.equal(url.searchParams.get('run'), '1');
  assert.equal(url.searchParams.get('horizon'), '63'); assert.equal(url.searchParams.get('end'), '2026-10-30');
  assert.equal(url.searchParams.has('cashAmountKrw'), false); assert.equal(url.searchParams.has('excludeSell'), false);
  const result = { context: { ...c, run: '1' }, displayBinding: binding, readReceipt: 'r', readEpoch: epoch };
  assert.equal(simulation.matchesHomeSimulation(result, c, binding, epoch), true);
  for (const changed of [{ displayBinding: otherBinding }, { readEpoch: undefined }, { readReceipt: undefined }, { context: { ...result.context, scope: 'all' } }]) {
    assert.equal(simulation.matchesHomeSimulation({ ...result, ...changed }, c, binding, epoch), false);
  }
});

test('simulation owner binding is checked before research starts', async () => {
  let research = 0;
  const [server] = await importWithPorts(['src/lib/cairn-v2/server-simulation.ts'], {
    '@/lib/auth/current-tenant-context': { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: { ownerUserId: 'owner' } }) },
    '@/db/queries/portfolio-analysis-scopes': { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => ({ state: 'ready', catalog: { scopes: [scope] }, resolution: { state: 'resolved', scope } }) },
    '@/lib/cairn-v2/display-session': { displayBindingForScopes: () => binding },
    '@/lib/cairn-v2/simulation-shared-research': { getReadOnlyBetaTenantSimulationResearch: async () => { research++; throw new Error('synthetic provider outage'); } },
  });
  const params = { mode: 'domain', scope: scope.key, run: '1', _betaRead: epoch };
  const rejected = await server.getBetaSimulationRead(params, otherBinding);
  assert.equal(research, 0); assert.equal(rejected.model, null);
  await server.getBetaSimulationRead(params, binding); assert.equal(research, 1);
});

test('simulation route rejects ambiguous inputs and returns only same-owner private reads', async () => {
  let calls = 0, value = { state: 'ready', displayBinding: binding };
  const [route] = await importWithPorts(['src/app/beta/api/simulation/route.ts'], {
    '@/lib/cairn-v2/server-access': { requireBetaFixtureAccess: async () => {} },
    '@/lib/cairn-v2/server-simulation': { getBetaSimulationRead: async (_params, expected) => { calls++; assert.equal(expected, binding); return value; } },
  });
  const request = suffix => new Request('https://example.test/beta/api/simulation?mode=domain&run=1' + suffix, { headers: { [simulation.SIMULATION_BINDING_HEADER]: binding } });
  assert.equal((await route.GET(request('&scope=all&scope=foreign'))).status, 400);
  assert.equal((await route.GET(request('&collect=true'))).status, 400); assert.equal(calls, 0);
  let response = await route.GET(request('&scope=all')); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  value = { state: 'unavailable', displayBinding: otherBinding, model: { private: 'never returned' } };
  response = await route.GET(request('&scope=all')); assert.equal(response.status, 409);
  assert.equal(JSON.stringify(await response.json()).includes('never returned'), false);
});

test('recent SQL bounds observed dates and retains reconstruction timing without changing full query', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('create table synthetic_history(snapshot_date text,cycle_end_at text,account text,source text,value numeric)');
    await pg.query(`insert into synthetic_history values
      ('2024-01-01',null,'A','base44_import',10),
      ('2026-11-20',null,'A','base44_import',20),
      ('2026-11-20','2024-01-02T00:00:00Z','A','broker_reconstructed_close_v1:old-repair',30),
      ('2026-05-15','2026-05-15T00:00:00Z','A','varda_manual_daily_snapshot',40),
      ('2026-05-14','2026-05-14T00:00:00Z','A','varda_manual_daily_snapshot',50),
      ('2026-05-15','2024-01-02T00:00:00Z','B','varda_manual_daily_snapshot',60)`);
    const source = 'select * from synthetic_history order by snapshot_date';
    const recent = await pg.query(sql.recentBetaHistorySql(source));
    // An old-dated component in a retained cohort must remain visible to the
    // completeness check; dropping it would turn inconsistent dates into a sum.
    assert.deepEqual(recent.rows.map(row => Number(row.value)).sort((a, b) => a - b), [20, 40, 60]);
    assert.equal((await pg.query(source)).rows.length, 6);
    assert.match(sql.recentBetaHistorySql(sql.BETA_HISTORY_PORTFOLIO_ROWS_SQL), /native_ledger_revisions/);
    assert.match(sql.recentBetaHistorySql(sql.BETA_HISTORY_GROUP_POSITION_ROWS_SQL), /broker_recovery_batches/);
  } finally { await pg.close(); }
});

test('full-history route rechecks owner/catalog before all evidence; malformed epochs never read', async () => {
  let calls = 0, session = { ok: true, tenantContext: { ownerUserId: 'owner' } };
  const [route] = await importWithPorts(['src/app/beta/api/history/full/route.ts'], {
    '@/lib/cairn-v2/server-access': { requireBetaFixtureAccess: async () => {} },
    '@/lib/auth/current-tenant-context': { resolveCurrentTenantContext: async () => session },
    '@/db/queries/portfolio-analysis-scopes': { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => ({ state: 'ready', catalog: { scopes: [scope] }, resolution: { state: 'resolved', scope } }) },
    '@/lib/cairn-v2/display-session': { displayBindingForScopes: () => binding },
    '@/lib/cairn-v2/history-read': { getBetaHistoryRead: async args => { calls++; assert.equal(args.historyWindow, undefined); return evidence(); } },
    '@/db/queries/period-return-recovery': { readRecoveredReturnCurve: async () => null },
  });
  const request = (header = binding, suffix = '') => new Request(`https://example.test/beta/api/history/full?scope=${scope.key}&currency=KRW${suffix}`, { headers: { [history.HISTORY_BINDING_HEADER]: header } });
  assert.equal((await route.GET(request(otherBinding))).status, 409); assert.equal(calls, 0);
  assert.equal((await route.GET(request(binding, '&_betaRead=bad'))).status, 400); assert.equal(calls, 0);
  assert.equal((await route.GET(request(binding, '&scope=all'))).status, 400); assert.equal(calls, 0);
  const response = await route.GET(request(binding, '&_betaRead=' + epoch)); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json(); assert.equal(history.matchesHomeHistory(result, context, parent()), true);
  assert.equal(calls, 1);
  session = { ok: false, failure: { httpStatus: 401 } };
  assert.equal((await route.GET(request())).status, 401); assert.equal(calls, 1);
});

test('history generations reject stale scope, owner, currency, refresh or missing receipt', () => {
  const read = parent(), result = { scope: scope.key, currency: 'KRW', displayBinding: binding, readReceipt: 'full-1', readEpoch: epoch, history: evidence() };
  assert.equal(history.matchesHomeHistory(result, context, read), true);
  for (const changed of [{ scope: 'all' }, { currency: 'USD' }, { displayBinding: otherBinding }, { readEpoch: undefined }, { readReceipt: undefined }]) {
    assert.equal(history.matchesHomeHistory({ ...result, ...changed }, context, read), false);
  }
  assert.notEqual(history.homeHistoryGeneration(context, read), history.homeHistoryGeneration(context, { ...read, readReceipt: 'refresh-2' }));
});

test('history-only projection preserves current totals/targets and never invents USD history or unknown cost', () => {
  const base = parent().view; base.totalKrw = 999; base.domain.planning = { keep: true }; base.domain.currentValuePresentation = { kind: 'unavailable' };
  const full = evidence(); full.portfolioRows.push({ snapshotDate: '2026-11-10', valuationDate: '2026-11-09', storageSnapshotDate: '2026-11-10', source: 'varda_manual_daily_snapshot', account: 'brokerage', rowKind: 'stored', derivedFromAccounts: [], totalMarketValue: 123, totalReturnPct: null });
  const result = contract.applyBetaHistory(base, full, 'KRW').view;
  assert.equal(result.totalKrw, 999); assert.equal(result.domain.planning, base.domain.planning);
  assert.equal(result.domain.currentValuePresentation, base.domain.currentValuePresentation);
  assert.equal(result.history[0].date, '2026-11-09'); assert.equal(result.history[0].valueKrw, 123); assert.equal(result.history[0].exampleReturnPct, null);
  const usd = contract.applyBetaHistory(base, full, 'USD').view;
  assert.equal(usd.domain.historyState, 'unavailable'); assert.equal(usd.history[0].valueKrw, null);
});

test('lazy history waits for ALL/detail, aborts departed generations and hides stale responses', async t => {
  const states = [], dependencies = [], cleanups = [], queued = []; let cursor = 0, effectCursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; },
    useEffect(fn, deps) { const index = effectCursor++; if (!dependencies[index] || deps.some((value, i) => !Object.is(value, dependencies[index][i]))) { dependencies[index] = deps; queued.push(() => { cleanups[index]?.(); cleanups[index] = fn(); }); } },
  };
  const [module] = await importUiWithPorts(['src/components/cairn-v2/use-home-history-read.ts'], { react: hooks });
  const calls = []; const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => new Promise(resolve => calls.push({ url, options, resolve }));
  const render = (read, needed) => { cursor = 0; effectCursor = 0; const value = module.useHomeHistoryRead(read.view, read, read.context, needed); queued.splice(0).forEach(fn => fn()); return value; };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    const read = parent(); render(read, false); assert.equal(calls.length, 0);
    assert.equal(render(read, true).view.domain.historyState, 'loading'); assert.equal(calls.length, 1);
    render(read, false); assert.equal(calls[0].options.signal.aborted, true);
    const payload = { scope: scope.key, currency: 'KRW', displayBinding: binding, readReceipt: 'full-1', readEpoch: epoch, history: evidence() };
    calls[0].resolve(Response.json(payload, { headers: { [history.HISTORY_BINDING_HEADER]: binding } })); await flush();
    render(read, true); assert.equal(calls.length, 2);
    calls[1].resolve(Response.json(payload, { headers: { [history.HISTORY_BINDING_HEADER]: binding } })); await flush();
    assert.equal(render(read, true).view.domain.historyState, 'empty');
    render(read, false); render(read, true); assert.equal(calls.length, 2);
    const refreshed = { ...read, readReceipt: 'parent-read-2' };
    assert.equal(render(refreshed, true).view.domain.historyState, 'loading'); assert.equal(calls.length, 3);
    calls[2].resolve(Response.json({ ...payload, displayBinding: otherBinding }, { headers: { [history.HISTORY_BINDING_HEADER]: otherBinding } })); await flush();
    assert.equal(render(refreshed, true).error, 'session');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const retryRead = { ...read, readReceipt: 'parent-read-3' };
    render(retryRead, true); assert.equal(calls.length, 4);
    t.mock.timers.tick(30_000); await flush();
    const timeout = render(retryRead, true);
    assert.equal(timeout.error, 'read'); assert.equal(timeout.view.domain.historyState, 'unavailable');
    assert.equal(calls[3].options.signal.aborted, true);
    timeout.retry(); render(retryRead, true); assert.equal(calls.length, 5);
    render(retryRead, false); t.mock.timers.tick(30_000); await flush();
    assert.equal(render(retryRead, false).error, undefined);
  } finally { cleanups.forEach(fn => fn?.()); globalThis.fetch = originalFetch; }
});
