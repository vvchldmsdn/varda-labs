import { expect, test, type Page, type Route } from '@playwright/test';

// This spec only runs against the disposable presentation fixture created by
// scripts/neon-egress-browser.mjs. Never point it at production.
test.skip(process.env.CAIRN_EGRESS_BROWSER_QA !== '1', 'Requires the isolated synthetic fixture launcher');
test.describe.configure({ mode: 'serial' });
// The disposable dev server compiles the first route and dynamic detail chunk.
test.setTimeout(240_000);
const binding = 'a'.repeat(64);
const historyEndpoint = '**/beta/api/history/full?*';
const simulationEndpoint = '**/beta/api/simulation?*';
const start = '/qa-neon-egress?mode=domain&scope=all&currency=KRW';

type Fixture = {
  full: Record<string, unknown>;
  simulation: Record<string, unknown>;
};

async function setup(page: Page, baseURL: string | undefined) {
  expect(baseURL && ['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)).toBeTruthy();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL!).origin ? route.continue() : route.abort();
  });
  // Unexpected product APIs must never reach even the dead local DB. The two
  // endpoints below are fulfilled with synthetic evidence by each case.
  await page.route('**/api/**', route => route.abort());
  await page.route('**/api/portfolio/read-session', route => route.fulfill({ json: { binding } }));
  await page.addInitScript(() => {
    const observations: { url: string; aborted: boolean }[] = [];
    Object.assign(window, { __egressFetchObservations: observations });
    const actualFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/beta/api/history/full?') || url.includes('/beta/api/simulation?')) {
        const observation = { url, aborted: init?.signal?.aborted ?? false };
        observations.push(observation);
        init?.signal?.addEventListener('abort', () => { observation.aborted = true; }, { once: true });
      }
      return actualFetch(input, init);
    };
  });
  const response = await page.request.get('/qa-neon-egress-fixture.json');
  expect(response.ok()).toBeTruthy();
  return await response.json() as Fixture;
}

async function fulfill(route: Route, payload: Record<string, unknown>, responseBinding = binding) {
  await route.fulfill({ status: 200, headers: { 'X-Cairn-Display-Binding': responseBinding, 'Cache-Control': 'private, no-store' }, json: payload });
}

async function ready(page: Page) {
  await expect(page.locator('[data-beta-root]')).toHaveAttribute('data-beta-ready', 'true');
  await expect(page.locator('[data-beta-card=history] [data-history-plot] svg')).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(name + '.png'), fullPage: true });
}

for (const [width, height] of [[1440, 900], [390, 844], [360, 800]]) {
  test(`lazy evidence, recovery and owner masking at ${width}px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const fixture = await setup(page, baseURL);
    const historyRequests: string[] = [];
    const simulationRequests: string[] = [];
    let failHistory = false;
    const heldSimulation: Route[] = [];
    // React development StrictMode replays a mounted effect. Its cancelled
    // request must not count as a second live read (production does not replay).
    const expectOneLiveSimulation = async () => {
      await expect.poll(() => heldSimulation.length).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => {
        const records = (window as Window & { __egressFetchObservations?: { url: string; aborted: boolean }[] }).__egressFetchObservations ?? [];
        return records.filter(row => row.url.includes('/simulation?') && !row.aborted).length;
      })).toBe(1);
    };
    const resolveSimulations = async (expectedBinding = binding) => {
      for (const route of heldSimulation.splice(0)) {
        expect(route.request().headers()['x-cairn-display-binding']).toBe(expectedBinding);
        await fulfill(route, fixture.simulation).catch(() => {});
      }
    };
    await page.route(historyEndpoint, async route => {
      historyRequests.push(route.request().url());
      expect(route.request().headers()['x-cairn-display-binding']).toBe(binding);
      if (failHistory) return route.fulfill({ status: 503, json: { error: 'synthetic_unavailable' } });
      await fulfill(route, fixture.full);
    });
    await page.route(simulationEndpoint, route => {
      simulationRequests.push(route.request().url());
      heldSimulation.push(route);
    });

    await page.goto(start);
    await ready(page);
    expect(historyRequests).toHaveLength(0);
    expect(simulationRequests).toHaveLength(0);
    const card = page.locator('[data-beta-card=history]');
    await card.getByRole('button', { name: '전체', exact: true }).click();
    await expect.poll(() => historyRequests.length).toBe(1);
    await expect(card.locator('[data-history-plot] svg')).toBeVisible();
    await card.getByRole('button', { name: '1개월', exact: true }).click();
    await card.getByRole('button', { name: '전체', exact: true }).click();
    expect(historyRequests).toHaveLength(1);
    await page.getByRole('button', { name: '히스토리 확대', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('svg').first()).toBeVisible({ timeout: 60_000 });
    expect(historyRequests).toHaveLength(1);
    await screenshot(page, `history-detail-${width}`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // A distinct visit starts with bounded evidence again. Failed full reads
    // retain period and metric controls; returning to 3M remains possible.
    failHistory = true;
    await page.goto(start);
    await ready(page);
    await card.getByRole('button', { name: '전체', exact: true }).click();
    await expect(card.getByText('전체 이력을 불러오지 못했어요.', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '평가액', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '수익률', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '히스토리 확대', exact: true }).click();
    const failedDetail = page.getByRole('dialog');
    await expect(failedDetail.getByRole('button', { name: '다시 조회', exact: true })).toBeVisible();
    await expect(failedDetail.getByRole('button', { name: '평가액', exact: true })).toBeVisible();
    await expect(failedDetail.getByRole('button', { name: '수익률', exact: true })).toBeVisible();
    await expect(failedDetail.getByRole('button', { name: '3개월', exact: true })).toBeVisible();
    await screenshot(page, `history-failed-detail-${width}`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await card.getByRole('button', { name: '3개월', exact: true }).click();
    await expect(card.locator('[data-history-plot] svg')).toBeVisible();
    await card.getByRole('button', { name: '전체', exact: true }).click();
    await expect(card.getByRole('button', { name: '다시 조회', exact: true })).toBeVisible();
    failHistory = false;
    await card.getByRole('button', { name: '다시 조회', exact: true }).click();
    await expect(card.locator('[data-history-plot] svg')).toBeVisible();
    await screenshot(page, `history-recovered-${width}`);

    await page.goto(start);
    await ready(page);
    const beforeDetail = historyRequests.length;
    await page.getByRole('button', { name: '히스토리 확대', exact: true }).click();
    await expect.poll(() => historyRequests.length).toBe(beforeDetail + 1);
    await expect(page.getByRole('dialog').locator('svg').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(simulationRequests).toHaveLength(0);
    await page.getByRole('button', { name: '시뮬레이션 살펴보기 현재 보유로 가능한 경로를 비교해요', exact: true }).click();
    await expectOneLiveSimulation();
    await expect(page.locator('[data-home-simulation-state=loading]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const records = (window as Window & { __egressFetchObservations?: { url: string; aborted: boolean }[] }).__egressFetchObservations ?? [];
      return records.filter(row => row.url.includes('/simulation?')).at(-1)?.aborted;
    })).toBe(true);
    await resolveSimulations();
    await expect(page.getByText('QA 시뮬레이션 응답', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: '시뮬레이션 살펴보기 현재 보유로 가능한 경로를 비교해요', exact: true }).click();
    await expectOneLiveSimulation();
    await resolveSimulations();
    await expect(page.getByText('QA 시뮬레이션 응답', { exact: true })).toBeVisible();
    await screenshot(page, `simulation-response-${width}`);
    // Change only the synthetic parent generation. This event/control exists
    // exclusively in the disposable app, never in production components.
    await page.evaluate(() => dispatchEvent(new Event('cairn-qa-parent-read')));
    await expectOneLiveSimulation();
    await expect(page.getByText('QA 시뮬레이션 응답', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-home-simulation-state=loading]')).toBeVisible();
    await resolveSimulations('b'.repeat(64));
    await expect(page.getByRole('dialog').getByText('계좌 연결이 바뀌었어요. 화면을 새로고침해 주세요.', { exact: true })).toBeVisible();
    await expect(page.getByText('QA 시뮬레이션 응답', { exact: true })).toHaveCount(0);
    await screenshot(page, `stale-binding-masked-${width}`);
  });
}
