import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("contribution assumption display", () => {
  it("shows the base, reduction, eligible top-up and final won on each holding", async () => {
    const [{ ContributionRuleReceipt }] = await importUiWithPorts([
      "src/components/cairn-v2/contribution-rule-receipt.tsx",
    ], {});
    const row = {
      accountName: "Account", market: "us", currency: "USD", trimAmountKrw: 0, trimReason: "not_overweight",
      ma120Evidence: {}, maAdjustmentReason: "asset_rule_disabled", maEffectiveMultiplier: 1,
    };
    const result = {
      calculationParameters: { minimumExecutionRatioPct: 80 }, minimumExecutionEvidenceAvailable: true,
      totalAvailableFundsKrw: 1000, totalAllocatedKrw: 800, minimumExecutionSatisfied: true,
      rows: [
        { ...row, allocationKey: "A", name: "Alpha", ticker: "A", strategicAllocationKrw: 600, allocationKrw: 300,
          maEffectiveMultiplier: 0.5, maAdjustmentReason: "below_ma120_full_adjustment",
          ruleSteps: [{ rule: "ma120", deltaKrw: -300 }, { rule: "minimum", deltaKrw: 0 }] },
        { ...row, allocationKey: "B", name: "Beta", ticker: "B", strategicAllocationKrw: 400, allocationKrw: 500,
          ruleSteps: [{ rule: "ma120", deltaKrw: 0 }, { rule: "event", deltaKrw: 0 }, { rule: "minimum", deltaKrw: 100 }],
          modifierBreakdown: { topupEligible: true, topupScore: 40, multipliers: { event: { status: "unavailable" } } } },
      ],
    };
    const html = renderToStaticMarkup(createElement(ContributionRuleReceipt, {
      result, formatWon: value => value + "원", showAccount: false, onEditRatio() {},
    }));
    const summaries = Array.from(html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g), match => match[1]);
    assert.match(summaries.find(text => text.includes("600원")), /600원.*−300원.*300원/);
    assert.match(summaries.find(text => text.includes("400원")), /400원.*\+100원.*500원/);
    for (const label of ["80%", "800원", "1000원", "기본 배분에 ×0.50 적용", "보충 대상", "자료 부족 · 배수 미적용"]) {
      assert.ok(html.includes(label), label);
    }
  });
  it("keeps an allocation visible in the detail bar when its budget cannot buy a whole share", async () => {
    const [{ ContributionFundingBar }] = await importUiWithPorts([
      "src/components/cairn-v2/contribution-funding-bar.tsx",
    ], {});
    const row = { accountName: "Test", name: "Fund", ticker: "FUND", market: "us", allocationKey: "f", allocationKrw: 800 };
    const result = { rows: [row], cashAmountKrw: 1000, totalAvailableFundsKrw: 1000, totalAllocatedKrw: 800, residualCashKrw: 200, totalTrimProceedsKrw: 0 };
    const basis = { budgetKrw: 800, usdKrw: 1000, unavailable: [], rows: [
      { ...row, key: "f", currency: "USD", walletKey: "test:USD", unit: "share", price: 2, quantity: 0, trimKrw: 0, targetKrw: 800, maxBuyKrw: 800 },
    ] };
    const detail = renderToStaticMarkup(createElement(ContributionFundingBar, { result, basis, presentation: "strategy" }));
    const home = renderToStaticMarkup(createElement(ContributionFundingBar, { result, basis }));
    assert.match(detail, /FUND 800원/);
    assert.match(detail, /남는 현금 200원/);
    assert.match(home, /주문 후 잔액 800원/);
    assert.match(home, /전략 유보금 200원/);
  });
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
