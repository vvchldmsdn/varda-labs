import assert from "node:assert/strict";
import path from "node:path";
import { expect } from "@playwright/test";

// The actual Next history screens, with owner-bound responses replaced only in this browser.
export async function runPeriodAttributionCases({ page, check, url, output }) {
  const endpoint = "**/beta/api/history/period-attribution?*";
  const binding = "b".repeat(64);
  for (const width of [1440, 390, 360]) {
    await check(`beta-period-attribution-${width}`, async () => {
      const requests = [];
      const intercept = async route => {
        const req = route.request();
        const query = new URL(req.url()).searchParams;
        assert.equal(req.headers()["x-cairn-display-binding"], binding);
        assert.equal(query.get("scope"), "all");
        const start = query.get("start"), end = query.get("end");
        requests.push({ start, end });
        const partial = start === "2025-02-03";
        if (start === "2025-02-08") {
          await route.fulfill({ headers: { "X-Cairn-Display-Binding": binding }, json: {
            range: { start, end }, state: "unavailable", priceKrw: null, fxKrw: null, totalKrw: null,
            holdings: [], days: [
              { date: start, closingValueKrw: 985000, priceKrw: null, fxKrw: null, complete: false },
              { date: "2025-02-09", closingValueKrw: null, priceKrw: null, fxKrw: null, complete: false },
              { date: end, closingValueKrw: 990000, priceKrw: null, fxKrw: null, complete: false },
            ], gaps: [{ start, end, account: "QA", holding: null, reason: "account_history" }],
          } });
          return;
        }
        const days = [];
        let balance = 980000;
        for (let d = new Date(start + "T00:00:00Z"); d.toISOString().slice(0,10) <= end; d.setUTCDate(d.getUTCDate()+1)) {
          const date = d.toISOString().slice(0,10);
          const missing = partial && date === end;
          const priceKrw = partial ? 1000 : [1700, 2600, -2200, 600, -1900, 3200, -400][days.length % 7];
          const fxKrw = partial ? -250 : [-450, 750, 0, -600, 420][days.length % 5];
          balance += priceKrw + fxKrw;
          days.push({ date, closingValueKrw: missing ? null : balance,
            priceKrw: missing ? null : priceKrw, fxKrw: missing ? null : fxKrw, complete: !missing });
        }
        const confirmed = days.filter(day => day.complete);
        const priceKrw = confirmed.reduce((total, day) => total + day.priceKrw, 0);
        const fxKrw = confirmed.reduce((total, day) => total + day.fxKrw, 0);
        const sums = { priceKrw, fxKrw, totalKrw: priceKrw + fxKrw };
        await route.fulfill({ headers: { "X-Cairn-Display-Binding": binding, "Cache-Control": "no-store" },
          json: { range:{start,end}, state:partial?"partial":"complete", ...sums, days,
            holdings:[{ key:"qa-a",account:"QA",name:"매도한 QA 종목",...sums }],
            gaps:partial?[{start:end,end,account:"QA",holding:"QA 외화종목",reason:"fx"}]:[] } });
      };
      await page.route(endpoint, intercept);
      try {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 390 ? 844 : 800 });
        const modal = width === 390;
        await page.goto(url + "/qa-beta-visual?mode=domain&scope=all&currency=USD" + (modal ? "" : "&workspace=history"));
        if (modal) await page.getByRole("button", { name:"히스토리 확대",exact:true }).click();
        const screen = modal ? page.getByRole("dialog") : page.locator("main");
        const studio = screen.locator("[data-history-studio]");
        await studio.getByRole("button", { name:"가격·환율",exact:true }).click();
        const panel = screen.locator("[data-period-attribution]");
        const result = panel.locator("[data-attribution-result]");
        await expect(result).toHaveAttribute("data-state","complete");
        const current = requests.at(-1);
        assert.ok(current.start.endsWith("-01"));
        await studio.getByRole("button",{name:"지난달",exact:true}).click();
        await expect.poll(()=>requests.at(-1).end).toBe(new Date(Date.parse(current.start+"T00:00:00Z")-86400000).toISOString().slice(0,10));
        await expect(result).toHaveAttribute("data-state","complete");
        await result.locator("[data-period-selection]").screenshot({ path: path.join(output, `history-and-impact-${width}.png`) });
        await studio.getByRole("button",{name:"직접 선택",exact:true}).click();
        await studio.getByLabel("시작일",{exact:true}).fill("2025-02-03");
        await studio.getByLabel("종료일",{exact:true}).fill("2025-02-01");
        const beforeInvalid = requests.length;
        await studio.getByRole("button",{name:"적용",exact:true}).click();
        await expect(studio.getByRole("alert")).toBeVisible();
        await expect(studio.getByLabel("시작일",{exact:true})).toHaveValue("2025-02-03");
        assert.equal(requests.length, beforeInvalid);
        await studio.getByLabel("종료일",{exact:true}).fill("2025-02-05");
        await studio.getByRole("button",{name:"적용",exact:true}).click();
        await expect(studio.getByLabel("시작일",{exact:true})).toHaveCount(0);
        await expect(result).toHaveAttribute("data-state","partial");
        await expect(result.locator("[data-factor=price]")).toContainText("2,000");
        await expect(result.locator("[data-factor=fx]")).toContainText("500");
        await expect(result.locator("[data-factor=total]")).toContainText("1,500");
        const chart = result.locator("[data-period-selection]");
        const valuation = chart.locator("[data-period-valuation-plot]");
        const impacts = chart.locator("[data-period-impact-plot]");
        const upper = await valuation.boundingBox(), lower = await impacts.boundingBox();
        assert.ok(upper && lower && upper.y + upper.height <= lower.y);
        assert.ok(Math.abs(upper.x - lower.x) < 1 && Math.abs(upper.width - lower.width) < 1, "common date axis");
        await valuation.click({ position: { x: upper.width / 6, y: upper.height / 2 } });
        await expect(chart).toHaveAttribute("data-selected-date", "2025-02-03");
        const cursor = chart.locator("[data-period-cursor]");
        await cursor.focus();
        await cursor.press("ArrowRight");
        await expect(cursor).toHaveAttribute("aria-valuetext", /981,500원/);
        await impacts.click({ position: { x: lower.width * 5 / 6, y: lower.height / 2 } });
        await expect(chart).toHaveAttribute("data-selected-date", "2025-02-05");
        await expect(cursor).toHaveAttribute("aria-valuetext", /자료 없음/);
        const gaps=panel.locator("details").filter({has:page.locator("summary").filter({hasText:"자료가 빠진 구간"})});
        await gaps.locator("summary").click();
        await expect(gaps).toContainText("QA 외화종목");
        const holdings=panel.locator("details").filter({has:page.locator("summary").filter({hasText:"종목별 영향"})});
        await holdings.locator("summary").click();
        await expect(holdings).toContainText("매도한 QA 종목");
        assert.ok(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),"period panel fits the viewport");
        await panel.screenshot({path:path.join(output,`beta-period-attribution-${width}.png`)});
        await studio.getByRole("button",{name:"직접 선택",exact:true}).click();
        await expect(studio.getByLabel("시작일",{exact:true})).toHaveValue("2025-02-03");
        await expect(studio.getByLabel("종료일",{exact:true})).toHaveValue("2025-02-05");
        await studio.getByLabel("시작일",{exact:true}).fill("2025-02-08");
        await studio.getByLabel("종료일",{exact:true}).fill("2025-02-10");
        await studio.getByRole("button",{name:"적용",exact:true}).click();
        await expect(result).toHaveAttribute("data-state","unavailable");
        await expect(result.locator("[data-factor]")).toHaveCount(0);
        await expect(chart.locator("[data-period-valuation-plot] polyline")).toHaveCount(0);
        await expect(cursor).toHaveAttribute("aria-valuetext", /990,000원/);
        await expect(chart.locator("[data-period-impact-plot] i[data-series]")).toHaveCount(0);
        await studio.getByRole("button",{name:"평가 추이",exact:true}).click();
        await expect(panel).toHaveCount(0);
        await studio.getByRole("button",{name:"직접 선택",exact:true}).click();
        await expect(studio.getByLabel("시작일",{exact:true})).toHaveValue("2025-02-08");
        await expect(studio.getByLabel("종료일",{exact:true})).toHaveValue("2025-02-10");
      } finally {
        await page.unroute(endpoint,intercept);
      }
    });
  }
}
