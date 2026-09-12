import { mkdir } from "node:fs/promises";
import { expect as baseExpect, test, type Page } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 20_000 });

// API/session responses below are browser-test doubles, not a real authentication test.
// Public calculator interactions use the actual application with no API substitution.
const STORAGE = "varda.investment-plan.v1";
const widths = [1440, 390, 320];
const directory = "output/playwright/first-visit";
type Input = { currency: "KRW"; amount: number; rows: { name: string; value: number; targetBps: number }[] };
type Draft = { version: number; id: string; expiresAt: number; input: Input };
type Saved = { id: string; input: Input; createdAt: string };

test.beforeEach(async ({ baseURL, page }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  await mkdir(directory, { recursive: true });
  // Tests must not send requests to external providers or analytics endpoints.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname)) await route.continue();
    else await route.abort();
  });
});

async function ownInput(page: Page) {
  await page.goto("/try?mode=personal");
  await expect(page.getByLabel("자산 1 이름", { exact: true })).toBeEditable();
  await page.getByLabel("자산 1 이름", { exact: true }).fill("My equity fixture");
  await page.getByLabel("자산 1 평가금액", { exact: true }).fill("800000");
  await page.getByLabel("자산 1 목표 비중", { exact: true }).fill("60");
  await page.getByLabel("자산 2 이름", { exact: true }).fill("My bond fixture");
  await page.getByLabel("자산 2 평가금액", { exact: true }).fill("200000");
  await page.getByLabel("자산 2 목표 비중", { exact: true }).fill("40");
  await page.getByLabel("이번 추가 투자금", { exact: false }).fill("100000");
}

async function calculate(page: Page) {
  await page.getByRole("button", { name: "내 배분 결과 보기" }).click();
  await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toBeVisible();
  expect(page.url()).toMatch(/\/try\?mode=personal$/);
}

async function capture(page: Page, name: string, width: number) {
  await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${directory}/${name}-${width}.png`, fullPage: true });
}

for (const width of widths) {
  test(`public sample, private inputs, validation and draft lifetime at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/start");
    await expect(page.getByRole("heading", { name: "이번 달 투자금," })).toBeVisible();
    await expect(page.getByRole("link", { name: "샘플로 계산해보기" })).toBeInViewport();
    await capture(page, "start", width);
    await page.getByRole("link", { name: "샘플로 계산해보기" }).click();
    const sample = page.getByRole("region", { name: "샘플 계산 결과" });
    await expect(sample).toBeVisible();
    const before = await sample.innerText();
    await page.getByLabel("이번 추가 투자금", { exact: false }).fill("777777");
    await expect(page.getByLabel("이번 추가 투자금", { exact: false })).toHaveValue("777,777");
    await expect(sample).not.toHaveText(before);
    await expect(sample).toContainText("777,777원");
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBeNull();
    await capture(page, "sample", width);
    await page.getByRole("link", { name: "내 자산으로 계산하기", exact: false }).click();
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("");
    await ownInput(page);
    await expect(page.getByLabel("자산 1 평가금액", { exact: true })).toHaveValue("800,000");
    await page.getByLabel("자산 2 목표 비중", { exact: true }).fill("30");
    await page.getByRole("button", { name: "내 배분 결과 보기" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("100%");
    await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toHaveCount(0);
    await page.getByLabel("자산 2 목표 비중", { exact: true }).fill("40");
    await page.getByLabel("이번 추가 투자금", { exact: false }).fill("-1");
    await page.getByRole("button", { name: "내 배분 결과 보기" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("1원 이상");
    await page.getByLabel("이번 추가 투자금", { exact: false }).fill("100000");
    await calculate(page);
    const result = page.getByRole("region", { name: "내 계산 결과", exact: true });
    await expect(result).toContainText("목표 비중과 차이는 남을 수 있어요");
    await expect(result.getByRole("article").filter({ hasText: "My equity fixture" })).toContainText("+0원");
    await expect(result.getByRole("article").filter({ hasText: "My bond fixture" })).toContainText("+100,000원");
    await capture(page, "personal-result", width);
    await page.reload();
    await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toContainText("My equity fixture");
    await page.goto("/try");
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("샘플 ETF A");
    await page.goto("/try?mode=personal");
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("My equity fixture");
    await page.getByRole("button", { name: "임시 입력 삭제" }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBeNull();
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("");
    await ownInput(page); await calculate(page);
    await page.evaluate(key => { const d = JSON.parse(localStorage.getItem(key)!); d.expiresAt = Date.now() - 1; localStorage.setItem(key, JSON.stringify(d)); }, STORAGE);
    await page.reload();
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("");
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBeNull();
  });

  test(`mocked guest API preserves calculation on cancellation at ${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.route("**/api/investment-plans", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ status: "unauthorized" }) }));
    await ownInput(page); await calculate(page);
    const before = await page.evaluate(key => localStorage.getItem(key), STORAGE);
    await page.getByRole("button", { name: "저장하고 다음 투자 때 이어서 사용하기" }).click();
    await expect(page.getByRole("link", { name: "가입하고 저장 이어가기" })).toHaveAttribute("href", "/auth/sign-up");
    await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toContainText("My equity fixture");
    await capture(page, "mocked-guest-save", width);
    await page.getByRole("link", { name: "가입하지 않고 결과로 돌아가기" }).click();
    await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toContainText("My equity fixture");
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toEqual(before);
    expect((await page.context().cookies()).some(cookie => cookie.name === "varda_plan_return")).toBe(false);
  });

  test(`mocked authenticated API: confirmation, failure, retry, duplicate click, reload and delete at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const plans: Saved[] = [];
    const posts: { id: string; input: Input }[] = [];
    let releaseFailure: (() => void) | undefined;
    const heldFailure = new Promise<void>(resolve => { releaseFailure = resolve; });
    await page.route("**/api/investment-plans", async route => {
      const request = route.request();
      expect(new URL(request.url()).search).toBe("");
      if (request.method() === "GET") return route.fulfill({ status: 200, json: { plans } });
      if (request.method() === "DELETE") { expect(request.postDataJSON()).toEqual({ id: plans[0].id }); plans.splice(0); return route.fulfill({ status: 200, json: { status: "deleted" } }); }
      const input = request.postDataJSON(); posts.push(input);
      if (posts.length === 1) { await heldFailure; return route.fulfill({ status: 500, json: { status: "error" } }); }
      plans.push({ ...input, createdAt: "2026-09-12T00:00:00.000Z" });
      return route.fulfill({ status: 200, json: { id: input.id, status: "saved" } });
    });
    await ownInput(page); await calculate(page);
    const draft: Draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE);
    await page.getByRole("button", { name: "저장하고 다음 투자 때 이어서 사용하기" }).click();
    const save = page.getByRole("button", { name: "확인한 계획 저장", exact: true });
    await expect(save).toBeDisabled();
    await page.getByRole("checkbox", { name: "지금 로그인한 내 계정에" }).check();
    await save.click();
    await expect(page.getByRole("button", { name: "저장 중…", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "저장 중…", exact: true }).dispatchEvent("click");
    await expect.poll(() => posts.length).toBe(1);
    releaseFailure!();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("계획을 저장하지 못했습니다");
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "계획을 저장했습니다" })).toContainText("계획을 저장했습니다");
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({ id: draft.id, input: draft.input });
    expect(posts[1]).toEqual(posts[0]);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toBeNull();
    await capture(page, "mocked-saved-plan", width);
    await page.reload();
    await page.getByRole("button", { name: "계획 보기", exact: true }).click();
    await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toContainText("My bond fixture");
    await page.getByText("삭제", { exact: true }).click();
    await page.getByRole("button", { name: "계획 삭제 확인" }).click();
    await expect(page.getByRole("status").filter({ hasText: "삭제했습니다" })).toContainText("삭제했습니다");
    await expect(page.getByText("아직 저장한 계획이 없습니다.")).toBeVisible();
  });

  test(`mocked initial GET failure and expired POST session recover without losing the draft at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    let gets = 0;
    const posts: { id: string; input: Input }[] = [];
    const plans: Saved[] = [];
    await page.route("**/api/investment-plans", async route => {
      expect(new URL(route.request().url()).search).toBe("");
      if (route.request().method() === "GET") {
        gets += 1;
        return route.fulfill({ status: gets === 1 ? 503 : 200, json: gets === 1 ? { status: "unavailable" } : { plans } });
      }
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) return route.fulfill({ status: 401, json: { status: "unauthorized" } });
      plans.push({ ...posts[1], createdAt: "2026-09-12T00:00:00.000Z" });
      return route.fulfill({ status: 200, json: { status: "saved", id: posts[1].id } });
    });
    await ownInput(page); await calculate(page);
    const before = await page.evaluate(key => localStorage.getItem(key), STORAGE);
    await page.getByRole("button", { name: "저장하고 다음 투자 때 이어서 사용하기" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("불러오지 못했습니다");
    await expect(page.getByRole("heading", { name: "지금은 계정에 저장할 수 없어요." })).toBeInViewport();
    await capture(page, "save-unavailable", width);
    await page.getByRole("button", { name: "다시 확인", exact: true }).click();
    await page.getByRole("checkbox", { name: "지금 로그인한 내 계정에" }).check();
    await page.getByRole("button", { name: "확인한 계획 저장", exact: true }).click();
    await expect(page.getByRole("link", { name: "기존 계정으로 로그인" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("로그인이 만료되었습니다");
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE)).toEqual(before);
    // The next GET simulates an authenticated session; this does not exercise Neon sign-in.
    await page.reload();
    await expect(page.getByRole("button", { name: "확인한 계획 저장", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: "지금 로그인한 내 계정에" }).check();
    await page.getByRole("button", { name: "확인한 계획 저장", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "계획을 저장했습니다" })).toContainText("계획을 저장했습니다");
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });
}

test("formatted money supports editing, grouped paste and deleting beside a separator", async ({ page }) => {
  await page.goto("/try?mode=personal");
  const money = page.getByLabel("이번 추가 투자금", { exact: false });
  await expect(money).toBeEditable();
  await money.fill("1,234,567");
  await expect(money).toHaveValue("1,234,567");
  await money.evaluate((input: HTMLInputElement) => input.setSelectionRange(2, 5));
  await money.press("8");
  await expect(money).toHaveValue("18,567");
  await money.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 3));
  await money.press("Backspace");
  await expect(money).toHaveValue("1,567");
  await money.evaluate((input: HTMLInputElement) => input.setSelectionRange(1, 1));
  await money.press("Delete");
  await expect(money).toHaveValue("167");
  await money.fill("-1");
  await expect(money).toHaveValue("-1");
  await money.fill("");
  await expect(money).toHaveValue("");
});

test("compact desktop input composition at review and laptop sizes", async ({ page }) => {
  for (const [width, height] of [[1298, 698], [1366, 768]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/try");
    await expect(page.getByLabel("자산 1 평가금액", { exact: true })).toHaveValue("3,000,000");
    await capture(page, "sample", width);
    await page.getByRole("link", { name: "내 투자금 계산", exact: true }).click();
    await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("");
    await capture(page, "personal-empty", width);
  }
});
