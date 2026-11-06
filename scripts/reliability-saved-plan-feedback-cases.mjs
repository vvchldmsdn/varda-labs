import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Actual Next components; synthetic private APIs only. No financial writes.
export async function runSavedPlanFeedbackCases({ page, check, url }) {
  for (const kind of ['plan', 'quick']) for (const switchOwner of [false, true]) {
    await check(`fullapp-${kind}-delete-feedback-${switchOwner ? 'owner-changed' : 'same-owner'}`, async () => {
      await page.setViewportSize({ width: kind === 'plan' ? 390 : 360, height: 844 });
      let actor = 'A', deleted = false, reads = 0;
      const record = { id: '44444444-4444-4444-8444-444444444444', createdAt: new Date().toISOString(),
        input: { currency: 'KRW', amount: 100000, rows: [{ name: 'FEEDBACK-FIXTURE', value: 1000000, targetBps: 10000, instrumentId: null }] } };
      const target = kind === 'plan' ? 'investment-plans' : 'portfolio-drafts';
      const pattern = /\/api\/(investment-plans|portfolio-drafts)$/;
      const handler = async route => {
        const request = route.request(), selected = request.url().endsWith('/' + target);
        if (request.method() === 'DELETE') {
          assert.equal(selected, true);
          assert.equal(request.headers()['x-cairn-plan-session'], 'A');
          deleted = true; if (switchOwner) actor = 'B';
          return route.fulfill({ json: { deleted: true } });
        }
        if (selected) reads++;
        return route.fulfill({ json: { sessionKey: actor,
          [request.url().endsWith('/investment-plans') ? 'plans' : 'drafts']: selected && !deleted ? [record] : [] } });
      };
      await page.route(pattern, handler);
      try {
        await page.goto(url + '/plans');
        await expect(page.getByText('FEEDBACK-FIXTURE', { exact: true })).toBeVisible();
        await page.locator('details > summary').filter({ hasText: /^삭제$/ }).click();
        await page.getByRole('button', { name: kind === 'plan' ? '계획 삭제 확인' : '간편 포트폴리오 삭제 확인', exact: true }).click();
        await expect.poll(() => reads).toBeGreaterThan(1);
        await expect(page.getByText('FEEDBACK-FIXTURE', { exact: true })).toHaveCount(0);
        const feedback = page.getByRole('status').filter({ hasText: '삭제했습니다.' });
        if (switchOwner) await expect(feedback).toHaveCount(0);
        else await expect(feedback).toBeVisible();
      } finally { await page.unroute(pattern, handler); }
    });
  }
}
