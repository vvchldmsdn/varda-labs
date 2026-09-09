import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("contribution assumption display", () => {
  it("joins sorted calculation amounts to the correct holdings in Korean and English", async () => {
    const [{ ContributionAdjustmentPanel }, { LocaleProvider }] = await importUiWithPorts([
      "src/components/additional-contribution/contribution-adjustment-panel.tsx",
      "src/components/i18n/locale-provider.tsx",
    ], {});
    const preview = {
      cashAmountKrw: 400, totalTrimProceedsKrw: 0, totalAllocatedKrw: 400, residualCashKrw: 0,
      ma120Evidence: { mode: "enabled", usableCount: 0 },
      rows: [
        { allocationKey: "z", name: "Zeta holding", accountName: "Z account", allocationKrw: 300, trimAmountKrw: 0, currentValueKrw: 300, currency: "USD" },
        { allocationKey: "a", name: "Alpha holding", accountName: "A account", allocationKrw: 100, trimAmountKrw: 0, currentValueKrw: 100, currency: "KRW" },
      ],
    };
    for (const locale of ["ko", "en"]) {
      const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(ContributionAdjustmentPanel, { preview })));
      const items = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g);
      const alpha = items.find((item) => item.includes("Alpha holding"));
      const zeta = items.find((item) => item.includes("Zeta holding"));
      assert.match(alpha, /A account/);
      assert.match(alpha, /100/);
      assert.doesNotMatch(alpha, /300/);
      assert.match(zeta, /Z account/);
      assert.match(zeta, /300/);
      assert.doesNotMatch(zeta, /100/);
      assert.match(html, /role="switch" aria-checked="false"/);
      assert.match(html, locale === "en" ? /No usable observation/ : /사용 가능한 관측 없음/);
    }
  });
});
