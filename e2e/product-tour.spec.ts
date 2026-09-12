import { test, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const expect = baseExpect.configure({ timeout: 30_000 });
const directory = "output/playwright/product-tour";
test.beforeEach(async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await mkdir(directory, { recursive: true });
  await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

for (const width of [1440, 390, 320]) {
  test(`real public charts and local saving guidance at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const requests: string[] = [];
    page.on("request", request => { requests.push(new URL(request.url()).pathname); });
    await page.goto("/plans");
    await expect(page.getByRole("heading", { name: "현재는 로컬 체험 화면이에요." })).toBeVisible();
    await expect(page.getByRole("link", { name: "투자 랩·시뮬레이션 체험하기" })).toBeVisible();
    await page.getByRole("link", { name: "투자 랩·시뮬레이션 체험하기" }).click();
    const chart = page.locator("[data-lab-chart] svg");
    await expect(chart).toBeVisible();
    await expect(page.getByText("샘플 보유", { exact: true })).toBeVisible();
    await page.getByLabel("비교할 예시 전략").selectOption("voo");
    await expect(chart).toHaveAttribute("aria-label", /샘플/);
    const date = page.getByLabel("비교 그래프 날짜 탐색");
    await date.focus(); await date.press("ArrowLeft");
    await expect(page.locator("[data-lab-tooltip]")).toContainText("선택일의 차이");
    await page.screenshot({ path: `${directory}/plans-lab-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "시뮬레이션", exact: true }).click();
    await expect(page.locator("[data-public-simulation] canvas")).toBeVisible();
    await expect(page.getByText("전체 1,000개", { exact: true })).toBeVisible();
    await page.getByLabel("경로 번호", { exact: true }).fill("42");
    await expect(page.getByLabel("경로 번호", { exact: true })).toHaveValue("42");
    await page.getByRole("button", { name: "분포 구간", exact: true }).click();
    await expect(page.getByRole("button", { name: "분포 구간", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("combobox", { name: "계산 기간", exact: true }).selectOption("126");
    await expect(page.getByLabel("샘플 포트폴리오 경로 시점", { exact: true })).toHaveAttribute("max", "126");
    await page.screenshot({ path: `${directory}/plans-simulation-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(requests.some(path => /^\/api\/(research|portfolio)/.test(path))).toBe(false);
    await page.getByRole("link", { name: "넓은 화면으로 체험하기" }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.locator("[data-lab-chart] svg")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${directory}/explore-${width}.png`, fullPage: true });
  });
}
