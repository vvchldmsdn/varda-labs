import { expect as baseExpect, test } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 30000 });
test.setTimeout(120000);
// Run against local VERCEL_ENV=production with EMPTY provider URL/hash/secret.
// Existing auth assessment is misconfigured: the real auth page renders its
// unavailable notice without creating an auth client or sending provider requests.
test.skip(process.env.PLAYWRIGHT_AUTH_NOTICE_UNAVAILABLE !== "1", "Requires isolated misconfigured-auth server, never a production provider");
test.beforeEach(async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route("**/api/portfolio-drafts", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
  await page.route("**/api/investment-plans", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
});
for (const flow of ["quick", "allocation"] as const) test(`real signup page cancellation restores ${flow} input with explicit source`, async ({ page, context }) => {
  await page.goto("/try/analyze");
  await page.getByLabel("자산 1 이름", { exact: true }).fill("내 자산 A");
  await page.getByLabel("자산 1 금액", { exact: true }).fill("600000");
  await page.getByLabel("자산 2 이름", { exact: true }).fill("내 자산 B");
  await page.getByLabel("자산 2 금액", { exact: true }).fill("400000");
  await page.getByRole("button", { name: "내 포트폴리오 구조 보기", exact: true }).click();
  await page.getByRole("link", { name: "이 포트폴리오 저장하고 이어가기", exact: true }).click();
  await page.getByRole("link", { name: "가입하고 포트폴리오 저장", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  await expect(page.getByText("지금은 로그인에 연결할 수 없습니다. 잠시 후 다시 방문해 주세요.", { exact: true })).toBeVisible();
  const cancel = page.getByRole("link", { name: "가입·로그인 취소하고 내 계산으로", exact: true });
  await expect(cancel).toHaveAttribute("href", "/try/analyze");
  if (flow === "allocation") {
    // Deliberately leave old quick draft + source cookie, then start a normal plan.
    await page.goto("/try?mode=personal");
    await page.getByLabel("자산 1 이름", { exact: true }).fill("별도 계획 A");
    await page.getByLabel("자산 1 평가금액", { exact: true }).fill("800000");
    await page.getByLabel("자산 1 목표 비중", { exact: true }).fill("50");
    await page.getByLabel("자산 2 이름", { exact: true }).fill("별도 계획 B");
    await page.getByLabel("자산 2 평가금액", { exact: true }).fill("200000");
    await page.getByLabel("자산 2 목표 비중", { exact: true }).fill("50");
    await page.getByLabel("이번 추가 투자금", { exact: false }).fill("100000");
    await page.getByRole("button", { name: "내 배분 결과 보기" }).click();
    await page.getByRole("button", { name: "저장하고 다음 투자 때 이어서 사용하기", exact: true }).click();
    await page.getByRole("link", { name: "가입하고 저장 이어가기", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
    await expect(cancel).toHaveAttribute("href", "/try?mode=personal");
  }
  await cancel.click();
  await expect(page).toHaveURL(flow === "quick" ? /\/try\/analyze$/ : /\/try\?mode=personal$/);
  await expect(page.getByRole("region", { name: flow === "quick" ? "내 입력 자산 분석" : "내 계산 결과", exact: true })).toBeVisible();
  await expect(page.getByLabel("자산 1 이름", { exact: true })).toHaveValue(flow === "quick" ? "내 자산 A" : "별도 계획 A");
  expect((await context.cookies()).some(cookie => ["varda_plan_return", "varda_plan_source"].includes(cookie.name))).toBe(false);
  expect(await page.evaluate(() => Boolean(localStorage.getItem("varda.quick-portfolio.v1")))).toBe(true);
});
