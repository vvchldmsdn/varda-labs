import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect } from '@playwright/test';
import { buildHoldingAnalysisDataReadiness } from '../src/lib/holding-analysis-data-readiness.ts';
import { normalizeCollectionJobs } from '../src/lib/market-data/collection-policy.ts';
import { resolveSnapshotCycle, closeCalendarReferenceDateForAsset } from '../src/lib/snapshots/market-calendar.ts';
import { latestFinalizedKisPriceDate } from '../src/lib/shared-domain/market-data/kis-history-finalization.ts';
import { simulationExpectedCloseDate } from '../src/lib/simulation-market-calendar.ts';
import { shiftRiskDate } from '../src/lib/portfolio-risk-calendar.ts';

// Disposable full-app PostgreSQL fixtures only. No API responses or calculation results are mocked.
// Every synthetic ticker is unique to this invocation; existing market/financial rows are untouched.
export async function runContextReadinessCases({ page, check, admin, setIdentity, token, owner, url, output }) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Requires the isolated local full-app server');
  const emptyAccount = randomUUID(), fxAccount = randomUUID(), conflictAccount = randomUUID();
  const fxAsset = randomUUID(), conflictAsset = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const now = new Date(), observed = new Date(now.getTime() - 60000).toISOString();
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const fx = { holdingId: fxAsset, accountId: fxAccount, accountCode: `qa_fx_${suffix}`, name: 'QA 과거 환율 부족', ticker: `QAFX${suffix}`, assetType: 'etf', market: 'us', currency: 'USD' };
  const conflict = { holdingId: conflictAsset, accountId: conflictAccount, accountCode: `qa_conflict_${suffix}`, name: 'QA 가격 출처 확인', ticker: `QACF${suffix}`, assetType: 'etf', market: 'korea', currency: 'KRW' };
  function prices(target) {
    const limit = latestFinalizedKisPriceDate(target, new Date(observed));
    const dates = Array.from({ length: 360 }, (_, index) => shiftRiskDate(serviceDate, index - 360))
      .filter(date => date <= limit && simulationExpectedCloseDate(target.market, shiftRiskDate(date, 1)) === date).slice(-130);
    assert.equal(dates.length, 130, 'The fixture requires 130 supported, finalized exchange observations');
    return dates.map((priceDate, index) => ({ ...target, priceDate, closePrice: 100 + index / 100, source: 'kis_history',
      providerSymbol: target.ticker, providerExchange: target.market === 'us' ? 'NAS' : 'KRX', fetchedAt: observed,
      adjustedClosePrice: 100 + index / 100, adjustedCloseBasis: 'provider_adjusted_close_v1', adjustedCloseProvider: 'kis', adjustedCloseSource: 'kis_history:adjusted_v1', adjustedCloseFetchedAt: observed }));
  }
  const fxPrices = prices(fx), conflictPrices = prices(conflict);
  conflictPrices.at(-1).providerSymbol = `OTHER${suffix}`; // Two stored identities inside the analysis window; no duplicate-date insertion.
  const expectedFx = buildHoldingAnalysisDataReadiness({ holding: fx, serviceDate, requireAdjusted: true, priceRows: fxPrices, fxRows: [] });
  assert.deepEqual(expectedFx.missingInputs, ['historical_fx']); assert.equal(expectedFx.trendReady, true);
  assert.equal(buildHoldingAnalysisDataReadiness({ holding: conflict, serviceDate, requireAdjusted: true, priceRows: conflictPrices, fxRows: [] }).reason, 'historical_evidence_conflict');
  const endDate = closeCalendarReferenceDateForAsset(fx, serviceDate);
  const jobs = normalizeCollectionJobs([{ kind: 'history', ticker: fx.ticker, market: fx.market, currency: fx.currency, startDate: shiftRiskDate(endDate, -399), endDate }]);
  const seed = await admin.connect();
  try {
    await seed.query('BEGIN');
    await seed.query("select set_config('app.trade_reliability_version','0059',true)");
    await seed.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'QA 빈 계좌','brokerage','USD')", [emptyAccount, owner, `qa_empty_${suffix}`]);
    for (const target of [fx, conflict]) {
      await seed.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,$4,'brokerage',$5)", [target.accountId, owner, target.accountCode, target.name, target.currency]);
      await seed.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,price_source,price_status,price_quote_type,price_as_of,price_fetched_at) values($1,$2,$3,$4,$5,$6,$7,$8,'etf',1,100,'kis','ok','live',$9,$9)", [target.holdingId, owner, target.accountId, target.accountCode, target.name, target.ticker, target.market, target.currency, observed]);
    }
    for (const row of [...fxPrices, ...conflictPrices]) await seed.query('insert into asset_price_snapshots(ticker,market,currency,date,close_price,source,provider_symbol,provider_exchange,fetched_at,adjusted_close_price,adjusted_close_basis,adjusted_close_provider,adjusted_close_source,adjusted_close_fetched_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$9)', [row.ticker, row.market, row.currency, row.priceDate, row.closePrice, row.source, row.providerSymbol, row.providerExchange, observed, row.adjustedCloseBasis, row.adjustedCloseProvider, row.adjustedCloseSource]);
    for (const job of jobs) await seed.query("insert into market_collection_jobs(key,kind,ticker,market,currency,start_date,end_date,status,completed_at) values($1,$2,$3,$4,$5,$6,$7,'done',$8)", [job.key, job.kind, job.ticker, job.market, job.currency, job.startDate, job.endDate, observed]);
    await seed.query('COMMIT');
  } catch (error) { await seed.query('ROLLBACK'); throw error; } finally { seed.release(); }
  await setIdentity(token);
  await page.context().addCookies([{ name: 'varda-locale', value: 'ko', url }]);
  const financial = async () => (await admin.query('select id,account_id,quantity::text,average_cost::text from assets where canonical_owner_user_id=$1 and account_id=any($2::uuid[]) order by id', [owner, [emptyAccount, fxAccount, conflictAccount]])).rows;
  const before = await financial();
  async function capture(name, focus) {
    for (const [width, height] of [[1366, 768], [390, 844], [360, 800]]) {
      await page.setViewportSize({ width, height }); await focus.scrollIntoViewIfNeeded(); await expect(focus).toBeInViewport();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow at ${width}`);
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }

  await check('context-readiness-empty-account-does-not-claim-prepared-history', async () => {
    await page.goto(url + '/beta/simulation?' + new URLSearchParams({ mode: 'domain', scope: `account:${emptyAccount}`, currency: 'KRW' }));
    const recovery = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^가격·환율 준비 상태$/ }) });
    await recovery.locator(':scope > summary').click();
    await expect(recovery).toContainText('확인할 보유종목이 없습니다.');
    await expect(recovery).not.toContainText('종목별 기본 이력이 준비됐어요');
    await capture('readiness-empty-account', recovery);
    await page.goto(url+'/portfolio/risk?'+new URLSearchParams({scope:'account:'+emptyAccount,currency:'KRW'}));
    await expect(page.getByRole('button',{name:'위험 수치·기여',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'계산·데이터 근거',exact:true})).toBeVisible();

  });

  await check('context-readiness-cash-records-return-keeps-native-funding-draft', async () => {
    const draft = { scope: `account:${emptyAccount}`, currency: 'USD', amount: '321.50', fundingCurrency: 'USD', useCash: '1' };
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/native-contribution-plans' && new URL(res.url()).searchParams.get('scope') === draft.scope && res.request().method() === 'GET');
    await page.goto(url + '/additional-contribution?' + new URLSearchParams(draft));
    const payload = await (await response).json();
    assert.equal(payload.context.status, 'blocked'); assert.ok(payload.context.evidenceReasons.includes('cash_not_observed'));
    const notice = page.getByRole('region', { name: '추가 투자 계획', exact: true }).locator('[data-recovery-kind="cash"]');
    await expect(notice).toBeVisible(); await capture('readiness-cash-records', notice);
    await notice.getByRole('button', { name: '잔액·정산 기록 확인하기', exact: true }).click();
    await expect(page).toHaveURL(location => location.pathname === '/portfolio/ledger');
    await expect(page.getByRole('combobox', { name: '계좌', exact: true })).toHaveValue(emptyAccount);
    const restored = new URL(decodeURIComponent(new URL(page.url()).hash.slice('#cairn-return='.length)), url);
    assert.equal(restored.pathname, '/additional-contribution');
    for (const [key, value] of Object.entries(draft)) assert.equal(restored.searchParams.get(key), value);
    await page.getByRole('button', { name: '입력 유지하고 돌아가기', exact: true }).click();
    await expect(notice).toBeVisible();
    for (const [key, value] of Object.entries(draft)) assert.equal(new URL(page.url()).searchParams.get(key), value);
  });

  await check('context-readiness-collected-prices-do-not-claim-analysis-ready-without-fx', async () => {
    await page.goto(url + '/portfolio/holdings?' + new URLSearchParams({ scope: `account:${fxAccount}` }));
    const holding = page.locator(`[data-holding-management="${fxAsset}"]`);
    const details = holding.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^분석 데이터 준비 상태$/ }) });
    await details.locator(':scope > summary').click();
    await expect(details).toContainText('가격 수집 완료');
    await details.getByText('더 필요한 자료', { exact: true }).click();
    await expect(details).toContainText('환율은 서비스에서 보완해야 해요');
    await expect(details.getByRole('button', { name: '과거 가격 준비', exact: true })).toHaveCount(0);
    await expect(details).not.toContainText('분석 준비 완료'); await expect(details).not.toContainText('시뮬레이션 가능');
    await capture('readiness-prices-complete-fx-missing', details);
    assert.ok((await admin.query('select request_count from market_collection_jobs where key=any($1::text[])', [jobs.map(job => job.key)])).rows.every(row => row.request_count === 1), 'reading readiness must not re-enqueue collection');
  });

  await check('context-readiness-conflicting-provider-evidence-needs-service-review', async () => {
    await page.goto(url + '/portfolio/holdings?' + new URLSearchParams({ scope: `account:${conflictAccount}` }));
    const details = page.locator(`[data-holding-management="${conflictAsset}"]`).locator('details').filter({ has: page.locator('summary').filter({ hasText: /^분석 데이터 준비 상태$/ }) });
    await details.locator(':scope > summary').click();
    await expect(details).toContainText('가격 자료 확인 필요 · 서비스에서 확인');
    await expect(details.getByRole('button', { name: '과거 가격 준비', exact: true })).toHaveCount(0);
    await capture('readiness-price-conflict', details);
    await page.goto(url + '/beta/simulation?' + new URLSearchParams({ mode: 'domain', scope: `account:${conflictAccount}`, currency: 'KRW', end: serviceDate, run: '1' }));
    const notice = page.locator('[data-recovery-kind="market_review"]');
    await expect(notice).toBeVisible(); await expect(notice.getByRole('button')).toHaveCount(1);
    await expect(notice).not.toContainText('입력을 유지한 채 돌아올');
    await notice.getByText('확인이 필요한 이유', { exact: true }).click();
    await expect(notice).toContainText('가격 출처가 서로 달라');
    await capture('readiness-beta-conflict-review', notice);
  });
  assert.deepEqual(await financial(), before, 'Readiness and navigation must leave quantities and costs untouched');
}
