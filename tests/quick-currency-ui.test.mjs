import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const walk = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
const textOf = node => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node?.props ? [node.props.children].flat(Infinity).map(textOf).join("") : "";
};
const asOf = "2026-09-10T08:00:00.000Z";
const input = { version: 2, source: "manual", currency: "USD", asOf, timeZone: "America/New_York", locale: "en",
  rows: [{ name: "VOO", value: 1234.56, inputCurrency: "USD", instrumentId: "us-voo" }, { name: "KODEX 200", value: 1300000, inputCurrency: "KRW", instrumentId: "kr-069500" }] };
const i18n = { useI18n: () => ({ locale: "en", t: (_ko, en) => en ?? _ko }) };
const ring = () => null;

describe("quick portfolio currency presentation", () => {
  it("keeps mixed original amounts visible and draws no normalized ring without FX", async () => {
    const [module] = await importUiWithPorts(["src/components/first-visit/quick-results.tsx"], {
      react: { useState: value => [value, () => {}] },
      "@/components/i18n/locale-provider": i18n,
      "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: ring },
    });
    const tree = module.QuickResults({ input });
    assert.equal(walk(tree).some(node => node.type === ring), false);
    assert.match(textOf(tree), /1 of 2 assets need exchange-rate evidence/);
    assert.match(textOf(tree), /\$1,234\.56/);
    assert.match(textOf(tree), /1,300,000/);
    assert.doesNotMatch(textOf(tree), /100\.0%/);
  });
  it("renders weights only after supplied rate evidence makes all inputs comparable", async () => {
    const [module] = await importUiWithPorts(["src/components/first-visit/quick-results.tsx"], {
      react: { useState: value => [value, () => {}] },
      "@/components/i18n/locale-provider": i18n,
      "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: ring },
    });
    const tree = module.QuickResults({ input: { ...input, fx: [{ base: "USD", quote: "KRW", rate: "1300", observedAt: asOf, fetchedAt: asOf, source: "manual", kind: "user_input" }] } });
    const visual = walk(tree).find(node => node.type === ring);
    assert.ok(visual);
    assert.equal(visual.props.entries.length, 2);
    assert.ok(Math.abs(visual.props.entries.reduce((sum, row) => sum + row.weightPct, 0) - 100) < 1e-10);
    assert.match(textOf(tree), /\$2,234\.56/);
  });
  it("formats cents without rounding the editable input and advertises a decimal keypad", async () => {
    const [module] = await importUiWithPorts(["src/components/first-visit/money-input.tsx"], {});
    assert.equal(module.formatMoneyInput("1234567.80"), "1,234,567.80");
    assert.equal(module.formatMoneyInput("1234."), "1,234.");
    assert.equal(module.formatMoneyInput("1234.567"), "1,234.567");
    assert.equal(module.MoneyInput({ value: "10.20", allowDecimals: true, onValueChange() {} }).props.inputMode, "decimal");
    assert.equal(module.MoneyInput({ value: "10", onValueChange() {} }).props.inputMode, "numeric");
  });
  it("keeps the selected saved draft in the research URL and renders its original timezone date", async () => {
    const Link = () => null;
    const [module] = await importUiWithPorts(["src/components/first-visit/quick-home.tsx"], {
      "next/link": { default: Link },
      "@/components/i18n/locale-provider": i18n,
      "@/components/secondary-page-header": { SecondaryPageHeader: () => null },
      "./quick-results": { QuickResults: () => null },
    });
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const tree = module.QuickHome({ input: { ...input, asOf: "2026-09-10T01:00:00.000Z" }, createdAt: "2026-09-14T00:00:00Z", id });
    assert.ok(walk(tree).some(node => node.type === Link && node.props.href === "/portfolio/research?draft=" + id));
    assert.match(textOf(tree), /9\/9\/2026/);
  });
  it("hands original USD cents to the holding reference without relabeling them KRW", async () => {
    const originalStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: () => JSON.stringify({ version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: Date.now() + 60000, input: { ...input, rows: [input.rows[0]] } }) };
    try {
      const [module] = await importUiWithPorts(["src/components/first-visit/quick-holding-reference.tsx"], {
        react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
        "next/link": { default: () => null },
        "@/components/i18n/locale-provider": i18n,
      });
      const tree = module.QuickHoldingReference({ disabled: false, onSearch() {} });
      assert.match(textOf(tree), /\$1,234\.56 USD/);
      assert.doesNotMatch(textOf(tree), /KRW/);
    } finally { globalThis.localStorage = originalStorage; }
  });
});
