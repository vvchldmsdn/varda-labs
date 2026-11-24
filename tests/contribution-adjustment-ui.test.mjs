import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

describe("contribution assumption display", () => {
  it("shows reconciled rule amounts and a paused minimum when FX and regime inputs are missing", async () => {
    const [{ContributionBudgetSteps, ContributionRuleReceipt}] = await importUiWithPorts([
      "src/components/cairn-v2/contribution-rule-receipt.tsx",
    ], {});
    const result = {
      calculationParameters:{minimumExecutionRatioPct:80}, effectiveMinimumRatioPct:null,
      totalAvailableFundsKrw:1000, totalBuyCapacityKrw:600, totalAllocatedKrw:600,
      modifierEvidence:{fundingBasis:"KRW", fx:{status:"unavailable",reason:"portfolio_fx_exposure_unclassified"},regime:{status:"unavailable",reason:"regime_missing"}},
      rows:[{allocationKey:"A",ticker:"A",market:"us",currentValueKrw:200,
        allocationKrw:600, strategicAllocationKrw:1000, trimAmountKrw:0, trimReason:"not_overweight",
        postTopupWeightPct:15, targetWeightPct:20, effectiveTargetWeightPct:15, maEffectiveMultiplier:.75,
        maAdjustmentReason:"below_ma120_buffer", ma120Evidence:{distanceFromMaPct:-2},
        ruleSteps:[{rule:"ma120",beforeKrw:1000,afterKrw:600,deltaKrw:-400},{rule:"minimum",beforeKrw:600,afterKrw:600,deltaKrw:0}],
      }],
    };
    const props = {result, formatWon:value => value + "원"};
    const bridge = renderToStaticMarkup(createElement(ContributionBudgetSteps,props));
    assert.match(bridge,/1000원.*120일선 반영 후 재배분.*−400원.*600원/);
    const receipt = renderToStaticMarkup(createElement(ContributionRuleReceipt,{...props,showAccount:false,onEditRatio(){}}));
    for (const label of ["80%", "자동 보충 보류", "환노출 분류 미확인", "시장 국면 자료 부족", "전체 600원", "−400원", "3% 이내"]) assert.ok(receipt.includes(label),label);
    assert.doesNotMatch(receipt,/3영업일/);
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
