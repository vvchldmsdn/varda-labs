import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { importWithPorts } from '../tests/helpers/import-with-ports.mjs';
import { sqlTransport } from './krw-usd-rc-rehearsal.mjs';
import { childEnvironment } from './reliability-ci.mjs';

/** Neon wire transport only. The app's SQL, tenant roles, transactions and RLS are unchanged. */
export function createSqlBridge({ worker, tenant, connectionStrings, token }) {
  return createServer(async (request, response) => {
    const respond = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.url !== '/sql' || request.method !== 'POST' || request.headers['x-cairn-test-bridge'] !== token) return respond(403, { message: 'invalid_test_transport' });
    const key = request.headers['neon-connection-string'];
    const pool = key === connectionStrings[0] ? worker : key === connectionStrings[1] ? tenant : null;
    if (!pool) return respond(403, { message: 'unreviewed_database' });
    let client;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; assert.ok(bytes < 24 * 1024 * 1024); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      client = await pool.connect();
      const multiple = Array.isArray(body.queries);
      if (multiple) {
        const level = request.headers['neon-batch-isolation-level'] ?? 'ReadCommitted';
        const levels = { ReadCommitted: 'READ COMMITTED', RepeatableRead: 'REPEATABLE READ', Serializable: 'SERIALIZABLE' };
        assert.ok(levels[level]);
        await client.query(`BEGIN ISOLATION LEVEL ${levels[level]}${request.headers['neon-batch-read-only'] === 'true' ? ' READ ONLY' : ''}`);
      }
      const results = [];
      for (const query of multiple ? body.queries : [body]) {
        const result = await client.query({ text: query.query, values: query.params ?? [], rowMode: 'array', types: { getTypeParser: () => value => value } });
        results.push({ rows: result.rows, fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })), rowCount: result.rowCount, command: result.command, rowAsArray: true });
      }
      if (multiple) await client.query('COMMIT');
      respond(200, multiple ? { results } : results[0]);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      // SQL text and values are never placed in server logs or reports.
      respond(400, { message: 'synthetic_database_query_failed', code: error.code ?? 'TEST_TRANSPORT_FAILED' });
    } finally { client?.release(); }
  });
}

async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}

export async function runFullAppCases({ admin, worker, tenant, report, output, stage, browserCache }) {
  const owner = randomUUID(), other = randomUUID(), account = randomUUID(), asset = randomUUID();
  const otherAccount = randomUUID(), otherAsset = randomUUID(), legacyOwner = randomUUID(), legacyAccount = randomUUID(), legacyAsset = randomUUID();
  const identities = { [randomBytes(24).toString('hex')]: owner, [randomBytes(24).toString('hex')]: other, [randomBytes(24).toString('hex')]: legacyOwner };
  const sessionTokens = Object.keys(identities);
  const context = { ownerUserId: owner, role: 'user' };
  const sql = sqlTransport(worker, new Set()), tenantSql = sqlTransport(tenant, new Set());
  const [ledger, snapshots, cutoff, legacySnapshots] = await importWithPorts(['src/db/queries/native-portfolio-ledger.ts', 'src/db/queries/native-portfolio-snapshots.ts', 'src/lib/snapshots/native-cutoff-evidence.ts', 'src/lib/snapshots/daily.ts'], {
    '@/db/client': { sqlClient: sql, db: drizzle(worker) }, '@/db/tenant-client': { getTenantSqlClient: () => tenantSql },
  });
  const now = new Date(), quoteAt = new Date(now.getTime() - 3600000).toISOString();
  await admin.query("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')", [owner, other]);
  await admin.query("insert into auth_identities(app_user_id,provider,provider_subject) values($1::uuid,'neon_auth',$1::text),($2::uuid,'neon_auth',$2::text)", [owner, other]);
  for (const row of [{ id: account, owner, asset, code: 'brokerage', name: 'Synthetic USD', currency: 'USD', ticker: 'TESTUSD', market: 'us', price: 100 },
    { id: otherAccount, owner: other, asset: otherAsset, code: 'brokerage', name: 'Synthetic KRW', currency: 'KRW', ticker: 'TESTKR', market: 'korea', price: 10000 }]) {
    await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,$4,'brokerage',$5)", [row.id, row.owner, row.code, row.name, row.currency]);
    await admin.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,price_source,price_status,price_quote_type,price_as_of,price_fetched_at) values($1,$2,$3,$4,$5,$6,$7,$8,'stock',10,$9,'kis','ok','close',$10,$10)", [row.asset, row.owner, row.id, row.code, row.name + ' holding', row.ticker, row.market, row.currency, row.price, quoteAt]);
    const result = await ledger.writeNativeMutation({ ownerUserId: row.owner, role: 'user' }, { operationId: randomUUID(), accountId: row.id, expectedSequence: null,
      opening: { at: '2026-08-01T00:00:00Z', cash: { KRW: row.currency === 'KRW' ? '100000' : '0', USD: row.currency === 'USD' ? '1000' : '0' }, positions: [{ assetId: row.asset, currency: row.currency, quantity: '10', costLots: null }] } });
    assert.equal(result.status, 'created');
  }
  await admin.query("insert into app_users(id,status,role) values($1,'active','user')", [legacyOwner]);
  await admin.query("insert into auth_identities(app_user_id,provider,provider_subject) values($1::uuid,'neon_auth',$1::text)", [legacyOwner]);
  await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency,created_at,updated_at) values($1,$2,'brokerage','Synthetic legacy','brokerage','KRW','2026-08-01','2026-08-01')", [legacyAccount, legacyOwner]);
  await admin.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,created_at,updated_at) values($1,$2,$3,'brokerage','Synthetic legacy holding','999998','korea','KRW','stock',10,120,'2026-08-01','2026-08-01')", [legacyAsset, legacyOwner, legacyAccount]);
  for (const row of [{ date: '2026-08-04', price: 110, snapshotDate: '2026-08-05' }, { date: '2026-08-05', price: 120, snapshotDate: '2026-08-06' }]) {
    await admin.query("insert into asset_price_snapshots(ticker,market,currency,date,close_price,source,fetched_at) values('999998','korea','KRW',$1,$2,'kis',$3)", [row.date, row.price, `${row.date}T21:00:00Z`]);
    await admin.query("insert into live_price_quotes(ticker,market,currency,price,source,provider,quote_type,status,price_as_of,fetched_at) values('999998','korea','KRW',$1,'kis','kis','live','ok',$2,$2) on conflict(market,ticker,provider) do update set price=excluded.price,price_as_of=excluded.price_as_of,fetched_at=excluded.fetched_at", [row.price, `${row.date}T21:59:59Z`]);
    await admin.query("insert into fx_rates(date,usdkrw,source,status,observed_at,fetched_at,rate_kind) values($1,1400,'synthetic','ok',$2,$2,'spot') on conflict do nothing", [row.date, `${row.date}T21:00:00Z`]);
    const result = await legacySnapshots.runDailySnapshot({ tenantContext: { ownerUserId: legacyOwner, role: 'user' }, dryRun: false, snapshotDate: row.snapshotDate, now: new Date(`${row.snapshotDate}T01:00:00Z`), account: 'brokerage' });
    assert.equal(result.writeReady, true);
  }
  assert.deepEqual((await admin.query('select total_market_value::text from daily_portfolio_snapshots where account_id=$1 order by snapshot_date', [legacyAccount])).rows.map(row => Number(row.total_market_value)), [1100, 1200]);
  await admin.query("select set_trade_reliability_mode('compatible','Synthetic full-app rehearsal')");
  const secrets = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex')];
  const connectionStrings = [`postgresql://rc_writer:${secrets[0]}@ep-cairn-fullapp.synthetic.neon.tech/postgres`, `postgresql://varda_tenant_app:${secrets[1]}@ep-cairn-fullapp.synthetic.neon.tech/postgres`];
  const token = randomBytes(24).toString('hex');
  const bridge = createSqlBridge({ worker, tenant, connectionStrings, token });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const bridgeUrl = `http://127.0.0.1:${bridge.address().port}/sql`;
  const transportFile = path.join(output, 'local-transport.json');
  await writeFile(transportFile, JSON.stringify({ bridge: bridgeUrl, connectionStrings, token }), { mode: 0o600 });
  const environment = { ...childEnvironment(process.env, stage, 'browser-journeys', browserCache), NODE_ENV: 'production',
    DATABASE_URL: connectionStrings[0], DATABASE_URL_UNPOOLED: connectionStrings[0], TENANT_DATABASE_URL: connectionStrings[1],
    CAIRN_FULLAPP_IDENTITIES: JSON.stringify(identities), CAIRN_FULLAPP_TRANSPORT_FILE: transportFile, NATIVE_LEDGER_ROLLOUT: 'qa', NATIVE_LEDGER_QA_OWNERS: `${owner},${other}` };
  environment.NODE_OPTIONS += ` --import=${pathToFileURL(path.join(stage, 'scripts/reliability-fullapp-preload.mjs')).href}`;
  // Next normalizes loopback Request.url to localhost. Keep browser Origin equal
  // to the actual route origin so the unchanged same-origin guard is exercised.
  const appPort = await port(), url = `http://localhost:${appPort}`;
  const logfile = createWriteStream(path.join(output, 'next.log'));
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(appPort)],
    { cwd: stage, env: environment, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.pipe(logfile, { end: false }); server.stderr.pipe(logfile, { end: false });
  const browser = await chromium.launch({ headless: true }); let page;
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Seoul' });
  await browserContext.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const readState = async () => (await ledger.readNativeLedger(context, account)).accounts[0].state;
  const setIdentity = async token => { await browserContext.clearCookies(); if (token) await browserContext.addCookies([{ name: 'cairn_fullapp_identity', value: token, url, httpOnly: true, sameSite: 'Lax' }]); };
  async function visitValuation(route) {
    await page.goto(url + route);
    // Streamed Next markup can contain values before it becomes visible.
    await expect(page.getByRole('region', { name: '현재 평가', exact: true })).toBeVisible();
    if (route.startsWith('/history')) await expect(page.getByRole('heading', { name: '확인된 평가 기록', exact: true })).toBeVisible();
    if (route.startsWith('/today')) await expect(page.getByRole('heading', { name: '무엇이 변했나요?', exact: true })).toBeVisible();
  }
  async function check(name, callback) {
    const row = { name, status: 'FAIL' }; report.cases.push(row);
    try {
      await callback();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Actual app page has horizontal overflow');
      row.viewport = page.viewportSize(); row.status = 'PASS';
    }
    catch (error) { await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); if (page) await writeFile(path.join(output, 'failure-visible.txt'), await page.locator('body').innerText()); throw error; }
  }
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw new Error('Next production server exited');
      try { if ((await fetch(url + '/start')).ok) break; } catch { /* readiness only */ }
      if (attempt === 119) throw new Error('Next production server did not start');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    page = await browserContext.newPage();
    page.on('response', async response => {
      if (new URL(response.url()).pathname !== '/api/portfolio/ledger' || response.status() < 400) return;
      const body = await response.json().catch(() => ({}));
      (report.ledgerHttpFailures ??= []).push({ status: response.status(), method: response.request().method(), error: body.error ?? 'non_json_error' });
    });
    await setIdentity(sessionTokens[0]);
    await check('fullapp-native-home-quick-buy-sell-clock-skew-real-router-refresh', async () => {
      await page.clock.install({ time: new Date(Date.now() + 60_000) });
      await visitValuation('/?currency=USD');
      await expect(page.getByRole('button', { name: 'Synthetic USD holding 매수', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('2,000.00');
      await page.getByRole('button', { name: 'Synthetic USD holding 매수', exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      await dialog.getByLabel('수량', { exact: true }).fill('2'); await dialog.getByLabel('체결 총액', { exact: true }).fill('200');
      const buyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/portfolio/ledger' && response.request().method() === 'POST' && !!response.request().postDataJSON()?.mutation);
      await dialog.getByRole('button', { name: '매수 기록 저장', exact: true }).click();
      assert.equal((await buyResponse).status(), 201, 'Fast device clock must not reject the default trade time');
      await expect(dialog).not.toBeVisible(); assert.equal((await readState()).positions[0].quantity, '12');
      await expect(page.getByRole('region', { name: '보유자산' })).toContainText('1,200.00');
      await page.clock.setSystemTime(new Date(Date.now() - 60_000));
      await page.getByRole('button', { name: 'Synthetic USD holding 매도', exact: true }).click();
      await dialog.getByLabel('수량', { exact: true }).fill('1'); await dialog.getByLabel('체결 총액', { exact: true }).fill('110');
      const sellResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/portfolio/ledger' && response.request().method() === 'POST' && !!response.request().postDataJSON()?.mutation);
      await dialog.getByRole('button', { name: '매도 기록 저장', exact: true }).click();
      assert.equal((await sellResponse).status(), 201, 'Slow device clock must not reject the default trade time');
      await expect(dialog).not.toBeVisible(); assert.equal((await readState()).positions[0].quantity, '11'); assert.equal((await readState()).cash.USD, '910');
      await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('2,010.00');
      await page.screenshot({ path: path.join(output, 'desktop-home.png'), fullPage: true });
      await page.clock.setSystemTime(new Date());
    });
    await check('fullapp-transactions-today-history-native-missing-evidence', async () => {
      await page.goto(url + '/portfolio/events?account=all'); await expect(page.getByRole('heading', { name: '소유 계정 이벤트' })).toBeVisible();
      await expect(page.locator('body')).toContainText('Synthetic USD');
      await visitValuation('/today?currency=USD'); await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('2,010.00');
      await visitValuation('/history?currency=USD');
      await expect(page.locator('body')).toContainText('과거 수량과 가격 시각이 확인돼야');
      await page.screenshot({ path: path.join(output, 'desktop-history-missing.png'), fullPage: true });
    });
    await check('fullapp-postcommit-response-loss-refresh-identity-return-exactly-one', async () => {
      let lost = true;
      await page.route('**/api/portfolio/ledger', async route => {
        const request = route.request();
        if (lost && request.method() === 'POST' && request.postDataJSON()?.mutation) { await route.fetch(); await route.abort('failed'); }
        else await route.continue();
      });
      await page.goto(url + `/portfolio/ledger?accountId=${account}&assetId=${asset}&action=buy`);
      await page.getByLabel('수량', { exact: true }).fill('1'); await page.getByLabel('체결 총액', { exact: true }).fill('100');
      await page.getByRole('button', { name: '매수 기록 저장', exact: true }).click();
      await expect(page.getByText('저장 결과를 확인하지 못했어요.', { exact: false })).toBeVisible();
      assert.equal((await readState()).positions[0].quantity, '12');
      await setIdentity(null); lost = false; await page.reload(); await expect(page).toHaveURL(/\/auth\/sign-in/);
      await setIdentity(sessionTokens[0]); await page.goto(url + `/portfolio/ledger?accountId=${account}&assetId=${asset}&action=buy`);
      await expect(page.getByText('기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.', { exact: true })).toBeVisible();
      assert.equal((await readState()).positions[0].quantity, '12'); assert.equal((await readState()).sequence, 3);
      await page.unroute('**/api/portfolio/ledger');
    });
    await check('fullapp-historical-entry-invalidates-and-rebuilds-real-cutoff-history', async () => {
      const serviceDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86400000));
      const cutoffAt = new Date(`${serviceDate}T07:00:00+09:00`).toISOString();
      const observedAt = new Date(Date.parse(cutoffAt) - 3600000).toISOString();
      const evidence = { ownerId: owner, reporting: 'USD', asOf: now.toISOString(),
        current: { at: now.toISOString(), source: 'synthetic_test_observation', scopeComplete: true, positions: [{ id: asset, ownerId: owner, accountId: account, kind: 'holding', name: 'Synthetic USD holding', ticker: 'TESTUSD', market: 'us',
          observation: { quantity: '12', price: '100', currency: 'USD', at: observedAt, priceObservedAt: observedAt, priceFetchedAt: observedAt, basis: 'raw', source: 'kis' } }] }, history: [], trades: null, fx: [], maxPriceAgeMs: 86400000, maxFxAgeMs: 86400000 };
      const initial = cutoff.buildNativeCutoffEvidence(evidence, await ledger.readNativeLedger(context, account), serviceDate, now.toISOString());
      assert.equal(initial.current.positions.find(row => row.id === asset).observation.quantity, '10');
      assert.equal((await snapshots.saveNativeCutoffSnapshots(context, initial, serviceDate, now.toISOString())).created, 1);
      await visitValuation('/history?currency=USD');
      await expect(page.locator('body')).toContainText('2,000.00');
      await page.goto(url + `/portfolio/ledger?accountId=${account}&assetId=${asset}&action=buy`);
      await page.getByText('과거 거래 추가·정정', { exact: true }).click();
      await page.getByLabel('시작 잔액 이후 거래를 다시 계산', { exact: true }).check();
      await page.getByLabel('수량', { exact: true }).fill('1'); await page.getByLabel('체결 총액', { exact: true }).fill('100');
      await page.locator('input[name="at"]').fill('2026-08-02T12:00');
      await page.getByLabel('변경 이유', { exact: true }).fill('Synthetic missing buy');
      await page.getByLabel('시작 잔액에 이미 포함된 거래가 아닙니다.', { exact: true }).check();
      await page.getByRole('button', { name: '매수 기록 저장', exact: true }).click();
      await expect(page.getByText('기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.', { exact: true })).toBeVisible();
      const revised = await ledger.readNativeLedger(context, account);
      assert.equal(revised.accounts[0].state.positions[0].quantity, '13'); assert.equal(revised.accounts[0].state.cash.USD, '710');
      assert.equal(revised.snapshots.length, 0, 'A superseded capture must disappear before rebuilding');
      await visitValuation('/history?currency=USD'); await expect(page.locator('body')).toContainText('과거 수량과 가격 시각이 확인돼야');
      const observations = await ledger.readNativeSnapshotObservations(context, account);
      const rebuilt = cutoff.buildNativeCutoffEvidence({ ...evidence, current: { ...evidence.current, positions: [] } }, { ...revised, observations }, serviceDate, now.toISOString());
      assert.equal(rebuilt.current.positions.find(row => row.id === asset).observation.quantity, '11');
      assert.equal((await snapshots.saveNativeCutoffSnapshots(context, rebuilt, serviceDate, now.toISOString())).created, 1);
      await visitValuation('/?currency=USD'); await expect(page.getByRole('region', { name: '보유자산' })).toContainText('1,300.00');
      await visitValuation('/today?currency=USD'); await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('2,010.00');
      await visitValuation('/history?currency=USD'); await expect(page.locator('body')).toContainText('2,000.00');
      await expect(page.locator('body')).not.toContainText('과거 수량과 가격 시각이 확인돼야');
      await page.screenshot({ path: path.join(output, 'desktop-rebuilt-history.png'), fullPage: true });
    });
    await check('fullapp-expired-local-input-keeps-server-operation-fence', async () => {
      const operationId = randomUUID();
      const identity = await (await browserContext.request.get(url + '/api/portfolio/ledger')).json();
      const storageKey = 'cairn:pending-trade:v1:' + identity.sessionKey;
      const before = await readState();
      await page.evaluate(({ storageKey, draft }) => localStorage.setItem(storageKey, JSON.stringify(draft)), { storageKey,
        draft: { sessionKey: identity.sessionKey, savedAt: Date.now() - 25 * 3600000,
          mutation: { operationId, accountId: account, expectedSequence: before.sequence, event: { type: 'buy', at: new Date().toISOString(), assetId: asset, currency: 'USD', quantity: '1', settlement: { currency: 'USD', amount: '100' } } } } });
      await page.goto(url + `/portfolio/ledger?accountId=${account}&assetId=${asset}&action=buy`);
      await expect(page.getByRole('button', { name: '미저장 요청 종료', exact: true })).toBeVisible();
      const expired = JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey));
      assert.equal(expired.operationId, operationId); assert.equal(expired.mutation, undefined);
      await page.getByRole('button', { name: '미저장 요청 종료', exact: true }).click();
      await expect(page.getByRole('button', { name: '매수 기록 저장', exact: true })).toBeEnabled();
      assert.equal(await ledger.readNativeOperation(context, operationId), 'cancelled');
      await page.reload(); assert.deepEqual(await readState(), before);
      assert.equal(await ledger.readNativeOperation(context, operationId), 'cancelled');
    });
    await check('fullapp-owner-switch-mobile-refresh-and-no-overflow', async () => {
      await setIdentity(sessionTokens[1]); await visitValuation('/?currency=KRW');
      await expect(page.getByRole('button', { name: 'Synthetic KRW holding 매수', exact: true })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Synthetic USD');
      await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('200,000');
      await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('button', { name: 'Synthetic KRW holding 매수', exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      await dialog.getByLabel('수량', { exact: true }).fill('1'); await dialog.getByLabel('체결 총액', { exact: true }).fill('10000');
      await page.screenshot({ path: path.join(output, 'mobile-krw-trade.png'), fullPage: true });
      await dialog.getByRole('button', { name: '매수 기록 저장', exact: true }).click(); await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('region', { name: '보유자산' })).toContainText('110,000');
      await page.getByRole('button', { name: 'Synthetic KRW holding 매도', exact: true }).click();
      await dialog.getByLabel('수량', { exact: true }).fill('1'); await dialog.getByLabel('체결 총액', { exact: true }).fill('11000');
      await dialog.getByRole('button', { name: '매도 기록 저장', exact: true }).click(); await expect(dialog).not.toBeVisible();
      const otherState = (await ledger.readNativeLedger({ ownerUserId: other, role: 'user' }, otherAccount)).accounts[0].state;
      assert.equal(otherState.positions[0].quantity, '10'); assert.equal(otherState.cash.KRW, '101000');
      await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('201,000');
      await page.setViewportSize({ width: 320, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, 'mobile-320-home.png'), fullPage: true });
      await page.goto(url + '/portfolio/events?account=all'); await expect(page.getByRole('heading', { name: '소유 계정 이벤트' })).toBeVisible(); await expect(page.locator('body')).toContainText('Synthetic KRW');
      await visitValuation('/today?currency=KRW'); await expect(page.getByRole('region', { name: '현재 평가' })).toContainText('201,000');
      await visitValuation('/history?currency=KRW');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await check('fullapp-legacy-history-heatmap-selection-preserves-real-snapshots', async () => {
      await setIdentity(sessionTokens[2]); await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(url + '/history?scope=account%3A' + legacyAccount);
      await page.getByRole('button', { name: '기간 요약·근거', exact: true }).click();
      await expect(page.getByRole('heading', { name: '기록 리듬', exact: true })).toBeVisible();
      // The graph shows the valuation date, one day before the daily save date.
      const firstDate = page.getByRole('button', { name: /^2026\.08\.04 이전 저장점 대비/ });
      const secondDate = page.getByRole('button', { name: /^2026\.08\.05 이전 저장점 대비/ });
      await firstDate.click(); await expect(page.locator('[data-history-inspected-value]')).toContainText('1,100');
      await secondDate.click(); await expect(page.locator('[data-history-inspected-value]')).toContainText('1,200');
      await page.screenshot({ path: path.join(output, 'desktop-legacy-history-heatmap.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
      await page.getByRole('button', { name: '기간 요약·근거', exact: true }).click();
      await firstDate.click();
      await expect(page.locator('[data-history-inspected-value]')).toContainText('1,100');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, 'mobile-legacy-history-heatmap.png'), fullPage: true });
      assert.deepEqual((await admin.query('select total_market_value::text from daily_portfolio_snapshots where account_id=$1 order by snapshot_date', [legacyAccount])).rows.map(row => Number(row.total_market_value)), [1100, 1200]);
    });
    report.fullApp = { url, mode: 'Next production build and real App Router; no design preview', data: 'synthetic local PostgreSQL; unchanged app query/writer/RLS',
      authBoundary: 'external verified identity substituted in disposable build only; real email/OAuth and auth provider cookies NOT RUN',
      notCovered: ['Native History has no heatmap UI; tested its available saved-valuation surface separately', 'Provider collection is disabled', 'Real provider logout/login is not represented by test identity removal/return'] };
  } finally {
    await browser.close(); server.kill();
    await Promise.race([new Promise(resolve => server.once('close', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
    await new Promise(resolve => logfile.end(resolve)); await new Promise(resolve => bridge.close(resolve));
    // The file contains only synthetic transport tokens, but need not survive the run.
    const { unlink } = await import('node:fs/promises'); await unlink(transportFile).catch(() => {});
    report.fullAppServerStopped = server.exitCode !== null || server.signalCode !== null;
    if (!report.fullAppServerStopped) throw new Error('Full-app server did not stop');
    const source = await readFile(path.join(stage, 'src/lib/auth/current-session-subject.ts'), 'utf8');
    assert.ok(source.includes('cairn_fullapp_identity'), 'Disposable test identity boundary must be explicit');
  }
}
