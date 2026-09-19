import { expect, test } from "@playwright/test";

// Real screen components, deterministic preview data; never requires a tenant or market provider.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
  });
});

for (const size of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`screen layout ${size.width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    for (const [name, path] of [["home", "/"], ["today", "/today"], ["structure", "/portfolio/structure"], ["contribution", "/additional-contribution"], ["lab", "/investment-lab"], ["simulation", "/simulation"]]) {
      await page.goto(`${path}?preview=design`);
      await expect(page.locator(".varda-loading")).toHaveCount(0);
      await expect(page.locator("main")).toBeVisible();
      await page.waitForFunction(() => document.fonts.status === "loaded");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `output/desktop-ui/after-${size.width}-${name}.png` });
    }
  });
}

test("selected ring and native select stay in sync without changing segment geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/portfolio/structure?preview=design&scope=all");
  const segments = page.locator('[data-allocation-ring] [role="button"]');
  const before = await segments.evaluateAll(nodes => nodes.map(node => node.getAttribute("d")));
  const select = page.locator("select.cairn-select");
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(segments.nth(1)).toHaveAttribute("aria-pressed", "true");
  await segments.nth(2).click();
  await expect(segments.nth(2)).toHaveAttribute("aria-pressed", "true");
  expect(await segments.evaluateAll(nodes => nodes.map(node => node.getAttribute("d")))).toEqual(before);
  await expect(page.getByRole("link", { name: "상관·위험 보기", exact: true })).toHaveAttribute("href", /scope=all/);
  await expect(page.getByRole("link", { name: "ETF 구성종목 보기" })).toHaveAttribute("href", "/etfs?scope=all");
});

test("expanded simulation retains chart node, unit, mode and selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/simulation?preview=design");
  const chart = page.locator("[data-research-fan-chart]").first();
  const node = await chart.elementHandle();
  await chart.getByRole("button", { name: "시작값 100", exact: true }).click();
  const svg = chart.locator('svg[tabindex="0"]');
  await svg.focus();
  await page.keyboard.press("ArrowDown");
  const selected = await chart.locator("[data-selected-simulation-path]").last().getAttribute("data-selected-simulation-path");
  const expand = page.getByRole("button", { name: "크게 보기", exact: true }).first();
  await expand.click();
  const modal = page.getByRole("dialog", { name: "시뮬레이션 경로", exact: true });
  await expect(modal).toBeVisible();
  const close = modal.getByRole("button", { name: "확대 차트 닫기" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  expect(await chart.evaluate((element, original) => element === original, node)).toBe(true);
  await expect(chart.getByRole("button", { name: "시작값 100", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await modal.boundingBox())!.width).toBeGreaterThan(1300);
  await page.screenshot({ path: "output/desktop-ui/expanded-simulation.png" });
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expect(chart.locator("[data-selected-simulation-path]").last()).toHaveAttribute("data-selected-simulation-path", selected!);
  await chart.getByRole("button", { name: "분포 구간", exact: true }).click();
  await expand.click();
  await expect(chart).toHaveAttribute("data-fan-mode", "band");
  await page.mouse.click(3, 3);
  await expect(modal).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expand.click();
  await modal.getByRole("button", { name: "확대 차트 닫기" }).click();
  await expect(expand).toBeFocused();
});

test("expanded simulation keeps focus when a selected path control disappears or disables", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/simulation?preview=design");
  const chart = page.locator("[data-research-fan-chart]").first();
  const pathNumber = chart.getByRole("spinbutton", { name: "경로 번호" });
  await pathNumber.fill("2");
  const expand = page.getByRole("button", { name: "크게 보기", exact: true }).first();
  await expand.click();
  const modal = page.getByRole("dialog", { name: "시뮬레이션 경로", exact: true });
  const close = modal.getByRole("button", { name: "확대 차트 닫기" });
  const clear = modal.getByRole("button", { name: "경로 선택 해제" });
  await clear.focus();
  await page.keyboard.press("Enter");
  await expect(clear).toHaveCount(0);
  await expect(close).toBeFocused();
  await pathNumber.fill("2");
  const previous = modal.getByRole("button", { name: "이전 경로" });
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(previous).toBeDisabled();
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expect(pathNumber).toHaveValue("1");
});

test("lab navigation geometry stays fixed through pending state; scenario keyboard works", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=design");
  const links = page.locator(".varda-sidebar .varda-sidebar-link");
  const before = await links.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
  await page.route("**/investment-lab?*", async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.locator('.varda-sidebar a[href^="/investment-lab"]').click();
  for (let i = 0; i < 12; i++) {
    const positions = await links.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().y));
    if (positions.length) expect(positions).toEqual(before);
    await page.waitForTimeout(80);
  }
  await expect(page.locator("#investment-lab-scenario-select")).toBeVisible();
  const select = page.locator("#investment-lab-scenario-select");
  const initial = await select.inputValue();
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).not.toHaveValue(initial);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/portfolio/structure?preview=design");
  const selected = page.locator('[data-allocation-ring] [aria-pressed="true"]');
  expect(await selected.evaluate(element => getComputedStyle(element).stroke)).not.toBe("none");
});

test("home relationships and full width FX detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?preview=design");
  await page.getByRole("button", { name: "동반 움직임", exact: true }).click();
  await expect(page.getByText("최근 동반 움직임", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ETF 겹침 상세" })).toHaveCount(0);
  await page.screenshot({ path: "output/desktop-ui/relationships.png" });
  await page.getByRole("button", { name: "변동 근거", exact: true }).click();
  await page.getByRole("button", { name: /환율 추세 살펴보기/ }).click();
  const fx = page.getByRole("img", { name: "원 달러 환율과 60일선, 120일선 추세" });
  expect((await fx.boundingBox())!.width).toBeGreaterThan(650);
  expect((await fx.boundingBox())!.height).toBeGreaterThan(220);
  await page.screenshot({ path: "output/desktop-ui/fx-detail.png" });
});

test("English labels fit desktop and mobile", async ({ page, context }) => {
  await context.addCookies([{ name: "varda-locale", value: "en", url: test.info().project.use.baseURL as string }]);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/portfolio/structure", "/investment-lab", "/simulation"]) {
      await page.goto(`${path}?preview=design`);
      await expect(page.locator(".varda-loading")).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
});
