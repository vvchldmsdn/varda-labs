import assert from 'node:assert/strict';
import path from 'node:path';
import { expect } from '@playwright/test';

const returnLabel = '입력 유지하고 돌아가기';
const nativeRegion = page => page.getByRole('region', { name: '추가 투자 계획', exact: true });
const targetNotice = surface => surface.locator('[data-recovery-kind="targets"]');

function assertDraft(location, pathname, draft, hash = '') {
  const current = new URL(location, 'http://127.0.0.1');
  assert.equal(current.pathname, pathname);
  assert.equal(current.hash, hash);
  for (const [key, value] of Object.entries(draft)) {
    assert.deepEqual(current.searchParams.getAll(key), Array.isArray(value) ? value : [value], `Recovery must preserve ${key}`);
  }
}

function assertRecoveryFragment(location, pathname, draft, hash = '') {
  const fragment = new URL(location).hash;
  assert.ok(fragment.startsWith('#cairn-return='), 'Resolution must carry the explicit return fragment');
  assertDraft(decodeURIComponent(fragment.slice('#cairn-return='.length)), pathname, draft, hash);
}

function assertReturnFragment(page, pathname, draft, hash = '') {
  assertRecoveryFragment(page.url(), pathname, draft, hash);
}

async function captureWidths(page, output, name, focus) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await focus.scrollIntoViewIfNeeded();
    await expect(focus).toBeInViewport();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: overflow at ${width}px`);
    await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function openExclusions(surface) {
  const picker = surface.locator('summary').filter({ hasText: /^매도 제외 종목/ }).locator('..');
  if (await picker.getAttribute('open') === null) await picker.locator(':scope > summary').click();
  return picker;
}

async function assertNativeInputs(page, draft) {
  const planner = nativeRegion(page);
  await expect(planner.getByRole('textbox', { name: '새 투자금', exact: true })).toHaveValue(draft.amount);
  await expect(planner.getByRole('combobox', { name: '투자금 통화', exact: true })).toHaveValue(draft.fundingCurrency);
  await expect(planner.getByRole('checkbox', { name: /^보유 현금도 사용/ })).toBeChecked({ checked: draft.useCash === '1' });
  const picker = await openExclusions(planner);
  await expect.poll(() => picker.locator('input[name="excludeSell"]:checked').evaluateAll(inputs => inputs.map(input => input.value).sort())).toEqual([...draft.excludeSell].sort());
  return planner;
}

/** Real Next reads/actions in the existing disposable full-app identity. No DB access or result mocks. */
export async function runRecoveryUiCases({ page, check, account, asset, url, output }) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'Recovery UI cases require the isolated local full-app server');
  assert.ok(account && asset, 'Use the existing synthetic account and holding');
  const scope = `account:${account}`;
  const draft = { scope, currency: 'KRW', amount: '125.50', fundingCurrency: 'USD', useCash: '1', excludeSell: [asset] };
  const nativeQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(draft)) for (const entry of Array.isArray(value) ? value : [value]) nativeQuery.append(key, entry);
  const nativeHref = `${url}/additional-contribution?${nativeQuery}`;
  const isNativeGet = response => {
    const parsed = new URL(response.url());
    return parsed.pathname === '/api/native-contribution-plans' && parsed.searchParams.get('scope') === scope && response.request().method() === 'GET';
  };

  await check('fullapp-recovery-risk-history-shortage-holdings-add-return-scope', async () => {
    const riskDraft = { scope, window: '30' };
    await page.goto(`${url}/portfolio/risk?${new URLSearchParams(riskDraft)}`);
    const risk = page.locator('main[data-page="portfolio-risk"]');
    await expect(risk.getByRole('heading', { name: '상관관계를 계산할 근거가 부족합니다.', exact: true })).toBeVisible();
    await expect(risk).toContainText('0/30');
    const shortage = risk.locator('[data-recovery-kind="market"]');
    await expect(shortage).toBeVisible();
    // The real one-holding/zero-history model has null end weights, hence
    // invalid_input. Its separate coverage evidence must still guide to data preparation.
    await shortage.getByText('상세 확인 사유', { exact: true }).click();
    await expect(shortage.locator('details[open]')).toContainText('invalid_input');
    await shortage.getByRole('button', { name: '분석 데이터 준비 확인', exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/holdings\?/);
    assert.equal(new URL(page.url()).searchParams.get('scope'), scope);
    assertReturnFragment(page, '/portfolio/risk', riskDraft);
    await expect(page.locator('[data-recovery-return]').getByRole('button', { name: returnLabel, exact: true })).toBeVisible();
    const holding = page.locator(`[data-holding-management="${asset}"]`);
    await expect(holding).toBeVisible();
    await holding.getByText('분석 데이터 준비 상태', { exact: true }).click();
    await expect(holding.locator('details[open]')).toBeVisible();
    const bodyAdd = page.locator('main.varda-secondary-page > section [data-cairn-page-header]').getByRole('link', { name: '종목 추가', exact: true });
    const addLinks = [
      ['page action', bodyAdd],
      ['top bar', page.locator('.varda-topbar-add')],
      ['mobile menu', page.locator('.varda-mobile-menu a[href^="/portfolio/holdings/new"]')],
    ];
    for (const [location, link] of addLinks) {
      await expect(link, `${location}: one explicit add-holding link`).toHaveCount(1);
      await expect(link, `${location}: return fragment survives hydration`).toHaveAttribute('href', /#cairn-return=/);
      const destination = new URL(await link.getAttribute('href'), url);
      assert.equal(destination.pathname, '/portfolio/holdings/new', `${location}: correct destination`);
      assert.equal(destination.searchParams.get('scope'), scope, `${location}: account scope preserved`);
      assertRecoveryFragment(destination.href, '/portfolio/risk', riskDraft);
    }
    await bodyAdd.click();
    await expect(page).toHaveURL(/\/portfolio\/holdings\/new\?/);
    assert.equal(new URL(page.url()).searchParams.get('scope'), scope);
    assertReturnFragment(page, '/portfolio/risk', riskDraft);
    await expect(page.getByRole('combobox', { name: '보유 계좌', exact: true })).toHaveValue(account);
    await expect(page.getByRole('link', { name: '거래·현금 원장에서 계속하기', exact: true })).toBeVisible();
    await captureWidths(page, output, 'recovery-risk-add-holding-return', page.getByRole('button', { name: returnLabel, exact: true }));
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(risk.locator('[data-recovery-kind="market"]')).toBeVisible();
    assertDraft(page.url(), '/portfolio/risk', riskDraft);
  });

  await check('fullapp-recovery-native-empty-history-ledger-return-keeps-timezone', async () => {
    const historyQuery = { scope, currency: 'KRW' };
    await page.goto(`${url}/history?${new URLSearchParams(historyQuery)}`);
    await expect(page.getByRole('heading', { name: '확인된 평가 기록', exact: true })).toBeVisible();
    await expect(page.getByText('과거 수량과 가격 시각이 확인돼야 비교할 수 있어요.', { exact: true })).toBeVisible();
    await page.locator('summary').filter({ hasText: /^시간대 · / }).click();
    await page.getByRole('combobox', { name: '표시 시간대', exact: true }).selectOption('UTC');
    const historyDraft = { ...historyQuery, _nativeView: JSON.stringify({ version: 1, scope, view: 'history', currency: 'KRW', zone: 'UTC', selected: '' }) };
    await page.locator('[data-recovery-kind="trades"]').getByRole('button', { name: '거래 기록 확인하기', exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/ledger\?/);
    await expect(page.getByRole('heading', { name: '매매·현금 기록', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '계좌', exact: true })).toHaveValue(account);
    assertReturnFragment(page, '/history', historyDraft);
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(page.getByRole('heading', { name: '확인된 평가 기록', exact: true })).toBeVisible();
    assertDraft(page.url(), '/history', historyDraft);
    await page.locator('summary').filter({ hasText: /^시간대 · UTC$/ }).click();
    await expect(page.getByRole('combobox', { name: '표시 시간대', exact: true })).toHaveValue('UTC');
    await expect(page.getByText('과거 수량과 가격 시각이 확인돼야 비교할 수 있어요.', { exact: true })).toBeVisible();
    await captureWidths(page, output, 'recovery-native-history-return', page.getByRole('combobox', { name: '표시 시간대', exact: true }));
  });

  await check('fullapp-recovery-beta-live-and-empty-history-display-return', async () => {
    await page.goto(`${url}/beta/history?${new URLSearchParams({ mode: 'domain', scope, currency: 'KRW' })}`);
    await expect(page.getByText('현재 평가 · 저장 전', { exact: true })).toBeVisible();
    const periods = page.getByRole('group', { name: '히스토리 기간', exact: true });
    const metrics = page.getByRole('group', { name: '히스토리 보기', exact: true });
    await periods.getByRole('button', { name: '6M', exact: true }).click();
    await expect(periods.getByRole('button', { name: '6M', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const displayDraft = { mode: 'domain', scope, currency: 'KRW', _historyViewPeriod: '6M', _historyViewMetric: 'value', _historyViewScope: scope, _historyViewCurrency: 'KRW' };
    const openRecords = async expected => {
      await page.locator('[data-recovery-kind="history"]').getByRole('button', { name: '저장 기록 확인하기', exact: true }).click();
      await expect(page).toHaveURL(/\/history\?/);
      assert.equal(new URL(page.url()).pathname, '/history');
      assert.equal(new URL(page.url()).searchParams.get('detail'), 'raw');
      assertReturnFragment(page, '/beta/history', expected, '#history-evidence');
      const back = new URL(decodeURIComponent(new URL(page.url()).hash.slice('#cairn-return='.length)), url);
      assert.equal(back.searchParams.has('_historyDate'), false, 'A live/empty view must not invent a saved date');
      // This account is native: its actual /history route shows dated valuations,
      // not the legacy raw table. Check that surface rather than claiming a fake raw record.
      await expect(page.getByRole('heading', { name: '확인된 평가 기록', exact: true })).toBeVisible();
      await expect(page.getByText('과거 수량과 가격 시각이 확인돼야 비교할 수 있어요.', { exact: true })).toBeVisible();
    };
    await openRecords(displayDraft);
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(page.getByText('현재 평가 · 저장 전', { exact: true })).toBeVisible();
    assertDraft(page.url(), '/beta/history', displayDraft, '#history-evidence');
    await expect(periods.getByRole('button', { name: '6M', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(metrics.getByRole('button', { name: '평가액', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await captureWidths(page, output, 'recovery-beta-live-history-return', periods.getByRole('button', { name: '6M', exact: true }));

    // Choose the metric in the real controls before the empty state hides them.
    await metrics.getByRole('button', { name: '수익률', exact: true }).click();
    await expect(page.getByText('저장된 평가가 없습니다.', { exact: true })).toBeVisible();
    const emptyDraft = { ...displayDraft, _historyViewMetric: 'return' };
    await openRecords(emptyDraft);
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(page.getByText('저장된 평가가 없습니다.', { exact: true })).toBeVisible();
    assertDraft(page.url(), '/beta/history', emptyDraft, '#history-evidence');
    await expect(page.locator('[data-history-return]')).toHaveCount(0);
    await captureWidths(page, output, 'recovery-beta-empty-history-return', page.locator('[data-recovery-kind="history"]').getByRole('button', { name: '저장 기록 확인하기', exact: true }));
    // Reopening regenerates the href from the applied preferences. This catches
    // URL-only restoration that silently resets the hidden period/metric state.
    await openRecords(emptyDraft);
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(page.getByText('저장된 평가가 없습니다.', { exact: true })).toBeVisible();
    await page.locator('[data-beta-root] > aside[aria-label="목적별 내비게이션"]').getByRole('link', { name: '홈', exact: true }).click();
    await expect(page.locator('[data-beta-card="history"]').getByRole('button', { name: '수익률', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  async function openMissingNative() {
    const loaded = page.waitForResponse(isNativeGet);
    await page.goto(nativeHref);
    const response = await loaded;
    assert.equal(response.status(), 200);
    const payload = await response.json();
    assert.equal(payload.context.status, 'blocked');
    assert.equal(payload.context.reason, 'approved_targets_required');
    await expect(targetNotice(nativeRegion(page))).toBeVisible();
  }

  async function enterTargetResolution() {
    await openMissingNative();
    await targetNotice(nativeRegion(page)).getByRole('button', { name: '목표비중 설정하기', exact: true }).click();
    await expect(page).toHaveURL(/\/portfolio\/targets\?/);
    await expect(page.locator('input[name="targetWeight:0"]')).toBeVisible();
    await expect(page.locator('[data-recovery-return]').getByRole('button', { name: returnLabel, exact: true })).toBeVisible();
    assertReturnFragment(page, '/additional-contribution', draft);
  }

  await check('fullapp-recovery-original-missing-targets-return-preserves-draft', async () => {
    await enterTargetResolution();
    await captureWidths(page, output, 'recovery-original-target-return', page.getByRole('button', { name: returnLabel, exact: true }));
    const loaded = page.waitForResponse(isNativeGet);
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    assert.equal((await (await loaded).json()).context.reason, 'approved_targets_required');
    await expect(targetNotice(nativeRegion(page))).toBeVisible();
    assertDraft(page.url(), '/additional-contribution', draft);
    await captureWidths(page, output, 'recovery-original-targets-missing', targetNotice(nativeRegion(page)).getByRole('button', { name: '목표비중 설정하기', exact: true }));
  });

  await check('fullapp-recovery-beta-missing-targets-return-preserves-edited-inputs', async () => {
    const betaDraft = { mode: 'domain', scope, currency: 'KRW', cashAmountKrw: '246800', excludeSell: [`${account}:${asset}`] };
    await page.goto(`${url}/beta?${new URLSearchParams({ mode: 'domain', scope, currency: 'KRW', cashAmountKrw: '235000' })}#beta-contribution`);
    const dialog = page.getByRole('dialog', { name: '추가 투자', exact: true });
    await expect(dialog).toBeVisible();
    await expect(targetNotice(dialog)).toBeVisible();
    await dialog.getByRole('textbox', { name: '신규 투자금', exact: true }).fill(betaDraft.cashAmountKrw);
    const picker = await openExclusions(dialog);
    await picker.locator(`input[name="excludeSell"][value="${account}:${asset}"]`).check();
    await targetNotice(dialog).getByRole('button', { name: '목표비중 설정하기', exact: true }).click();
    await expect(page).toHaveURL(/\/beta\/portfolio\/targets\?/);
    await expect(page.locator('[data-target-editor-state="ready"]')).toBeVisible();
    await expect(page.getByRole('button', { name: returnLabel, exact: true })).toBeVisible();
    assertReturnFragment(page, '/beta', betaDraft, '#beta-contribution');
    await page.getByRole('button', { name: returnLabel, exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(targetNotice(dialog)).toBeVisible();
    assertDraft(page.url(), '/beta', betaDraft, '#beta-contribution');
    await expect(dialog.getByRole('textbox', { name: '신규 투자금', exact: true })).toHaveValue('246,800');
    await openExclusions(dialog);
    await expect(picker.locator(`input[name="excludeSell"][value="${account}:${asset}"]`)).toBeChecked();
    await captureWidths(page, output, 'recovery-beta-targets-missing', targetNotice(dialog).getByRole('button', { name: '목표비중 설정하기', exact: true }));
  });

  return {
    // The caller performs its existing first target save here, exactly once.
    enterTargetResolution,
    async returnAfterApproval() {
      assertReturnFragment(page, '/additional-contribution', draft);
      const loaded = page.waitForResponse(isNativeGet);
      await page.getByRole('button', { name: returnLabel, exact: true }).click();
      const response = await loaded;
      assert.equal(response.status(), 200);
      const payload = await response.json();
      assert.equal(payload.context.status, 'ready');
      const planner = await assertNativeInputs(page, draft);
      assertDraft(page.url(), '/additional-contribution', draft);
      await captureWidths(page, output, 'recovery-original-target-saved', planner.getByRole('textbox', { name: '새 투자금', exact: true }));
      return payload;
    },
    async retryNativeRead() {
      await check('fullapp-recovery-native-one-get-failure-retry-keeps-edited-draft', async () => {
        const typed = { ...draft, amount: '237.75' };
        const planner = nativeRegion(page);
        await planner.getByRole('combobox', { name: '투자금 통화', exact: true }).selectOption('USD');
        await planner.getByRole('textbox', { name: '새 투자금', exact: true }).fill(typed.amount);
        await planner.getByRole('checkbox', { name: /^보유 현금도 사용/ }).check();
        const picker = await openExclusions(planner);
        await picker.locator(`input[name="excludeSell"][value="${asset}"]`).check();
        await planner.getByRole('link', { name: '승인된 목표 비중 변경 →', exact: true }).click();
        await expect(page.getByRole('button', { name: returnLabel, exact: true })).toBeVisible();
        assertReturnFragment(page, '/additional-contribution', typed);
        let aborted = 0, recovered = 0;
        const pattern = '**/api/native-contribution-plans?**';
        const interruptOneGet = async route => {
          const request = route.request(), parsed = new URL(request.url());
          if (request.method() === 'GET' && parsed.searchParams.get('scope') === scope) {
            if (aborted === 0) { aborted++; await route.abort('failed'); return; }
            recovered++;
          }
          await route.continue();
        };
        await page.route(pattern, interruptOneGet);
        try {
          await page.getByRole('button', { name: returnLabel, exact: true }).click();
          const retry = planner.locator('[data-recovery-kind="retry"]').getByRole('button', { name: '다시 불러오기', exact: true });
          await expect(retry).toBeVisible();
          assert.equal(aborted, 1);
          assertDraft(page.url(), '/additional-contribution', typed);
          await captureWidths(page, output, 'recovery-native-read-failed', retry);
          const loaded = page.waitForResponse(isNativeGet);
          await retry.click();
          const response = await loaded;
          assert.equal(response.status(), 200);
          assert.equal((await response.json()).context.status, 'ready');
          await assertNativeInputs(page, typed);
          assert.equal(aborted, 1); assert.equal(recovered, 1, 'Retry must perform one fresh read');
          await expect(planner.locator('[data-recovery-kind="retry"]')).toHaveCount(0);
          await captureWidths(page, output, 'recovery-native-read-recovered', planner.getByRole('textbox', { name: '새 투자금', exact: true }));
        } finally { await page.unroute(pattern, interruptOneGet); }
      });
    },
  };
}
