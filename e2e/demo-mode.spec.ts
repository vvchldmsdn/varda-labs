import { test, expect as baseExpect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const expect = baseExpect.configure({ timeout: 45_000 });
const directory = "output/playwright/demo-mode";
test.beforeEach(async ({ page, baseURL }) => {
  expect(new URL(baseURL!).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  await mkdir(directory, { recursive: true });
  await page.route("**/*", route => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

for (const width of [1440, 390, 320]) {
  test(`anonymous actual product exploration at ${width}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height: width > 640 ? 960 : 844 });
    const privateRequests: string[] = [];
    page.on("request", request => {
      const url = new URL(request.url());
      if ((url.pathname.startsWith("/api/") && url.pathname !== "/api/public-demo") || /^\/(auth|portfolio|holdings|etfs|admin|settings)(\/|$)/.test(url.pathname)) privateRequests.push(url.pathname);
    });
    const checkOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    const navigate = async (name: string) => { await page.getByRole("navigation", { name: "체험 화면", exact: true }).getByRole("link", { name, exact: true }).click(); };

    await page.goto("/demo/home");
    await expect(page.getByRole("heading", { name: "자산의 흐름", exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "샘플 계좌 선택" }).getByRole("link", { name: "ISA", exact: true }).click();
    await expect(page).toHaveURL(/account=isa/);
    await expect(page.getByText("2개 종목 · 1개 계좌", { exact: true })).toBeVisible();
    await page.getByRole("navigation", { name: "샘플 계좌 선택" }).getByRole("link", { name: "전체", exact: true }).click();
    await page.getByRole("button", { name: "구성", exact: true }).click();
    await expect(page.getByRole("link", { name: "전체 자산 구성 보기 →" })).toHaveAttribute("href", /\/demo\/structure/);
    await page.getByRole("button", { name: "연결", exact: true }).click();
    await expect(page.getByRole("link", { name: "상관·위험 상세", exact: true })).toHaveAttribute("href", /\/demo\/structure/);
    await expect(page.locator('a[href="/etfs"]')).toHaveCount(0);
    await page.getByRole("button", { name: "일별 변동", exact: true }).click();
    if (width <= 640) {
      await page.getByRole("button", { name: /조회 날짜 선택:/ }).click();
      const dates = page.getByRole("dialog", { name: "조회 날짜", exact: true });
      await expect(dates).toBeVisible();
      await dates.getByRole("button", { name: /^2026/ }).nth(1).click();
      await expect(dates).not.toBeVisible();
    }
    await checkOverflow();
    await page.screenshot({ path: `${directory}/home-${width}.png`, fullPage: true });

    await navigate("오늘 변동");
    await expect(page.getByRole("heading", { name: "오늘, 무엇이 움직였을까?", exact: true })).toBeVisible();
    if (width <= 640) {
      const row = page.locator("button[data-today-select-holding]").nth(1);
      const key = await row.getAttribute("data-today-select-holding");
      await row.click();
      await expect(row).toHaveAttribute("aria-pressed", "true");
      await expect(page).not.toHaveURL(/holding=/);
      const summary = page.locator('[data-holding-detail-trigger="summary"]:visible');
      await expect(summary).toHaveAttribute("href", new RegExp(`holding=${encodeURIComponent(key!)}`));
      await summary.click();
    } else await page.locator('[data-holding-detail-trigger="row"]:visible').nth(1).click();
    await expect(page.locator("[data-holding-dialog]")).toBeVisible();
    await expect(page.locator("[data-holding-dialog-body] svg")).toBeVisible();
    await page.getByRole("button", { name: "종목 상세 닫기", exact: true }).click();
    await expect(page.locator("[data-holding-dialog]")).toHaveCount(0);
    await checkOverflow();

    await navigate("포트 구조");
    const holdingSelect = page.getByRole("combobox", { name: "비중 종목 선택", exact: true });
    await expect(holdingSelect).toBeVisible();
    const choices = await holdingSelect.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
    await holdingSelect.selectOption(choices[1]);
    await expect(holdingSelect).toHaveValue(choices[1]);
    await page.getByRole("button", { name: "비중 지도", exact: true }).click();
    await expect(page.getByRole("button", { name: "비중 지도", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByText("위험 분석도 살펴보기", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "포트폴리오 위험 요약", exact: true })).toBeVisible();
    await checkOverflow();
    await page.screenshot({ path: `${directory}/structure-${width}.png`, fullPage: true });

    await navigate("추가투입");
    const allocation = page.getByRole("list", { name: "종목별 배분 결과", exact: true });
    const before = await allocation.innerText();
    await page.getByRole("textbox", { name: "추가 투자금 · 원", exact: true }).fill("2000000");
    await expect(allocation).not.toHaveText(before);
    const current = await allocation.innerText();
    await page.getByRole("combobox", { name: "샘플 목표 비중", exact: true }).selectOption("equal");
    await expect(allocation).not.toHaveText(current);
    await page.getByRole("textbox", { name: "추가 투자금 · 원", exact: true }).fill("-1");
    await expect(page.locator("#demo-amount-error")).toContainText("정수 금액");
    await page.getByRole("textbox", { name: "추가 투자금 · 원", exact: true }).fill("0");
    await expect(page.getByText("추가 투자금이 0원이라 나눌 금액이 없어요. 금액을 늘려 다시 계산해보세요.")).toBeVisible();
    await page.getByRole("textbox", { name: "추가 투자금 · 원", exact: true }).fill("1000000");
    await checkOverflow();

    await navigate("투자 랩");
    await expect(page.locator("[data-lab-chart] svg")).toBeVisible();
    await page.getByRole("combobox", { name: "비교할 예시 전략", exact: true }).selectOption("voo");
    await page.getByRole("combobox", { name: "표시 구간", exact: true }).selectOption("30");
    await expect(page.getByRole("combobox", { name: "비교할 예시 전략", exact: true })).toHaveValue("voo");
    const date = page.getByLabel("비교 그래프 날짜 탐색", { exact: true });
    await expect(date).toHaveAttribute("max", "29");
    await date.focus(); await date.press("ArrowLeft");
    await expect(page.locator("[data-lab-tooltip]")).toBeVisible();
    await checkOverflow();

    await navigate("시뮬레이션");
    await expect(page.locator("[data-public-simulation] canvas")).toBeVisible();
    await page.getByRole("combobox", { name: "계산 기간", exact: true }).selectOption("126");
    await expect(page.getByLabel("샘플 포트폴리오 경로 시점", { exact: true })).toHaveAttribute("max", "126");
    await page.getByLabel("경로 번호", { exact: true }).fill("42");
    await expect(page.getByLabel("경로 번호", { exact: true })).toHaveValue("42");
    await page.getByRole("button", { name: "분포 구간", exact: true }).click();
    await expect(page.getByRole("button", { name: "분포 구간", exact: true })).toHaveAttribute("aria-pressed", "true");
    await checkOverflow();
    await page.screenshot({ path: `${directory}/simulation-${width}.png`, fullPage: true });

    await page.getByRole("link", { name: "내 포트폴리오로 계속하기 ↗", exact: true }).click();
    await expect(page).toHaveURL(/\/try\/analyze$/);
    expect(privateRequests).toEqual([]);
  });
}
