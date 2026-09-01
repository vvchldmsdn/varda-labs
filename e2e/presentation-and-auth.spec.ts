import { expect, test } from "@playwright/test";

const previewRoutes = [
  "/?preview=design",
  "/today?preview=design",
  "/portfolio/structure?preview=design",
  "/history?preview=design",
  "/additional-contribution?preview=design&amount=3000000",
  "/investment-lab?preview=design",
  "/simulation?preview=design",
] as const;

for (const route of previewRoutes) {
  test(`${route} renders without page-level horizontal overflow`, async ({
    page,
  }) => {
    const response = await page.goto(route);
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("main.varda-page")).toBeVisible();
    await expect(
      page.getByRole("main", { name: "화면을 불러오는 중" }),
    ).toHaveCount(0);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(
      overflow.viewportWidth + 1,
    );
  });
}

test("security response headers are present", async ({ request }) => {
  const response = await request.get("/?preview=design");
  expect(response.ok()).toBeTruthy();
  const headers = response.headers();
  expect(headers["content-security-policy-report-only"]).toContain(
    "default-src 'self'",
  );
  expect(headers["cross-origin-opener-policy"]).toBe(
    "same-origin-allow-popups",
  );
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("sign-in preview validates the interaction without sending credentials", async ({
  page,
}) => {
  await page.goto("/auth/sign-in?preview=design");
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("preview@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("preview-password");
  await page.getByRole("button", { name: "이메일로 로그인" }).click();
  await expect(page.getByRole("status")).toContainText(
    "입력한 정보는 전송하거나 저장하지 않습니다",
  );
});

test("sign-up preview reports a password confirmation mismatch", async ({
  page,
}) => {
  await page.goto("/auth/sign-up?preview=design");
  await page.getByLabel("이름").fill("Preview User");
  await page
    .getByRole("textbox", { name: "이메일", exact: true })
    .fill("preview@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("preview-password");
  await page
    .getByRole("textbox", { name: "비밀번호 확인", exact: true })
    .fill("different-password");
  await page.getByRole("button", { name: "이메일로 가입하기" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "비밀번호가 서로 다릅니다. 다시 확인해 주세요." }),
  ).toHaveText("비밀번호가 서로 다릅니다. 다시 확인해 주세요.");
});

test("the active mobile navigation item is brought into view", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/simulation?preview=design");
  const rail = page.getByRole("navigation", { name: "주요 메뉴" });
  const active = rail.locator('[aria-current="page"]');
  await expect(active).toBeVisible();
  await expect
    .poll(async () => {
      const [railBox, activeBox] = await Promise.all([
        rail.boundingBox(),
        active.boundingBox(),
      ]);
      if (!railBox || !activeBox) return false;
      return (
        activeBox.x >= railBox.x - 1 &&
        activeBox.x + activeBox.width <= railBox.x + railBox.width + 1
      );
    })
    .toBe(true);
});

test("portfolio history uses one roving chart tab stop", async ({ page }) => {
  await page.goto("/?preview=design");
  const points = page.locator("[data-history-point-index]");
  test.skip((await points.count()) < 2, "preview has fewer than two points");
  const current = page.locator('[data-history-point-index][tabindex="0"]');
  await expect(current).toHaveCount(1);
  const currentIndex = Number(await current.getAttribute("data-history-point-index"));
  await current.focus();
  await page.keyboard.press("ArrowLeft");
  const focusedIndex = await page.evaluate(() =>
    Number(document.activeElement?.getAttribute("data-history-point-index")),
  );
  expect(focusedIndex).toBe(Math.max(0, currentIndex - 1));
  await expect(page.getByText("그래프 데이터 표로 보기")).toBeVisible();
});
