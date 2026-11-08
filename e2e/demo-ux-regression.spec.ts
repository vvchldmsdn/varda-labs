import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const artifacts = "output/playwright/demo-ux-fixes";
test.beforeEach(async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await mkdir(artifacts, { recursive: true });
  await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1180, height: 757 });
});

test("P1 account shortcuts, detail return and browser back keep their scope", async ({ page }) => {
  test.setTimeout(180_000);
  for (const [account, label] of [["all", "전체"], ["brokerage", "증권"], ["isa", "ISA"], ["irp", "IRP"]]) {
    await page.goto(`/demo/home?account=${account}`);
    const change = await page.getByText("샘플 일일 변동", { exact: true }).locator("..").locator("dd").innerText();
    await page.getByRole("link", { name: "오늘 왜 움직였는지 →", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/demo/today\\?account=${account}$`));
    await expect(page.getByRole("navigation", { name: "샘플 계좌 선택" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("샘플 일일 변동", { exact: true }).locator("..").locator("strong")).toHaveText(change);
    await page.locator('[data-holding-detail-trigger="row"]:visible').first().click();
    await expect(page.locator("[data-holding-dialog]")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`account=${account}&holding=`));
    await page.getByRole("button", { name: "종목 상세 닫기", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/demo/today\\?account=${account}$`));
    await page.getByRole("navigation", { name: "체험 화면" }).getByRole("link", { name: "홈", exact: true }).click();
    await page.getByRole("link", { name: "포트 구조 →", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/demo/structure\\?account=${account}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/demo/home\\?account=${account}$`));
    await expect(page.getByRole("navigation", { name: "샘플 계좌 선택" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.screenshot({ path: `${artifacts}/scope-1180.png` });
});

test("P1 unapproved structure targets stay absent while sample allocation works", async ({ page }) => {
  await page.goto("/demo/structure?account=all");
  const evidence = page.getByRole("complementary", { name: "선택 종목 근거", exact: true });
  await expect(evidence.getByText("목표 비중", { exact: true }).locator("..").locator("dd")).toHaveText("목표 없음");
  await expect(evidence.getByText("편차", { exact: true }).locator("..").locator("dd")).toHaveText("-");
  await expect(evidence).toContainText("승인 목표가 없어");
  await evidence.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${artifacts}/targets-1180.png` });
  await page.getByRole("navigation", { name: "체험 화면" }).getByRole("link", { name: "추가투입", exact: true }).click();
  const list = page.getByRole("list", { name: "종목별 배분 결과", exact: true });
  await expect(list).toBeVisible();
  const before = await list.innerText();
  await page.getByRole("combobox", { name: "샘플 목표 비중", exact: true }).selectOption("equal");
  await expect(list).not.toHaveText(before);
});

test("P2 English stays reactive across every demo view, errors and reload", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/demo/home?account=isa");
  await page.getByRole("button", { name: "Switch to English", exact: true }).click();
  const pages = [
    ["Home", "Your portfolio at a glance"], ["Today", "What moved today?"], ["Allocation", "Your portfolio mix"],
    ["Contribute", "How will your next investment fit?"], ["Investment Lab", "Explore a different choice"],
    ["Simulation", "Explore possible outcomes"], ["History", "Your portfolio over time"],
  ];
  const remainingKorean: Record<string, string[]> = {};
  for (const [label, title] of pages) {
    await page.getByRole("navigation", { name: "Demo pages" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page).toHaveURL(/account=isa/);
    await expect(page.locator("main > header")).toContainText("Demo · Sample data");
    await expect(page.locator("main > footer")).toContainText("Sample data, not live prices");
    await expect(page.locator("main > footer")).not.toContainText("샘플");
    if (label === "Contribute") {
      const amount = page.getByRole("textbox", { name: "Additional investment · KRW", exact: true });
      await amount.fill("-1");
      await expect(page.locator("#demo-amount-error")).toHaveAttribute("role", "alert");
      await expect(page.locator("#demo-amount-error")).toContainText("Enter a whole amount");
      await amount.fill("1234567");
      await page.getByRole("button", { name: "한국어로 전환", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "추가 투자금 · 원", exact: true })).toHaveValue("1,234,567");
      await page.getByRole("button", { name: "Switch to English", exact: true }).click();
      await expect(amount).toHaveValue("1,234,567");
      const accounts = page.getByRole("navigation", { name: "Sample accounts" });
      await accounts.getByRole("link", { name: "All", exact: true }).click();
      await expect(page).toHaveURL(/\/demo\/contribution\?account=all$/);
      await expect(accounts.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("body")).toContainText("KODEX 200");
      await expect(page.locator("body")).not.toContainText(/여러 계좌|미배분|기타 \d+종목|체험용/);
      remainingKorean["Contribute all accounts"] = (await page.locator("body").innerText()).split("\n").filter(line => /[가-힣]/u.test(line));
      await page.screenshot({ path: `${artifacts}/english-contribution-all-1180.png` });
      await accounts.getByRole("link", { name: "ISA", exact: true }).click();
      await expect(page).toHaveURL(/\/demo\/contribution\?account=isa$/);
      await expect(accounts.getByRole("link", { name: "ISA", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("body")).not.toContainText("KODEX 200");
    }
    if (label === "Simulation") {
      await expect(page.locator("[data-public-simulation] canvas")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByLabel("Sample portfolio: path step", { exact: true })).toBeVisible();
    }
    remainingKorean[label] = (await page.locator("body").innerText()).split("\n").filter(line => /[가-힣]/u.test(line));
    await page.screenshot({ path: `${artifacts}/english-${label.toLowerCase().replaceAll(" ", "-")}-1180.png` });
  }
  await writeFile(`${artifacts}/english-text-audit.json`, JSON.stringify(remainingKorean, null, 2));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your portfolio over time");
  await expect(page).toHaveTitle("Sample history | CAIRN LABS");
  await page.screenshot({ path: `${artifacts}/english-1180.png` });
});

test("P2 English sample loading failure and retry retain the selected account", async ({ page, baseURL }) => {
  let fail = true;
  await page.route("**/api/public-demo?*", route => fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  await page.context().addCookies([{ name: "varda-locale", value: "en", url: baseURL! }]);
  await page.goto("/demo/simulation?account=irp");
  await expect(page.getByRole("alert").filter({ hasText: "Could not load the example." })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator("[data-public-simulation] canvas")).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/account=irp/);
});

for (const width of [1180, 1100, 1240, 1050, 1440, 1366, 390, 360, 320]) {
  test(`P2 currency fits and inputs survive language changes at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 360 ? 800 : 757 });
    await page.goto("/try/analyze");
    const currency = page.getByRole("combobox", { name: "자산 1 입력 통화", exact: true });
    await expect(currency).toBeVisible();
    await page.getByRole("textbox", { name: "자산 1 금액", exact: true }).fill("1234567");
    await currency.selectOption("USD");
    await page.getByRole("button", { name: "Switch to English", exact: true }).click();
    const englishCurrency = page.getByRole("combobox", { name: "Asset 1 input currency", exact: true });
    await expect(englishCurrency).toHaveValue("USD");
    await expect(page.getByRole("textbox", { name: "Asset 1 amount", exact: true })).toHaveValue("1,234,567");
    const space = await englishCurrency.evaluate(el => {
      const style = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      ctx.font = `${style.fontSize} ${style.fontFamily}`;
      return { available: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20, required: Math.max(ctx.measureText("KRW").width, ctx.measureText("USD").width) };
    });
    expect(space.available).toBeGreaterThanOrEqual(space.required);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await englishCurrency.selectOption("KRW");
    await page.screenshot({ path: `${artifacts}/currency-${width}.png`, fullPage: true });
  });
}

for (const width of [390, 360, 320]) {
  test(`P1 P2 mobile sample navigation and translated controls at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/demo/home?account=isa");
    await page.getByRole("button", { name: "Switch to English", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your portfolio at a glance");
    await page.getByRole("link", { name: "What moved today →", exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/today\?account=isa$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/demo\/home\?account=isa$/);
    await expect(page.getByRole("navigation", { name: "Sample accounts" }).getByRole("link", { name: "ISA", exact: true })).toHaveAttribute("aria-current", "page");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${artifacts}/home-en-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "Portfolio mix →", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your portfolio mix");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${artifacts}/structure-en-${width}.png`, fullPage: true });
  });
}
