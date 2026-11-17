import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";

// Resolve composited CSS colors in the browser, including translucent panel layers.
function luminancePair(element) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  const paint = color => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); };
  const luminance = () => {
    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
      const c = channel / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const chain = [];
  for (let node = element; node; node = node.parentElement) chain.push(node);
  paint("white");
  for (const node of chain.reverse()) paint(getComputedStyle(node).backgroundColor);
  const background = luminance();
  paint(getComputedStyle(element).color);
  const ink = luminance();
  return { background, contrast: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05) };
}

export async function runHistoryInteractionCases({ page, check, url, output }) {
  const selectFixtureDates = async card => {
    const studio = card.locator('[data-history-studio]');
    await studio.getByRole('button', { name: '평가 추이', exact: true }).click();
    await studio.getByRole('button', { name: '직접 선택', exact: true }).click();
    await studio.getByLabel('시작일', { exact: true }).fill('2026-07-03');
    await studio.getByLabel('종료일', { exact: true }).fill('2026-10-03');
    await studio.getByRole('button', { name: '적용', exact: true }).click();
  };
  for (const [width, height] of [[1440, 900], [390, 844], [360, 800]]) {
    await check(`beta-history-interaction-${width}`, async () => {
      await page.setViewportSize({ width, height });
      await page.goto(url + "/qa-beta-visual?mode=domain&scope=all&currency=KRW");
      await expect(page.locator("[data-beta-root]")).toHaveAttribute("data-beta-ready", "true");
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const history = page.locator("[data-beta-card=history]");
      await selectFixtureDates(history);
      const structure = page.locator("[data-beta-card=structure]");
      const plot = history.locator("[data-history-plot] svg");
      const tip = history.getByRole("tooltip");
      // Measure layout without the card group's entrance transform or viewport scrolling.
      const docY = () => structure.evaluate(el => {
        let top = 0;
        for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
        return top;
      });
      // Price and FX now have a dedicated shared-period view (covered by
      // runPeriodAttributionCases). The valuation tooltip must still overlay
      // the chart without moving the following cards as the selected day changes.
      await expect(history.locator('button[data-impact]')).toHaveCount(0);
      const before = await docY();
      await plot.scrollIntoViewIfNeeded();
      const box = await plot.boundingBox();
      let lastDate;
      for (const fraction of [.04, .55, .94]) {
        await plot.hover({ position: { x: box.width * fraction, y: box.height / 2 } });
        const date = tip.locator("time");
        await expect(date).toBeVisible();
        if (lastDate) await expect(date).not.toHaveAttribute("datetime", lastDate);
        lastDate = await date.getAttribute("datetime");
        await expect(plot).toHaveAttribute("aria-label", new RegExp(lastDate));
        await expect(tip.locator("[data-tooltip-series] dd")).toHaveCount(3);
        assert.equal(await docY(), before, `${width}px: inspecting ${lastDate} keeps the next card in place`);
      }
      await expect(tip.locator("[data-tooltip-series=price] dd")).toContainText("원");
      await expect(tip.locator("[data-tooltip-series=fx] dd")).toContainText("원");
      const withinPlot = () => tip.evaluate(el => {
        const a = el.getBoundingClientRect();
        const b = el.closest("[data-history-plot]").getBoundingClientRect();
        return a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
      });
      await expect.poll(withinPlot).toBe(true);
      await history.screenshot({ path: path.join(output, `history-tooltip-${width}.png`) });
      await plot.focus();
      await plot.press("Home");
      await expect(tip.locator("[data-tooltip-series=price] dd")).toHaveText("—");
      await plot.press("Escape");
      await expect(tip).toHaveCount(0);
      const dashboard = page.locator("[data-home-dashboard]");
      const darkButton = page.getByRole("button", { name: "다크 모드로 전환" });
      if (await darkButton.count()) await darkButton.click();
      await expect(dashboard).toHaveAttribute("data-home-theme", "dark");
      if (width === 1440) {
        const allocation = page.locator("[data-beta-card=contribution]").locator("..");
        const heatmap = page.locator("[data-beta-card=heatmap]");
        for (const panel of [structure, allocation, heatmap]) {
          await page.mouse.move(0, 0);
          const normal = (await panel.evaluate(luminancePair)).background;
          await panel.hover({ position: { x: 12, y: 14 } });
          await expect.poll(async () => (await panel.evaluate(luminancePair)).background).toBeLessThan(normal);
        }
      }
      await structure.locator("[data-expand]").click();
      const facts = page.getByRole("dialog").locator("aside dl dt");
      await expect(facts.first()).toBeVisible();
      for (const label of await facts.all()) {
        const { contrast } = await label.evaluate(luminancePair);
        assert.ok(contrast >= 4.5, `${await label.textContent()} contrast ${contrast.toFixed(2)}`);
      }
      if (width === 1440) {
        const picker = page.getByRole("dialog").locator("aside [aria-haspopup=listbox]");
        assert.ok((await picker.evaluate(luminancePair)).contrast >= 4.5);
        await picker.click();
        const choice = page.getByRole("option").first();
        await expect(choice).toBeVisible();
        assert.ok((await choice.evaluate(luminancePair)).contrast >= 4.5);
        await choice.click();
      }
      await page.keyboard.press("Escape");
      if (width === 1440) {
        await page.locator("[data-beta-card=today] [data-expand]").click();
        const loss = page.getByRole("dialog").locator("[data-tone=negative]").first();
        assert.ok((await loss.evaluate(luminancePair)).contrast >= 4.5);
        await page.keyboard.press("Escape");
        await page.locator("[data-beta-card=contribution] [data-expand]").click();
        const submit = page.getByRole("dialog").locator("button[type=submit]").first();
        assert.ok((await submit.evaluate(luminancePair)).contrast >= 4.5);
        await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "라이트 모드로 전환" }).click();
    });
  }
  await check("beta-history-touch-360", async () => {
    const phone = await page.context().browser().newPage({
      viewport: { width: 360, height: 800 }, hasTouch: true, isMobile: true, reducedMotion: "reduce", locale: "ko-KR",
    });
    try {
      await phone.route("**/*", route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
      await phone.goto(url + "/qa-beta-visual?mode=domain&scope=all&currency=KRW");
      const card = phone.locator("[data-beta-card=history]");
      await selectFixtureDates(card);
      const svg = card.locator("[data-history-plot] svg");
      const tip = card.getByRole("tooltip");
      const date = tip.locator("time");
      await svg.scrollIntoViewIfNeeded();
      const box = await svg.boundingBox();
      await svg.tap({ position: { x: box.width * .25, y: box.height / 2 } });
      const first = await date.getAttribute("datetime");
      await svg.tap({ position: { x: box.width * .75, y: box.height / 2 } });
      await expect(date).not.toHaveAttribute("datetime", first);
      const nav = phone.getByRole("navigation", { name: "주요 메뉴" });
      await expect.poll(async () => {
        const [popup, bottomMenu] = await Promise.all([tip.boundingBox(), nav.boundingBox()]);
        return popup && bottomMenu && popup.y + popup.height <= bottomMenu.y;
      }).toBe(true);
      await phone.screenshot({ path: path.join(output, "history-touch-360.png") });
    } finally {
      await phone.close();
    }
  });
  await check("beta-workspace-display-settings", async () => {
    const tablet = await page.context().browser().newPage({ viewport: { width: 768, height: 800 } });
    try {
      await tablet.goto(url + "/qa-beta-visual?mode=domain&scope=all&currency=KRW&workspace=history");
      const root = tablet.locator("[data-beta-root]");
      await expect(root).toHaveAttribute("data-beta-ready", "true");
      const accountButton = tablet.locator("main > header > button[aria-haspopup=dialog]");
      const fits = () => accountButton.evaluate(el => el.clientHeight >= el.scrollHeight && el.offsetWidth >= 110);
      await expect.poll(fits).toBe(true);
      await tablet.getByRole("button", { name: "다크 모드로 전환" }).click();
      await tablet.getByRole("button", { name: "화면 설정" }).click();
      const reduced = tablet.getByRole("checkbox", { name: /모션·투명 효과 줄이기/ });
      await reduced.check();
      await tablet.reload();
      await expect(root).toHaveAttribute("data-home-theme", "dark");
      await tablet.setViewportSize({ width: 360, height: 800 });
      await tablet.getByRole("button", { name: "화면 설정" }).click();
      await expect(reduced).toBeChecked();
      await tablet.getByRole("checkbox", { name: "다크 모드" }).uncheck();
      await expect(root).toHaveAttribute("data-home-theme", "light");
    } finally {
      await tablet.close();
    }
  });
}
