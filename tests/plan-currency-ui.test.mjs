import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as money from "../src/lib/money.ts";
import * as plans from "../src/lib/investment-plan.ts";
import { analyzeQuickPortfolio } from "../src/lib/quick-portfolio.ts";
import { intlLocale } from "../src/lib/i18n/locale.ts";

const source = readFileSync(new URL("../src/components/first-visit/plan-experience.tsx", import.meta.url), "utf8");
const helperSource = source.slice(source.indexOf("export function quickInputForPlan"), source.indexOf("export function PlanExperience"));
const compiledHelper = ts.transpileModule(helperSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const quickInputForPlan = new Function("exports", "analyzeQuickPortfolio", "Decimal", "moneyFromMinor", compiledHelper + ";return exports.quickInputForPlan;")({}, analyzeQuickPortfolio, money.Decimal, money.moneyFromMinor);
const require = createRequire(import.meta.url);
const resultsSource = readFileSync(new URL("../src/components/first-visit/plan-results.tsx", import.meta.url), "utf8");
function resultComponent(locale) {
  const code = ts.transpileModule(resultsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const ports = {
    "@/lib/investment-plan": plans, "@/lib/money": money,
    "@/components/i18n/locale-provider": { useI18n: () => ({ locale, t: (ko, en) => locale === "en" ? en ?? ko : ko }) },
    "@/lib/i18n/locale": { intlLocale }, "./first-visit.module.css": { default: {} },
  };
  return new Function("require", "exports", code + ";return exports;")((key) => ports[key] ?? require(key), {});
}

const asOf = "2020-09-14T00:00:00Z";
const usdPlan = { version: 2, asOf, currency: "USD", amount: 500.05, rows: [{ name: "A", value: 1000.25, targetBps: 5000 }, { name: "B", value: 1000.25, targetBps: 5000 }] };
const mixedInput = { version: 2, source: "manual", asOf, currency: "USD", locale: "en", timeZone: "America/New_York",
  rows: [{ name: "A", value: 1400, inputCurrency: "KRW", instrumentId: null }, { name: "B", value: 10.01, inputCurrency: "USD", instrumentId: null }],
  fx: [{ base: "USD", quote: "KRW", rate: "1400", observedAt: asOf, fetchedAt: asOf, kind: "user_input", source: "manual" }] };

describe("Plan currency UI: no network, no DB", () => {
  it("bridges only converted complete reporting values and preserves original quick inputs", () => {
    const before = JSON.stringify(mixedInput);
    const bridged = quickInputForPlan(mixedInput);
    assert.equal(bridged.ok, true);
    assert.equal(bridged.currency, "USD");
    assert.equal(bridged.asOf, asOf);
    assert.deepEqual(bridged.rows.map(row => row.value), ["1", "10.01"]);
    assert.ok(bridged.rows.every(row => row.target === ""));
    assert.equal(JSON.stringify(mixedInput), before);
  });

  it("blocks missing FX instead of relabeling KRW as USD or dropping assets", () => {
    assert.deepEqual(quickInputForPlan({ ...mixedInput, fx: [] }), { ok: false });
    assert.match(source, /href="\/try\/analyze"/);
    assert.doesNotMatch(source, /localStorage\.setItem\(QUICK_STORAGE_KEY/);
  });

  it("rounds the new plan at the target minor unit while keeping original high precision FX", () => {
    const input = { ...mixedInput, rows: [{ name: "A", value: 1414, inputCurrency: "KRW", instrumentId: null }], fx: [{ ...mixedInput.fx[0], rate: "1400.125" }] };
    assert.equal(quickInputForPlan(input).rows[0].value, "1.01");
    assert.equal(input.fx[0].rate, "1400.125");
    assert.equal(input.rows[0].value, 1414);
  });

  it("retains legacy KRW bridge values and leaves target weights for the user", () => {
    const input = { currency: "KRW", rows: [{ name: "A", value: 3000000, instrumentId: null }] };
    assert.deepEqual(quickInputForPlan(input).rows, [{ name: "A", value: "3000000", target: "" }]);
  });

  it("renders dollars rather than internal minor units and keeps public totals consistent", () => {
    const result = plans.calculatePlan(usdPlan);
    assert.equal(result.ok, true);
    const html = renderToStaticMarkup(createElement(resultComponent("en").PlanResults, { input: usdPlan }));
    assert.match(html, /\$500\.05/);
    assert.match(html, new RegExp(money.formatMoney(result.totalAllocated, "USD", "en-US").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(html, /\$50,005|원|KRW/);
    assert.match(html, /Cash left/);
    assert.equal(money.moneyMinor(result.totalAllocated, "USD") + money.moneyMinor(result.residualCash, "USD"), 50005);
  });

  it("changes language without changing currency, values, or the saved plan", () => {
    const before = JSON.stringify(usdPlan);
    const ko = renderToStaticMarkup(createElement(resultComponent("ko").PlanResults, { input: usdPlan }));
    const en = renderToStaticMarkup(createElement(resultComponent("en").PlanResults, { input: usdPlan }));
    assert.match(ko, /USD/); assert.match(en, /USD/);
    assert.match(ko, /500\.05/); assert.match(en, /500\.05/);
    assert.equal(JSON.stringify(usdPlan), before);
    const sample = plans.calculatePlan(plans.SAMPLE_PLAN);
    assert.deepEqual(sample.rows.map(row => row.allocation), [0, 433333, 66667]);
  });

  it("shows localized validation without won-specific instructions for USD", () => {
    const component = resultComponent("en");
    const html = renderToStaticMarkup(createElement(component.PlanResults, { input: { ...usdPlan, amount: 0.001 } }));
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /원|정수/);
    assert.match(html, /USD|inputs/);
    assert.match(component.planErrorCopy("입력한 자산의 목표 비중 합계가 100%여야 합니다.", "USD", "en"), /100%/);
  });
});
