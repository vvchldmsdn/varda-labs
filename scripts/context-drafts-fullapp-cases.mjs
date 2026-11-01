import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

function admit(url, account) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Draft journeys require the isolated local full-app server');
  assert.ok(account, 'Use the runner-owned synthetic account');
}
async function capture(page, output, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function comparisonValues(page) {
  const controls = page.getByRole('region', { name: '공통 비교 조건' });
  await expect(controls.getByRole('textbox', { name: '새 투자금', exact: true })).toHaveValue('240.25');
  await expect(controls.getByRole('combobox', { name: '투자금 통화', exact: true })).toHaveValue('USD');
  await expect(controls.getByRole('combobox', { name: '비교 시점', exact: true })).toHaveValue('90');
  await expect(page.getByRole('spinbutton', { name: /^종목 가격 변화/ })).toHaveValue('10');
  await expect(page.getByRole('spinbutton', { name: /^USD\/KRW 변화/ })).toHaveValue('-5');
}

/** Run after the existing contribution journey has approved targets and admitted FX. No writes. */
export async function runContextComparisonDraftCases({ page, check, admin, account, url, output }) {
  admit(url, account);
  // This USD-funding journey needs current FX, unlike the preceding KRW cases.
  // Seed only the runner's disposable database, never relax production evidence.
  const observed = new Date(Date.now() - 60000).toISOString();
  await admin.query("insert into fx_rates(date,usdkrw,source,status,observed_at,fetched_at,rate_kind) values($1,1400,'synthetic','ok',$2,$2,'spot')", [observed.slice(0, 10), observed]);
  const scope = `account:${account}`;
  for (const beta of [false, true]) {
    await check(`fullapp-context-comparison-draft-${beta ? 'beta-360' : 'original-390'}`, async () => {
      await page.setViewportSize({ width: beta ? 360 : 390, height: beta ? 800 : 844 });
      const query = new URLSearchParams({ scope, currency: 'KRW', amount: '1000000', ...(beta ? { from: 'beta' } : {}) });
      const stale = '/additional-contribution/compare?' + query;
      await page.goto(`${url}${stale}#cairn-return=${encodeURIComponent(stale)}`);
      const controls = page.getByRole('region', { name: '공통 비교 조건' });
      await controls.getByRole('textbox', { name: '새 투자금', exact: true }).fill('240.25');
      await controls.getByRole('combobox', { name: '투자금 통화', exact: true }).selectOption('USD');
      await controls.getByRole('combobox', { name: '비교 시점', exact: true }).selectOption('90');
      await page.getByRole('spinbutton', { name: /^종목 가격 변화/ }).fill('10');
      await page.getByRole('spinbutton', { name: /^USD\/KRW 변화/ }).fill('-5');
      await page.getByText('종목별 변화율 직접 입력', { exact: true }).click();
      const overrides = page.locator('details[open]').filter({ has: page.locator('input[type="number"]') }).getByRole('spinbutton');
      await overrides.first().fill('2.5');
      const rowHints = new URL(page.url()).searchParams.get('scenarioRows');
      assert.ok(rowHints?.includes('2.5'));
      await page.reload();
      await comparisonValues(page);
      assert.equal(new URL(page.url()).searchParams.get('scenarioRows'), rowHints);
      const workflow = page.getByRole('navigation', { name: '추가투입 진행 단계' });
      await workflow.getByRole('link', { name: '목표 설정', exact: true }).click();
      await expect(page).toHaveURL(current => current.pathname.endsWith('/portfolio/targets'));
      const returned = new URL(decodeURIComponent(new URL(page.url()).hash.slice('#cairn-return='.length)), url);
      assert.equal(returned.searchParams.get('amount'), '240.25');
      assert.equal(returned.searchParams.get('currency'), 'USD');
      assert.equal(returned.searchParams.get('scenarioRows'), rowHints);
      await page.getByRole('button', { name: '입력 유지하고 돌아가기', exact: true }).click();
      await expect(page).toHaveURL(current => current.pathname === '/additional-contribution/compare');
      await comparisonValues(page);
      await workflow.getByRole('link', { name: '매수 연결·다시 확인', exact: true }).click();
      await expect(page).toHaveURL(current => current.pathname === '/additional-contribution/tracking');
      await page.reload();
      await page.getByRole('navigation', { name: '추가투입 진행 단계' }).getByRole('link', { name: '계산·저장', exact: true }).click();
      await comparisonValues(page);
      assert.equal(new URL(page.url()).searchParams.get('scenarioRows'), rowHints);
      await page.goBack();
      await expect(page).toHaveURL(current => current.pathname === '/additional-contribution/tracking');
      await page.goForward();
      await comparisonValues(page);
      await capture(page, output, `context-comparison-${beta ? 'beta' : 'original'}`);
      await page.getByRole('link', { name: /추가투입으로 돌아가기/ }).click();
      await expect(page).toHaveURL(current => current.pathname === (beta ? '/beta' : '/additional-contribution'));
      assert.equal(new URL(page.url()).searchParams.has('cashAmountKrw'), false, 'USD funding must not become beta KRW');
      await page.getByRole('button', { name: '입력 유지하고 돌아가기', exact: true }).click();
      await comparisonValues(page);
    });
  }
}

/** Run under the legacy fixture identity: original has a period dialog, beta has inline dates. */
export async function runContextLabDraftCases({ page, check, account, url, output }) {
  admit(url, account);
  const scope = `account:${account}`;
  for (const beta of [false, true]) {
    await check(`fullapp-context-pending-lab-dates-${beta ? 'beta-360' : 'original-390'}`, async () => {
      await page.setViewportSize({ width: beta ? 360 : 390, height: beta ? 800 : 844 });
      const entry = `${url}${beta ? '/beta' : ''}/investment-lab?${new URLSearchParams({ scope, currency: 'KRW', ...(beta ? { mode: 'domain' } : {}) })}`;
      await page.goto(entry);
      const opener = page.getByRole('button', { name: /기간 선택|^\d{4}\.\d{2}\.\d{2} ~ / });
      if (!beta) await opener.click();
      const region = beta ? page.locator('#lab-comparison') : page.getByRole('dialog', { name: '비교 기간', exact: true });
      const start = beta ? region.getByLabel('과거 비교 시작일', { exact: true }) : region.locator('input[name="start"]');
      const end = beta ? region.getByLabel('과거 비교 종료일', { exact: true }) : region.locator('input[name="end"]');
      const appliedStart = new URL(page.url()).searchParams.get('start');
      const appliedEnd = new URL(page.url()).searchParams.get('end');
      // Do not execute a different calculation. Even pending/invalid date choices must survive.
      await start.fill('2026-08-17'); await end.fill('2026-09-02');
      assert.equal(new URL(page.url()).searchParams.get('start'), appliedStart);
      assert.equal(new URL(page.url()).searchParams.get('end'), appliedEnd);
      assert.ok(new URL(page.url()).searchParams.get('_labDraft'));
      if (!beta) {
        await region.getByRole('button', { name: '닫기', exact: true }).click();
        await opener.click();
        await expect(start).toHaveValue('2026-08-17'); await expect(end).toHaveValue('2026-09-02');
      } else await expect(region).toHaveAttribute('data-lab-state', 'dirty');
      await page.reload();
      if (!beta) await opener.click();
      await expect(start).toHaveValue('2026-08-17'); await expect(end).toHaveValue('2026-09-02');
      await capture(page, output, `context-lab-dates-${beta ? 'beta' : 'original'}`);
      if (!beta) await region.getByRole('button', { name: '닫기', exact: true }).click();
      await page.goto(entry);
      if (!beta) await opener.click();
      assert.notEqual(await start.inputValue(), '2026-08-17', 'an explicit fresh URL must clear the pending draft');
      if (!beta) await region.getByRole('button', { name: '닫기', exact: true }).click();
    });
  }
}
