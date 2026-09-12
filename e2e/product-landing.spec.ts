import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
for (const width of [1440, 390, 320]) {
  test(`landing has two usable entries and readable screenshot fallback at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/start");
    await expect(page.getByRole("link", { name: "샘플로 1분 체험" })).toBeInViewport();
    await expect(page.getByRole("link", { name: "내 포트폴리오 분석하기", exact: true })).toBeInViewport();
    await expect(page.locator("video")).not.toHaveAttribute("src");
    await expect.poll(() => page.locator("picture img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `output/playwright/product-led/landing-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "샘플로 1분 체험" }).click();
    await expect(page.locator('[data-demo-view="home"]')).toBeVisible();
    await page.getByRole("link", { name: "내 포트폴리오로 계속하기" }).click();
    await expect(page.getByRole("heading", { name: "자산 이름과 금액이면 충분해요." })).toBeVisible();
  });
}
test("desktop film can pause and loading failure keeps the real screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/start");
  await page.locator("video").scrollIntoViewIfNeeded();
  await expect(page.locator("video")).toHaveAttribute("src", /desktop\.webm/);
  await expect(page.getByRole("button", { name: "제품 영상 일시정지" })).toBeVisible();
  await page.getByRole("button", { name: "제품 영상 일시정지" }).click();
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await page.route("**/product-demo/*.webm", route => route.abort());
  await page.reload();
  await page.locator("video").scrollIntoViewIfNeeded();
  await expect(page.getByText("영상 대신 실제 화면을 보여드리고 있어요.")).toBeVisible();
  await expect(page.locator("picture img")).toBeVisible();
});
test("mobile does not download video until requested; auth APIs stay closed", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/start");
  await page.locator("video").scrollIntoViewIfNeeded();
  await expect(page.locator("video")).not.toHaveAttribute("src");
  await page.getByRole("button", { name: "제품 영상 재생" }).click();
  await expect(page.locator("video")).toHaveAttribute("src", /mobile\.webm/);
  for (const path of ["/api/investment-plans", "/api/portfolio-drafts"]) {
    const response = await request.get(path);
    expect([401, 403, 503]).toContain(response.status());
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toMatch(/owner_user_id|input_json|postgresql/);
  }
});
