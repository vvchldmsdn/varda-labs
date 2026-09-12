import { expect, test, type Page } from "@playwright/test";
const key = "varda.quick-portfolio.v1";
test.beforeEach(async ({ baseURL, page }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
async function input(page: Page) {
  await page.goto("/try/analyze");
  await page.getByLabel("자산 1 이름", { exact: true }).fill("VOO");
  await page.getByRole("button", { name: "VOO · VOO", exact: true }).click();
  await page.getByLabel("자산 1 금액", { exact: true }).fill("600000");
  await page.getByLabel("자산 2 이름", { exact: true }).fill("나만의 자산");
  await page.getByLabel("자산 2 금액", { exact: true }).fill("400000");
  await page.getByRole("button", { name: "내 포트폴리오 구조 보기", exact: true }).click();
  await expect(page.getByRole("region", { name: "내 입력 자산 분석", exact: true })).toBeVisible();
}
for (const width of [1440, 390, 320]) test(`anonymous amount composition, restoration and catalogue at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await input(page);
  await expect(page.getByLabel("자산 1 금액", { exact: true })).toHaveValue("600,000");
  await expect(page.getByText("VOO · 60.0%", { exact: true })).toBeVisible();
  await expect(page.getByText("미확인", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: `output/quick-result-${width}.png`, fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const raw = await page.evaluate(storage => localStorage.getItem(storage), key);
  expect(raw).toBeTruthy(); expect(JSON.parse(raw!).input.rows[1].instrumentId).toBeNull();
  expect(page.url()).not.toContain("600000");
  await page.reload(); await expect(page.getByRole("region", { name: "내 입력 자산 분석", exact: true })).toBeVisible();
  await page.getByLabel("자산 2 금액", { exact: true }).fill("-1");
  await page.getByRole("button", { name: "내 포트폴리오 구조 보기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "금액은" })).toBeVisible();
  await page.getByRole("button", { name: "입력 지우기", exact: true }).click();
  expect(await page.evaluate(storage => localStorage.getItem(storage), key)).toBeNull();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
test("quick saved portfolio confirmation, retry, reuse and removal with isolated API doubles", async ({ page }) => {
  // Real public calculation, mocked session/private persistence only. Not a provider integration test.
  type Saved = { id: string; input: unknown; createdAt: string };
  let saved: Saved[] = []; let failOnce = true; let postCount = 0;
  await page.route("**/api/investment-plans", route => route.fulfill({ json: { plans: [] } }));
  await page.route("**/api/portfolio-drafts", async route => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { drafts: saved } });
    if (req.method() === "DELETE") { saved = []; return route.fulfill({ json: { deleted: true } }); }
    postCount++; if (failOnce) { failOnce = false; return route.fulfill({ status: 503, json: { error: "service_unavailable" } }); }
    const value = req.postDataJSON(); saved = [{ ...value, createdAt: new Date().toISOString() }];
    return route.fulfill({ status: 201, json: { id: value.id, created: true } });
  });
  await input(page); await page.getByRole("link", { name: "이 포트폴리오 저장하고 이어가기", exact: true }).click();
  const region = page.getByRole("region", { name: "간편 포트폴리오 저장", exact: true });
  const save = region.getByRole("button", { name: "확인한 포트폴리오 저장", exact: true });
  await expect(save).toBeDisabled(); await region.getByRole("checkbox").check(); await save.click();
  await expect(region.getByRole("alert")).toContainText("저장하지 못했습니다");
  expect(await page.evaluate(storage => localStorage.getItem(storage), key)).not.toBeNull();
  await save.click(); await expect(region.getByRole("status")).toContainText("간편 포트폴리오를 저장했습니다"); expect(postCount).toBe(2);
  expect(await page.evaluate(storage => localStorage.getItem(storage), key)).toBeNull();
  await region.getByRole("button", { name: "금액을 바꿔 다시 확인", exact: true }).click();
  await expect(page.getByLabel("자산 1 금액", { exact: true })).toHaveValue("600,000");
  await page.goto("/plans"); await region.getByText("삭제", { exact: true }).click();
  await region.getByRole("button", { name: "간편 포트폴리오 삭제 확인", exact: true }).click();
  await expect(region.getByRole("status")).toContainText("삭제했습니다"); expect(saved).toHaveLength(0);
});
test("guest signup intent and cancellation preserve the quick result without exposing inputs", async ({ page }) => {
  await page.route("**/api/investment-plans", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
  await page.route("**/api/portfolio-drafts", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
  await input(page); await page.getByRole("link", { name: "이 포트폴리오 저장하고 이어가기", exact: true }).click();
  const region = page.getByRole("region", { name: "간편 포트폴리오 저장", exact: true });
  const signup = region.getByRole("link", { name: "가입하고 포트폴리오 저장", exact: true });
  await expect(signup).toHaveAttribute("href", "/auth/sign-up");
  await expect(region.getByRole("link", { name: "로그인하고 이어가기", exact: true })).toHaveAttribute("href", "/auth/sign-in");
  await region.getByRole("link", { name: "가입하지 않고 입력·결과로 돌아가기", exact: true }).click();
  await expect(page.getByRole("region", { name: "내 입력 자산 분석", exact: true })).toBeVisible();
  expect(page.url()).not.toContain("VOO");
});
test("save service outage remains recoverable and duplicate submission is locked", async ({ page }) => {
  let unavailable = true; let posts = 0; let release: (() => void) | undefined;
  await page.route("**/api/investment-plans", route => route.fulfill({ json: { plans: [] } }));
  await page.route("**/api/portfolio-drafts", async route => {
    if (route.request().method() === "GET") return route.fulfill(unavailable ? { status: 503, json: { error: "service_unavailable" } } : { json: { drafts: [] } });
    posts++; await new Promise<void>(resolve => { release = resolve; });
    return route.fulfill({ status: 201, json: { id: route.request().postDataJSON().id, created: true } });
  });
  await input(page); await page.getByRole("link", { name: "이 포트폴리오 저장하고 이어가기", exact: true }).click();
  const region = page.getByRole("region", { name: "간편 포트폴리오 저장", exact: true });
  await expect(region.getByText("지금은 저장 연결을 확인할 수 없어요.", { exact: true })).toBeVisible();
  unavailable = false; await region.getByRole("button", { name: "다시 확인", exact: true }).click();
  await region.getByRole("checkbox").check(); const save = region.getByRole("button", { name: "확인한 포트폴리오 저장", exact: true });
  await save.click(); await expect(region.getByRole("button", { name: "저장 중…", exact: true })).toBeDisabled();
  expect(posts).toBe(1); release!(); await expect(region.getByRole("status")).toContainText("간편 포트폴리오를 저장했습니다");
});
test("quick assets continue to allocation with no invented targets or topup and restore after calculation", async ({ page }) => {
  await input(page);
  await page.getByRole("link", { name: "다음 투자금 배분 계산", exact: true }).click();
  await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue("VOO");
  await expect(page.getByLabel("자산 1 평가금액", { exact: true })).toHaveValue("600,000");
  await expect(page.getByLabel("자산 1 목표 비중", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("이번 추가 투자금", { exact: false })).toHaveValue("");
  await page.getByLabel("자산 1 목표 비중", { exact: true }).fill("50");
  await page.getByLabel("자산 2 목표 비중", { exact: true }).fill("50");
  await page.getByLabel("이번 추가 투자금", { exact: false }).fill("200000");
  await page.getByRole("button", { name: "내 배분 결과 보기" }).click();
  await expect(page).toHaveURL(/\/try\?mode=personal$/);
  await page.reload(); await expect(page.getByRole("region", { name: "내 계산 결과", exact: true })).toBeVisible();
  await expect(page.getByLabel("자산 1 목표 비중", { exact: true })).toHaveValue("50");
});
