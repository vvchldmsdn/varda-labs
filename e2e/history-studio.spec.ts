import { test, expect } from "@playwright/test";

test.describe("beta history studio in the isolated application", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    await page.route("**/*", route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname) && url.protocol.startsWith("http")) return route.abort();
      if (url.pathname === "/api/member-activity") return route.fulfill({ status: 204 });
      return route.continue();
    });
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`${viewport.width}px keeps dates, accessible modes, and the selected day through expansion`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/beta?fixture=standard&preview=design");
      const home = page.locator("[data-beta-card=history]");
      const studio = home.locator("[data-history-studio]");
      await expect(studio).toHaveAttribute("data-mode", "value");
      await studio.getByRole("button", { name: "지난달", exact: true }).click();
      await studio.getByRole("button", { name: "직접 선택", exact: true }).click();
      await studio.getByLabel("시작일", { exact: true }).fill("2026-09-30");
      await studio.getByLabel("종료일", { exact: true }).fill("2026-09-01");
      await studio.getByRole("button", { name: "적용", exact: true }).click();
      await expect(studio.getByLabel("종료일", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(studio.getByLabel("시작일", { exact: true })).toHaveValue("2026-09-30");
      await studio.getByLabel("시작일", { exact: true }).fill("2026-09-01");
      await studio.getByLabel("종료일", { exact: true }).fill("2026-09-30");
      await studio.getByRole("button", { name: "적용", exact: true }).click();
      await expect(studio.getByLabel("시작일", { exact: true })).toHaveCount(0);
      const chart = studio.locator("[data-history-plot] svg");
      await chart.focus();
      await page.keyboard.press("Home");
      await expect(studio.locator("[data-studio-selected-date]")).toHaveAttribute("data-studio-selected-date", "2026-09-01");
      await page.keyboard.press("End");
      await expect(studio.locator("[data-studio-selected-date]")).toHaveAttribute("data-studio-selected-date", "2026-09-30");
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`home-${viewport.width}.png`), fullPage: true });

      for (const [label, mode] of [["가격·환율", "impact"], ["가상 비교", "compare"]] as const) {
        await studio.getByRole("button", { name: label, exact: true }).click();
        await expect(studio).toHaveAttribute("data-mode", mode);
        await expect(studio.getByRole("status")).toContainText("내 계좌를 연결하면");
        await expect(studio.getByRole("button", { name: "지난달", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await studio.getByRole("button", { name: "평가 추이", exact: true }).click();
      await expect(studio.locator("[data-studio-selected-date]")).toHaveAttribute("data-studio-selected-date", "2026-09-30");

      const expand = home.getByRole("button", { name: "히스토리 확대", exact: true });
      await expand.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("[data-history-studio]")).toHaveAttribute("data-mode", "value");
      await expect(dialog.locator("[data-studio-selected-date]")).toHaveAttribute("data-studio-selected-date", "2026-09-30");
      await dialog.getByRole("button", { name: "수익률", exact: true }).first().click();
      await expect(dialog.getByRole("button", { name: "평가 추이", exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "평가 추이", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`detail-${viewport.width}.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(expand).toBeFocused();
      await expect(studio.locator("[data-studio-selected-date]")).toHaveAttribute("data-studio-selected-date", "2026-09-30");
    });
  }

  test("empty history retains the mode controls and never creates impact or benchmark amounts", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/beta?fixture=empty&preview=design");
    const studio = page.locator("[data-beta-card=history] [data-history-studio]");
    for (const label of ["수익률", "가격·환율", "가상 비교", "평가 추이"]) {
      await studio.getByRole("button", { name: label, exact: true }).click();
      await expect(studio.getByRole("button", { name: "평가 추이", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
});
