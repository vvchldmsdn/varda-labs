import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { trackedCurrencyFixture } from "../src/lib/currency-tracked-fixture.ts";

const walk = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
const textOf = node => typeof node === "string" || typeof node === "number" ? String(node) : node?.props ? [node.props.children].flat(Infinity).map(textOf).join("") : "";
const ring = () => null;
const i18n = { useI18n: () => ({ locale: "en", t: (_ko, en) => en ?? _ko }) };
const basePorts = {
  react: { useState: value => [value, () => {}], useMemo: fn => fn() },
  "@/components/i18n/locale-provider": i18n,
  "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: ring },
  "@/components/native-contribution-planner": { NativeContributionPlanner: () => null },
};
const importView = async (ports = {}) => (await importUiWithPorts(["src/components/currency-tracked-view.tsx"], { ...basePorts, ...ports }))[0].CurrencyTrackedView;
const contributionPolicy = { trimDriftThresholdPct: 12, minimumExecutionRatioPct: 85 };

describe("owned portfolio currency view", () => {
  it("shows complete USD valuation and separates dates from performance claims", async () => {
    const View = await importView();
    const tree = View({ evidence: trackedCurrencyFixture(), timeZone: "America/New_York", contributionPolicy });
    assert.match(textOf(tree), /\$1,100\.00/);
    assert.match(textOf(tree), /2026-09-01 20:00/);
    assert.match(textOf(tree), /does not adjust for portfolio-wide/);
    assert.ok(walk(tree).some(node => node.type === ring));
  });
  it("recalculates native USD values in KRW and renders a loss although USD rose", async () => {
    const View = await importView();
    const tree = View({ evidence: { ...trackedCurrencyFixture(), reporting: "KRW" } });
    assert.match(textOf(tree), /1,386,000/);
    assert.match(textOf(tree), /-₩14,000/);
    assert.match(textOf(tree), /Example US asset/);
  });
  it("draws no normalized ring and permits no allocation form when scope or FX is incomplete", async () => {
    const View = await importView();
    for (const evidence of [
      { ...trackedCurrencyFixture(), reporting: "KRW", fx: [] },
      { ...trackedCurrencyFixture(), current: { ...trackedCurrencyFixture().current, scopeComplete: false } },
    ]) {
      const tree = View({ evidence, contributionPolicy });
      assert.equal(walk(tree).some(node => node.type === ring || node.type === "form"), false);
      assert.match(textOf(tree), /Subtotal with evidence/);
      assert.match(textOf(tree), /full total and weights are unavailable/);
      assert.doesNotMatch(textOf(tree), /100\.00%/);
    }
  });
  it("does not render mixed-owner names even if upstream evidence is incorrect", async () => {
    const View = await importView();
    const evidence = trackedCurrencyFixture();
    evidence.current.positions[0].ownerId = "other";
    evidence.current.positions[0].name = "Must never appear";
    const tree = View({ evidence, contributionPolicy });
    assert.match(textOf(tree), /unavailable/);
    assert.doesNotMatch(textOf(tree), /Must never appear/);
  });
  it("does not turn zero verified holdings into a zero-value claim", async () => {
    const View = await importView();
    const evidence = { ...trackedCurrencyFixture(), reporting: "KRW", fx: [] };
    const tree = View({ evidence, contributionPolicy });
    assert.match(textOf(tree), /0 of 1 holdings/);
    assert.doesNotMatch(textOf(tree), /₩0/);
  });
  it("passes exact native valuation and original dated cost to the shared contribution engine", async () => {
    const evidence = trackedCurrencyFixture();
    const row = evidence.current.positions[0];
    row.observation.quantity = "0.1";
    row.observation.price = "0.2";
    row.cost.amount = "0.020000000000000001";
    let stateIndex = 0, captured;
    const states = ["USD", "Asia/Seoul", "", "10.25", "USD", { example: "100" }, null, ""];
    const View = await importView({
      react: { useMemo: fn => fn(), useState: () => [states[stateIndex++], () => {}] },
      "@/lib/currency-contribution": { calculateCurrencyContribution: input => { captured = input; return { status: "blocked", reason: "test_capture" }; } },
    });
    const tree = View({ evidence, contributionPolicy });
    walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(captured.rows[0].value.amount, "0.02");
    assert.equal(captured.rows[0].value.currency, "USD");
    assert.deepEqual(captured.rows[0].cost, row.cost);
    assert.equal(captured.rows[0].ma120Evidence.status, "unavailable");
    assert.equal(captured.funds[0].amount, "10.25");
  });
  it("does not display an older calculation after the valuation evidence is replaced", async () => {
    let stateIndex = 0;
    const evidence = trackedCurrencyFixture();
    const states = ["USD", "Asia/Seoul", "", "10.25", "USD", { example: "100" }, { evidence: trackedCurrencyFixture(), result: { status: "ready", context: { reportingCurrency: "USD" } } }, ""];
    const View = await importView({ react: { useMemo: fn => fn(), useState: () => [states[stateIndex++], () => {}] } });
    const tree = View({ evidence, contributionPolicy });
    assert.doesNotMatch(textOf(tree), /Calculated allocation/);
  });
});
