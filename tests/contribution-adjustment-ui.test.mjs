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
  it("shows sized shares, unit quotes and zero grams in collapsed holding rows", async () => {
    const [{ ContributionRuleReceipt }, { ContributionOrderPreview }] = await importUiWithPorts([
      "src/components/cairn-v2/contribution-rule-receipt.tsx", "src/components/cairn-v2/contribution-order-preview.tsx",
    ], {});
    const row = { accountName: "Account", market: "korea", currency: "KRW", trimAmountKrw: 0, trimReason: "not_overweight", ruleSteps: [] };
    const targets = [
      { ...row, allocationKey: "fund", name: "Fund", ticker: "FUND", allocationKrw: 80 },
      { ...row, allocationKey: "gold", name: "금현물", ticker: null, allocationKrw: 15 },
      { ...row, allocationKey: "missing", name: "Pending", ticker: "PND", allocationKrw: 5 },
    ].map(row => ({ ...row, strategicAllocationKrw: row.allocationKrw }));
    const basis = { budgetKrw: 100, usdKrw: null, unavailable: ["Pending"], rows: targets.slice(0,2).map((row, i) => ({
      ...row, key: row.allocationKey, walletKey: "account:KRW", unit: i === 0 ? "share" : "gram",
      price: i === 0 ? 30 : 60, targetKrw: row.allocationKrw, maxBuyKrw: i === 0 ? 100 : 15, trimKrw: 0,
    })) };
    const result = { rows: targets, totalAllocatedKrw: 100, calculationParameters: { minimumExecutionRatioPct: 80 } };
    function summaries(basis) {
      const html = renderToStaticMarkup(createElement(ContributionRuleReceipt, { result, basis, formatWon: value => value + "원", onEditRatio() {} }));
      return Array.from(html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g), match => match[1].replace(/<[^>]*>/g, " "));
    }
    const [fund, gold, pending] = summaries(basis);
    assert.match(fund, /목표 배분\s*80원.*예상 매수 원금\s*90원.*예상 매수\s+3주.*1주당 30원/);
    assert.match(gold, /예상 매수\s+0g.*1g당 60원/);
    assert.match(pending, /단가·환율·단위 확인 필요/);
    assert.doesNotMatch(pending, /0주/);
    assert.match(summaries(undefined)[0], /주문 기준 미확인/);
    assert.match(summaries({ ...basis, budgetKrw: -1 })[0], /주문 조건 확인 필요/);
    const missing = { ...basis, rows: [], unavailable: targets.map(row => row.name) };
    const feesAndOrders = renderToStaticMarkup(createElement(ContributionOrderPreview, {
      preview: result, basis: missing, formatWon: value => value + "원", onIncludeCash() {},
    }));
    assert.match(feesAndOrders, /예상 주문 수량을 확인할 수 없어요/);
    assert.doesNotMatch(feesAndOrders, /예상 매수 원금<\/dt><dd>0원/);
  });
  it("preserves share increments and estimates amount orders using their native principal at the quote", async () => {
    const [{ formatBuyQuantity, formatOrderUnitPrice }] = await importUiWithPorts(["src/components/cairn-v2/contribution-order-display.ts"], {});
    const ko = (ko) => ko, en = (_ko, en) => en;
    const quote = { unit: "share", price: 80.125, currency: "USD" };
    const amount = { principalMinor: 1000, principalKrw: 13500, currency: "USD", quantity: null };
    assert.equal(formatBuyQuantity(amount, quote, ko), "금액 주문 · 약 0.12480499주");
    assert.equal(formatBuyQuantity({ ...amount, principalMinor: 0 }, quote, en), "0 shares");
    assert.equal(formatBuyQuantity({ ...amount, quantity: "0.124804" }, quote, ko), "0.124804주");
    assert.equal(formatOrderUnitPrice(quote, en), "$80.125/share");
  });
  it("shows identical executable funding on the home and detail bars when a whole share exceeds the budget", async () => {
    const [{ ContributionFundingBar }] = await importUiWithPorts([
      "src/components/cairn-v2/contribution-funding-bar.tsx",
    ], {});
    const row = { accountName: "Test", name: "Fund", ticker: "FUND", market: "us", allocationKey: "f", allocationKrw: 800 };
    const result = { rows: [row], cashAmountKrw: 1000, totalAvailableFundsKrw: 1000, totalAllocatedKrw: 800, residualCashKrw: 200, totalTrimProceedsKrw: 0 };
    const basis = { budgetKrw: 800, usdKrw: 1000, unavailable: [], rows: [
      { ...row, key: "f", currency: "USD", walletKey: "test:USD", unit: "share", price: 2, quantity: 0, trimKrw: 0, targetKrw: 800, maxBuyKrw: 800 },
    ] };
    const detail = renderToStaticMarkup(createElement(ContributionFundingBar, { result, basis }));
    const home = renderToStaticMarkup(createElement(ContributionFundingBar, { result, basis, showLeadingBuys: true }));
    for (const html of [home, detail]) {
      assert.match(html, /예상 매수 원금<\/dt><dd>0원/);
      assert.match(html, /주문 후 잔액 800원/);
      assert.match(html, /전략 유보금 200원/);
      assert.doesNotMatch(html, /FUND 800원/);
    }
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
