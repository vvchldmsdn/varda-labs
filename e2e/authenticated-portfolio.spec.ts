import { expect, test } from "@playwright/test";

test("an authenticated session can open the live portfolio journey", async ({
  browser,
  baseURL,
}) => {
  const storageState = process.env.E2E_AUTH_STORAGE_STATE;
  test.skip(
    !storageState,
    "Set E2E_AUTH_STORAGE_STATE to a local Playwright storage-state file.",
  );
  if (!storageState || !baseURL) return;

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  try {
    await page.goto(new URL("/", baseURL).toString());
    await expect(page).not.toHaveURL(/\/auth\/sign-in/);
    await expect(
      page.getByRole("navigation", { name: "주요 메뉴" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "오늘 변동" }).click();
    await expect(page).toHaveURL(/\/today/);
    await expect(page.locator("main")).toBeVisible();
  } finally {
    await context.close();
  }
});
