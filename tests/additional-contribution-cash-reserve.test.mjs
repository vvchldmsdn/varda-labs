import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareAdditionalContributionCashReserve as compare } from "../src/lib/additional-contribution-cash-reserve.ts";
import { calculateExplainableAdditionalContribution } from "../src/lib/additional-contribution-policy-engine.ts";

describe("explicit new-cash reserve comparison", () => {
  it("keeps the baseline and targets immutable when off regardless of the slider", () => {
    const baseline = fixture();
    const before = structuredClone(baseline);
    const result = compare({ baseline, mode: "off", reserveRatioPct: 80 });
    assert.equal(result.status, "ready");
    assert.equal(result.baseline, baseline);
    assert.deepEqual(baseline, before);
    assert.equal(result.totalAdditionalReserveKrw, 0);
    assert.equal(result.scenarioAllocatedKrw, baseline.totalAllocatedKrw);
    assert.equal(result.scenarioResidualCashKrw, baseline.residualCashKrw);
    assert.equal(result.reserveRatioPct, 0);
  });

  it("reserves new cash proportionally while retaining every trim-funded KRW", () => {
    const result = compare({ baseline: fixture(), mode: "enabled", reserveRatioPct: 50 });
    assert.equal(result.status, "ready");
    assert.equal(result.requestedNewCashReserveKrw, 50);
    assert.equal(result.baselineNewCashResidualKrw, 20);
    assert.equal(result.totalAdditionalReserveKrw, 30);
    assert.equal(result.scenarioAllocatedKrw, 90);
    assert.equal(result.scenarioResidualCashKrw, 60);
    assert.deepEqual(result.rows.map(row => [row.allocationKey, row.newCashFundedBuyKrw, row.trimFundedBuyKrw, row.reserveKrw, row.scenarioAllocationKrw]), [
      ["a", 60, 30, 23, 67], ["b", 20, 10, 7, 23], ["trim", 0, 0, 0, 0],
    ]);
    conserve(result);
  });

  it("counts already unspent new cash toward the selected minimum", () => {
    const result = compare({ baseline: fixture(), mode: "enabled", reserveRatioPct: 10 });
    assert.equal(result.status, "ready");
    assert.equal(result.requestedNewCashReserveKrw, 10);
    assert.equal(result.scenarioNewCashResidualKrw, 20);
    assert.equal(result.totalAdditionalReserveKrw, 0);
    assert.equal(result.scenarioAllocatedKrw, 120);
  });

  it("100% keeps all new cash while leaving the original sale and sale-funded purchases intact", () => {
    const result = compare({ baseline: fixture(), mode: "enabled", reserveRatioPct: 100 });
    assert.equal(result.status, "ready");
    assert.equal(result.scenarioNewCashResidualKrw, 100);
    assert.equal(result.scenarioAllocatedKrw, 40);
    assert.equal(result.scenarioTrimCashResidualKrw, 10);
    assert.deepEqual(result.rows.map(row => row.trimAmountKrw), [0, 0, 50]);
    assert.ok(result.rows.every(row => row.scenarioAllocationKrw === row.trimFundedBuyKrw));
    conserve(result);
  });

  it("resolves one-won ties by stable allocation identity and ignores source order", () => {
    const baseline = { cashAmountKrw: 3, totalTrimProceedsKrw: 0, totalAllocatedKrw: 3, residualCashKrw: 0,
      rows: ["c", "a", "b"].map(allocationKey => ({ allocationKey, allocationKrw: 1, trimAmountKrw: 0 })) };
    const result = compare({ baseline, mode: "enabled", reserveRatioPct: 50 });
    const reordered = compare({ baseline: { ...baseline, rows: [...baseline.rows].reverse() }, mode: "enabled", reserveRatioPct: 50 });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.rows, reordered.rows);
    assert.deepEqual(result.rows.map(row => row.reserveKrw), [1, 0, 0]);
    conserve(result);
  });

  it("uses exact integer ratios near the maximum supported money amount", () => {
    const cashAmountKrw = Number.MAX_SAFE_INTEGER - 9;
    const baseline = { cashAmountKrw, totalTrimProceedsKrw: 0, totalAllocatedKrw: cashAmountKrw, residualCashKrw: 0,
      rows: [{ allocationKey: "a", allocationKrw: cashAmountKrw - 1, trimAmountKrw: 0 }, { allocationKey: "b", allocationKrw: 1, trimAmountKrw: 0 }] };
    const result = compare({ baseline, mode: "enabled", reserveRatioPct: 33 });
    assert.equal(result.status, "ready");
    assert.equal(result.totalAdditionalReserveKrw, Number(BigInt(cashAmountKrw) * 33n / 100n));
    conserve(result);
  });

  it("reuses the real trim policy and cannot create or change a sell proposal", () => {
    const baseline = calculateExplainableAdditionalContribution({ cashAmountKrw: 200000, minimumExecutionRatioPct: 85, trimDriftThresholdPct: 12,
      rows: [row("a", 700000, 500000), row("b", 300000, null)] });
    assert.equal(baseline.status, "ready");
    assert.equal(baseline.totalTrimProceedsKrw, 70000);
    const result = compare({ baseline, mode: "enabled", reserveRatioPct: 100 });
    assert.equal(result.status, "ready");
    assert.equal(result.scenarioAllocatedKrw, 70000);
    assert.equal(result.scenarioResidualCashKrw, 200000);
    assert.equal(result.baseline, baseline);
    assert.equal(result.rows.find(row => row.allocationKey === "a").trimAmountKrw, 70000);
    assert.equal(baseline.rows.find(row => row.allocationKey === "b").costBasisKrw, null);
    conserve(result);
  });

  it("never reallocates a reduction and conserves both sources for varied small budgets", () => {
    for (let cash = 0; cash <= 25; cash += 1) for (const ratio of [0, 1, 25, 50, 99, 100]) {
      const total = cash + 7;
      const a = Math.floor(total / 3);
      const b = Math.floor(total / 2);
      const baseline = { cashAmountKrw: cash, totalTrimProceedsKrw: 7, totalAllocatedKrw: a + b, residualCashKrw: total - a - b,
        rows: [{ allocationKey: "a", allocationKrw: a, trimAmountKrw: 0 }, { allocationKey: "b", allocationKrw: b, trimAmountKrw: 0 }, { allocationKey: "trim", allocationKrw: 0, trimAmountKrw: 7 }] };
      const result = compare({ baseline, mode: "enabled", reserveRatioPct: ratio });
      assert.equal(result.status, "ready");
      assert.ok(result.rows.every(row => row.scenarioAllocationKrw <= row.baselineAllocationKrw));
      conserve(result);
    }
  });

  for (const [label, mutate] of [
    ["fractional ratio", input => input.reserveRatioPct = 12.5],
    ["invalid mode", input => input.mode = "automatic"],
    ["too high ratio", input => input.reserveRatioPct = 101],
    ["inconsistent total", input => input.baseline.totalAllocatedKrw += 1],
    ["duplicate identity", input => input.baseline.rows[1].allocationKey = "a"],
    ["negative allocation", input => input.baseline.rows[0].allocationKrw = -1],
    ["unsafe money", input => input.baseline.cashAmountKrw = Number.MAX_SAFE_INTEGER + 1],
  ]) it(`rejects ${label}`, () => {
    const input = { baseline: structuredClone(fixture()), mode: "enabled", reserveRatioPct: 50 };
    mutate(input);
    assert.equal(compare(input).status, "blocked");
  });
});

function fixture() {
  return Object.freeze({ cashAmountKrw: 100, totalTrimProceedsKrw: 50, totalAllocatedKrw: 120, residualCashKrw: 30,
    rows: Object.freeze([{ allocationKey: "a", allocationKrw: 90, trimAmountKrw: 0 }, { allocationKey: "b", allocationKrw: 30, trimAmountKrw: 0 }, { allocationKey: "trim", allocationKrw: 0, trimAmountKrw: 50 }].map(Object.freeze)) });
}
function conserve(result) {
  assert.equal(result.scenarioAllocatedKrw + result.scenarioResidualCashKrw, result.baseline.cashAmountKrw + result.baseline.totalTrimProceedsKrw);
  assert.equal(result.rows.reduce((sum, row) => sum + row.scenarioNewCashFundedBuyKrw, 0) + result.scenarioNewCashResidualKrw, result.baseline.cashAmountKrw);
  assert.equal(result.rows.reduce((sum, row) => sum + row.trimFundedBuyKrw, 0) + result.scenarioTrimCashResidualKrw, result.baseline.totalTrimProceedsKrw);
}
function row(allocationKey, currentValueKrw, costBasisKrw) {
  return { allocationKey, currentValueKrw, costBasisKrw, buyable: true, targetWeightBps: 5000, maAssetClass: "other", assetType: "etf",
    maRuleEnabled: false, ma120Evidence: { status: "unavailable", distanceFromMaPct: null }, metadata: {} };
}
