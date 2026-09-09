import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPortfolioTargetNavigation } from "../src/lib/portfolio-target-navigation.ts";
import { currentTargetEditorWeights, parseDisplayedTargetPercent } from "../src/components/portfolio-target-policy-editor.ts";
import { parseTargetWeightPercent } from "../src/lib/portfolio-target-policy.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const scope = "account:11111111-1111-4111-8111-111111111111";
const fixtureRow = (overrides = {}) => ({ accountName: "Test account", assetName: "Example fund", market: "korea", currency: "KRW", ticker: "123456", buyability: "buyable", currentValueKrw: 300, targetWeightBps: 10_000, ...overrides });

describe("target-weight editing and navigation", () => {
  it("preserves account scope, contribution amount, and explicit demo context in both directions", () => {
    const navigation = buildPortfolioTargetNavigation({ scopeKey: scope, from: "contribution", amount: "5000000", isDesignPreview: true });
    const entry = new URL(navigation.settingsHref, "http://local.test");
    const back = new URL(navigation.returnHref, "http://local.test");
    assert.equal(entry.pathname, "/portfolio/targets");
    assert.equal(entry.searchParams.get("scope"), scope);
    assert.equal(entry.searchParams.get("from"), "contribution");
    assert.equal(back.pathname, "/additional-contribution");
    for (const params of [entry.searchParams, back.searchParams]) {
      assert.equal(params.get("amount"), "5000000");
      assert.equal(params.get("preview"), "design");
      assert.equal(params.get("scope"), scope);
      assert.equal(params.has("account"), false);
    }
  });
  it("accepts only named internal return destinations and omits unrelated or invalid amounts", () => {
    for (const from of ["https://outside.test", "//outside.test", "constructor", ["home", "contribution"], undefined]) {
      const navigation = buildPortfolioTargetNavigation({ scopeKey: "all", from, amount: "10" });
      assert.equal(navigation.returnHref, "/portfolio/manage?scope=all");
    }
    for (const amount of ["-1", "0", "Infinity", "1.2", "100000000001", ["10", "20"]]) {
      assert.equal(buildPortfolioTargetNavigation({ scopeKey: "all", from: "contribution", amount }).returnHref, "/additional-contribution?scope=all");
    }
    assert.equal(buildPortfolioTargetNavigation({ scopeKey: scope, from: "home" }).returnHref, `/?scope=${encodeURIComponent(scope)}`);
  });
  it("matches the server's decimal validation, including hundredths and exact basis points", () => {
    for (const value of ["0", "100", "0.01", "33.33", "33.34", " 50.5 ", "100.01", "-1", "1e2", "1.234", "", ".5", "NaN"]) {
      assert.equal(parseDisplayedTargetPercent(value), parseTargetWeightPercent(value), value);
    }
    assert.equal(["33.33", "33.33", "33.34"].reduce((sum, value) => sum + parseDisplayedTargetPercent(value), 0), 10_000);
  });
  it("does not create current weights from missing, invalid, or zero-total valuations", () => {
    for (const value of [null, NaN, -10, Infinity]) assert.deepEqual(currentTargetEditorWeights([fixtureRow(), fixtureRow({ currentValueKrw: value })]), [null, null]);
    assert.deepEqual(currentTargetEditorWeights([fixtureRow({ currentValueKrw: 0 })]), [null]);
    assert.deepEqual(currentTargetEditorWeights([fixtureRow({ currentValueKrw: 200 }), fixtureRow({ currentValueKrw: 800 })]), [20, 80]);
  });
  it("renders editable gold, explicit zero-only rows, and safe demo controls in both languages", async () => {
    const [{ PortfolioTargetPolicyForm }, { LocaleProvider }] = await importUiWithPorts([
      "src/components/portfolio-target-policy-form.tsx", "src/components/i18n/locale-provider.tsx",
    ], {
      "@/app/portfolio/targets/actions": { savePortfolioTargetPolicy: async () => { throw new Error("A render must not write a policy"); } },
      "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
    });
    for (const locale of ["ko", "en"]) {
      const html = renderToStaticMarkup(createElement(LocaleProvider, { initialLocale: locale }, createElement(PortfolioTargetPolicyForm, {
        rows: [fixtureRow({ assetName: "금현물", ticker: "KRX-GOLD" }), fixtureRow({ assetName: "Manual asset", ticker: null, buyability: "tickerless", currentValueKrw: null, targetWeightBps: 0 })],
        scopeKey: scope, universeHash: "fixture-only", isDesignPreview: true,
      })));
      assert.match(html, /금현물/);
      const goldInput = html.match(/<input[^>]+id="target-weight-0"[^>]*>/)?.[0];
      assert.ok(goldInput);
      assert.doesNotMatch(goldInput, /disabled/);
      const hiddenZero = (html.match(/<input[^>]*>/g) ?? []).find(input => input.includes('name="targetWeight:1"') && input.includes('type="hidden"'));
      assert.ok(hiddenZero);
      assert.match(hiddenZero, /value="0"/);
      assert.match(html, /<button[^>]+disabled=""[^>]+type="submit"/);
      assert.doesNotMatch(html, /<form[^>]+action=/);
      assert.match(html, locale === "en" ? /Current weights are unavailable/ : /현재 비중은 표시하지 않습니다/);
      assert.match(html, locale === "en" ? /changes cannot be saved/ : /저장하지 않습니다/);
    }
  });
  it("keeps the production read boundary closed even when the URL requests a design preview", async () => {
    let sessionChecks = 0;
    const [{ default: TargetsPage }] = await importUiWithPorts(["src/app/portfolio/targets/page.tsx"], {
      "@/lib/i18n/server": { localizedMetadata: async () => ({}) },
      "@/components/portfolio-target-policy-view": { PortfolioTargetPolicyView: () => { throw new Error("Unauthorized policy view"); } },
      "@/components/portfolio-read-access-boundary": { PortfolioReadAccessBoundary: () => createElement("p", null, "Access required") },
      "@/components/portfolio-analysis-scope-boundary": { PortfolioAnalysisScopeBoundary: () => { throw new Error("Must authenticate first"); } },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => { sessionChecks += 1; return { ok: false }; } },
      "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => { throw new Error("Unauthorized scope read"); } },
      "@/db/queries/portfolio-target-policy": { getReadOnlyTenantPortfolioTargetPolicyModel: async () => { throw new Error("Unauthorized target read"); } },
    });
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const result = await TargetsPage({ searchParams: Promise.resolve({ preview: "design", scope: "all" }) });
      assert.equal(renderToStaticMarkup(result), "<p>Access required</p>");
      assert.equal(sessionChecks, 1);
    } finally {
      if (before === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = before;
    }
  });
});
