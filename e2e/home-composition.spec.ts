import { test, expect } from "@playwright/test";

test.describe("home composition on isolated development fixtures", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) || !url.protocol.startsWith("http") ? route.continue() : route.abort();
    });
  });

  for (const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:768},{width:390,height:844},{width:360,height:800},{width:320,height:800}]) {
    for (const frontend of ["original", "beta"] as const) {
      test(`${frontend} ${viewport.width}: composition, selection and overflow`, async ({ page }, info) => {
        await page.setViewportSize(viewport);
        await page.goto(frontend === "original" ? "/?preview=design" : "/beta?fixture=standard");
        await expect(page.locator(frontend === "original" ? "#portfolio-overview-title" : "[data-beta-card=value]")).toBeVisible();
        const ring = page.locator("[data-allocation-ring]").first();
        await expect(ring).toBeVisible();
        if (frontend === "beta") {
          const width = (await ring.boundingBox())?.width ?? 0;
          expect(width).toBeGreaterThanOrEqual(228);
          expect(width).toBeLessThanOrEqual(232);
        }
        const list = page.getByRole("list", {name:"종목별 비중"});
        const second = list.getByRole("button").nth(1);
        await second.click();
        await expect(second).toHaveAttribute("aria-pressed", "true");
        await expect(ring.getByRole("button",{pressed:true})).toHaveCount(1);
        await page.getByRole("button",{name:/보유 \d+건 모두 보기/}).click();
        await expect(list.getByRole("button")).toHaveCount(frontend === "original" ? 10 : 8);
        await page.getByRole("button",{name:"접기",exact:true}).click();
        await expect(list.getByRole("button")).toHaveCount(5);
        const range = page.getByRole("group",{name:"조회 기간",exact:true});
        await range.getByRole("button",{name:"1개월",exact:true}).click();
        await expect(range.getByRole("button",{name:"1개월",exact:true})).toHaveAttribute("aria-pressed","true");
        await range.getByRole("button",{name:"전체",exact:true}).click();
        await expect(page.locator(frontend === "original" ? 'section[aria-label="종목별 흐름"]' : '[data-beta-card=heatmap]')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(() => scrollTo(0,0));
        await page.screenshot({path:info.outputPath(`${frontend}-${viewport.width}.png`),fullPage:true});
      });
    }
  }

  test("beta mobile: bottom navigation and scope picker keep the account context", async ({page}) => {
    await page.setViewportSize({width:360,height:800});
    await page.goto("/beta?fixture=standard");
    const nav = page.getByRole("navigation", {name:"주요 메뉴"});
    await expect(nav.getByRole("link")).toHaveCount(5);
    await page.locator("[data-beta-card=heatmap]").scrollIntoViewIfNeeded();
    const bounds = await nav.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.round(bounds!.y + bounds!.height)).toBe(800);

    const trigger = page.locator('main > header button[aria-haspopup="dialog"]').first();
    await trigger.click();
    const picker = page.getByRole("dialog", {name:"조회 범위"});
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await picker.getByRole("button", {name:/^계좌 A/}).click();
    await expect(trigger).toContainText("계좌 A");
    await expect(nav.getByRole("link", {name:"자산"})).toHaveAttribute("href", /scope=fixture-account-a/);
  });

  test("original: English labels keep home controls usable", async ({page},info) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto("/?preview=design");
    await page.getByRole("button",{name:"메뉴 열기",exact:true}).click();
    await page.getByRole("button",{name:"Switch to English",exact:true}).click();
    await page.getByRole("button",{name:"Close menu",exact:true}).click();
    await expect(page.getByRole("list",{name:"Allocation by holding"})).toBeVisible();
    const ring = page.locator("[data-allocation-ring]").first();
    await expect(ring.getByRole("group", {name:"Allocation by holding value"})).toBeVisible();
    await expect(ring.getByText("Selected holding", {exact:true})).toBeVisible();
    await expect(ring).not.toContainText("선택한 종목");
    await page.getByRole("group",{name:"Time range",exact:true}).getByRole("button",{name:"1M",exact:true}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath("original-en-390.png"),fullPage:true});
  });

  test("beta: metric, keyboard selection, dialog return and currency", async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    await page.goto("/beta?fixture=standard");
    const metric = page.getByRole("group",{name:"히스토리 보기"});
    await metric.getByRole("button",{name:"수익률",exact:true}).click();
    await expect(metric.getByRole("button",{name:"수익률",exact:true})).toHaveAttribute("aria-pressed","true");
    await metric.getByRole("button",{name:"평가액",exact:true}).click();
    const chart = page.locator("[data-beta-card=history] [data-history-plot] svg");
    await chart.focus();
    await page.keyboard.press("Home");
    await expect(page.locator("[data-beta-card=history] output")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const firstPoint = await chart.getAttribute("aria-label");
    await page.keyboard.press("End");
    await expect(chart).not.toHaveAttribute("aria-label", firstPoint!);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const ring = page.locator("[data-allocation-ring]").first();
    await ring.getByRole("button").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(ring.getByRole("button").nth(1)).toHaveAttribute("aria-pressed","true");
    const expand = page.getByRole("button",{name:"현재 평가액 확대",exact:true});
    await expand.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(expand).toBeFocused();
    const plan = page.getByRole("button",{name:"배분 보기",exact:true});
    await plan.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(plan).toBeFocused();
    await page.getByRole("group",{name:"표시 통화",exact:true}).getByRole("button",{name:"USD",exact:true}).click();
    await expect(page).toHaveURL(/currency=USD/);
    await expect(page.locator("[data-beta-card=value]")).toContainText("USD");
  });

  for (const currency of ["KRW", "USD"]) {
    test(`native ${currency}: same allocation and measured history`, async ({ page },info) => {
      await page.setViewportSize({width:360,height:800});
      await page.goto(`/?preview=native-home&currency=${currency}`);
      await expect(page.locator('[data-surface="home"]')).toBeVisible();
      await expect(page.getByRole("list",{name:"종목별 비중"})).toBeVisible();
      const dates = page.getByRole("slider",{name:"평가 기록 날짜"});
      await expect(dates).toBeVisible();
      await dates.focus();
      await page.keyboard.press("Home");
      await expect(dates).toHaveValue("0");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:info.outputPath(`native-${currency}.png`),fullPage:true});
    });
  }

  for (const fixture of ["empty","partial","large"]) {
    test(`beta ${fixture}: usable controls at 360px with reduced motion`, async ({page},info) => {
      await page.setViewportSize({width:360,height:800});
      await page.emulateMedia({reducedMotion:"reduce"});
      await page.goto(`/beta?fixture=${fixture}`);
      await expect(page.locator("[data-beta-card=value]")).toBeVisible();
      await expect(page.getByRole("group",{name:"조회 기간",exact:true})).toBeVisible();
      await page.getByRole("group",{name:"히스토리 보기"}).getByRole("button",{name:"수익률",exact:true}).click();
      await expect(page.getByRole("group",{name:"히스토리 보기"}).getByRole("button",{name:"평가액",exact:true})).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:info.outputPath(`beta-${fixture}.png`),fullPage:true});
    });
  }
});
