// Playwright CLI: run-code --filename scripts/record-product-demo.js
// Start video recording first, on a local /demo/today page. See docs/product-led-onboarding.md.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- CLI evaluates this function expression.
async page => {
  const origin = page.url().match(/^(http:\/\/(?:127\.0\.0\.1|localhost):\d+)\/demo\//)?.[1];
  if (!origin) throw new Error("Recording is restricted to a local sample demo.");
  const mobile = page.viewportSize().width < 641;
  for (const view of ["today", "structure", "lab", "simulation"]) {
    await page.goto(`${origin}/demo/${view}`);
    await page.locator('[data-demo-ready="true"]').waitFor();
    if (view === "lab") await page.locator('svg[role="img"]').first().waitFor();
    if (view === "simulation") await page.locator("canvas").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (view === "structure") {
      if (mobile) await page.getByRole("heading", { name: "자산 배분", exact: true }).evaluate(element => element.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(1500); // Keep the completed chart, not its entrance animation, as poster.
      await page.screenshot({ path: `public/product-demo/poster-${mobile ? "mobile" : "desktop"}.png` });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // Recorded viewing time, rather than a synchronization delay.
    await page.waitForTimeout(700);
    await page.evaluate(distance => window.scrollTo({ top: distance, behavior: "smooth" }), mobile ? 420 : 260);
    await page.waitForTimeout(3000);
  }
  return { recorded: ["today", "structure", "lab", "simulation"], sampleOnly: true };
}
