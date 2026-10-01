import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [demo, contribution] = await importWithPorts(["src/lib/demo-portfolio.ts", "src/lib/demo-contribution.ts"], {});
describe("public demo is an isolated deterministic product projection", () => {
  it("allows only fixed views and account scopes", () => {
    for (const view of ["home", "today", "structure", "contribution", "lab", "simulation", "history"]) assert.equal(demo.isDemoView(view), true);
    for (const value of ["../auth", "owner", "account:private", ["brokerage"], null, undefined]) {
      assert.equal(demo.demoAccount(value), "all");
    }
    assert.equal(demo.isDemoView("auth"), false);
  });
  it("keeps account totals, structure and movement consistent across views", () => {
    const all = demo.buildDemoPortfolio();
    const accounts = ["brokerage", "isa", "irp"].map(demo.buildDemoPortfolio);
    assert.equal(accounts.reduce((sum, model) => sum + model.dashboard.totalValueKrw, 0), all.dashboard.totalValueKrw);
    for (const model of [all, ...accounts]) {
      assert.equal(model.holdingRows.reduce((sum, row) => sum + row.currentValueKrw, 0), model.dashboard.totalValueKrw);
      assert.ok(Math.abs(model.holdingRows.reduce((sum, row) => sum + row.currentWeightPct, 0) - 100) < 1e-10);
      assert.equal(model.dashboard.todayMovement.contributionRows.reduce((sum, row) => sum + row.changeKrw, 0), model.dashboard.todayChangeKrw);
      assert.deepEqual(model, demo.buildDemoPortfolio(model.account));
    }
  });
  it("recalculates contributions with conservation, amount and target changes", () => {
    const { holdingRows } = demo.buildDemoPortfolio();
    const first = contribution.buildDemoContribution(holdingRows, 1_000_000);
    const second = contribution.buildDemoContribution(holdingRows, 2_000_000);
    const equal = contribution.buildDemoContribution(holdingRows, 1_000_000, true);
    for (const plan of [first, second, equal]) {
      assert.ok(plan);
      assert.equal(plan.totalAllocatedKrw + plan.residualCashKrw, plan.cashAmountKrw);
      assert.equal(plan.totalTrimProceedsKrw, 0);
      assert.equal(plan.ma120Evidence.usableCount, 0);
      assert.ok(plan.rows.every(row => row.trimAmountKrw === 0 && row.maEffectiveMultiplier === 1));
      assert.ok(Math.abs(plan.rows.reduce((sum, row) => sum + row.targetWeightPct, 0) - 100) < 1e-8);
    }
    assert.notDeepEqual(first.rows.map(row => row.allocationKrw), second.rows.map(row => row.allocationKrw));
    assert.notDeepEqual(first.rows.map(row => row.allocationKrw), equal.rows.map(row => row.allocationKrw));
  });
  it("rejects invalid cash and keeps zero-cash honest", () => {
    const { holdingRows } = demo.buildDemoPortfolio();
    for (const amount of [-1, 0.1, NaN, Infinity, 1_000_000_001]) assert.equal(contribution.buildDemoContribution(holdingRows, amount), null);
    assert.equal(contribution.buildDemoContribution([], 100), null);
    const zero = contribution.buildDemoContribution(holdingRows, 0);
    // Zero new money is valid, but unknown demo costs cannot justify profitable
    // sales. With no sale proceeds the preview must leave every holding alone.
    assert.ok(zero);
    assert.equal(zero.status, "ready");
    assert.equal(zero.cashAmountKrw, 0);
    assert.equal(zero.totalAllocatedKrw, 0);
    assert.equal(zero.totalTrimProceedsKrw, 0);
    assert.equal(zero.totalAvailableFundsKrw, 0);
    assert.equal(zero.residualCashKrw, 0);
    assert.equal(zero.postTopupTotalKrw, holdingRows.reduce((sum, row) => sum + row.currentValueKrw, 0));
    for (const row of zero.rows) {
      assert.equal(row.action, "hold");
      assert.equal(row.allocationKrw, 0);
      assert.equal(row.trimAmountKrw, 0);
      assert.equal(row.postTopupValueKrw, row.currentValueKrw);
    }
  });
  it("does not import protected readers or route mutations in the public surface", async () => {
    for (const path of ["src/app/demo/[view]/page.tsx", "src/components/demo/demo-shell.tsx", "src/components/demo/demo-contribution.tsx", "src/components/demo/demo-research.tsx", "src/lib/demo-portfolio.ts", "src/lib/demo-contribution.ts"]) {
      const source = await readFile(path, "utf8");
      assert.doesNotMatch(source, /from ["'].*(?:\/db\/|\/auth\/)|fetch\(["']\/api\/(?:holdings|portfolio|market)|use server|localStorage|sessionStorage|window\.location/);
    }
  });
});
