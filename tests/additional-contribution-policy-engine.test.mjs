import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateExplainableAdditionalContribution } from "../src/lib/additional-contribution-policy-engine.ts";

describe("explainable additional contribution policy", () => {
  it("trims a profitable overweight holding and reuses the proceeds", () => {
    const result = calculateExplainableAdditionalContribution({
      cashAmountKrw: 200_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 12,
      rows: [row("a", 700_000, 500_000, 5_000), row("b", 300_000, 300_000, 5_000)],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.totalTrimProceedsKrw, 70_000);
    assert.equal(result.totalAvailableFundsKrw, 270_000);
    assert.deepEqual(result.rows.map((item) => [item.allocationKey, item.action, item.trimAmountKrw, item.allocationKrw]), [
      ["a", "trim", 70_000, 0],
      ["b", "buy", 0, 270_000],
    ]);
  });

  it("does not trim a loss position or a holding without cost basis", () => {
    const loss = calculateExplainableAdditionalContribution({
      cashAmountKrw: 200_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 12,
      rows: [row("a", 700_000, 800_000, 5_000), row("b", 300_000, 300_000, 5_000)],
    });
    const unknown = calculateExplainableAdditionalContribution({
      cashAmountKrw: 200_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 12,
      rows: [row("a", 700_000, null, 5_000), row("b", 300_000, 300_000, 5_000)],
    });

    assert.equal(loss.status, "ready");
    assert.equal(unknown.status, "ready");
    assert.equal(loss.rows[0].trimReason, "loss_position");
    assert.equal(unknown.rows[0].trimReason, "cost_basis_unavailable");
    assert.equal(loss.totalTrimProceedsKrw, 0);
    assert.equal(unknown.totalTrimProceedsKrw, 0);
  });

  it("keeps gold eligible while exempting it from the MA120 reduction", () => {
    const result = calculateExplainableAdditionalContribution({
      cashAmountKrw: 400_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 100,
      rows: [
        row("broad", 250_000, 250_000, 2_500, { maAssetClass: "broad_index", ma120Evidence: { status: "below_ma", distanceFromMaPct: -4 } }),
        row("gold", 250_000, 250_000, 2_500, { assetType: "commodity", maAssetClass: "defensive_gold", ma120Evidence: { status: "below_ma", distanceFromMaPct: -8 } }),
        row("thematic", 250_000, 250_000, 2_500, { maAssetClass: "thematic", ma120Evidence: { status: "below_ma", distanceFromMaPct: -5 } }),
        row("other", 250_000, 250_000, 2_500),
      ],
    });

    assert.equal(result.status, "ready");
    const byKey = new Map(result.rows.map((item) => [item.allocationKey, item]));
    assert.equal(byKey.get("broad").maEffectiveMultiplier, 0.8);
    assert.equal(byKey.get("thematic").maEffectiveMultiplier, 0.5);
    assert.equal(byKey.get("gold").maEffectiveMultiplier, 1);
    assert.equal(byKey.get("gold").maAdjustmentReason, "asset_class_exempt");
    assert.ok(byKey.get("gold").allocationKrw > 0);
  });

  it("keeps strategic and MA-adjusted allocations separately explainable", () => {
    const result = calculateExplainableAdditionalContribution({
      cashAmountKrw: 200_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 100,
      rows: [
        row("a", 400_000, 400_000, 5_000, { maAssetClass: "thematic", ma120Evidence: { status: "below_ma", distanceFromMaPct: -5 } }),
        row("b", 600_000, 600_000, 5_000),
      ],
    });

    assert.equal(result.status, "ready");
    const adjusted = result.rows.find((item) => item.allocationKey === "a");
    assert.ok(adjusted.strategicAllocationKrw > adjusted.allocationKrw);
    assert.equal(result.totalAllocatedKrw + result.residualCashKrw, result.totalAvailableFundsKrw);
  });

  it("allocates integer KRW deterministically", () => {
    const result = calculateExplainableAdditionalContribution({
      cashAmountKrw: 1_001,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 100,
      rows: [row("b", 0, 0, 4_000), row("a", 0, 0, 4_000), row("c", 1_000, null, 2_000)],
    });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.rows.map((item) => [item.allocationKey, item.allocationKrw]), [["a", 501], ["b", 500], ["c", 0]]);
  });

  it("blocks an incomplete target vector", () => {
    const result = calculateExplainableAdditionalContribution({
      cashAmountKrw: 100_000,
      minimumExecutionRatioPct: 85,
      trimDriftThresholdPct: 12,
      rows: [row("a", 1_000_000, 1_000_000, 9_999)],
    });
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.includes("target_policy_incomplete"));
  });

  it("uses the exact deficits for largest-remainder priority and preserves input order independence", () => {
    const rows = [row("a", 48.9, null, 2_500), row("b", 48.8, null, 2_500), row("c", 101.3, null, 5_000)];
    const forward = calculate(rows, { cashAmountKrw: 1 });
    const reverse = calculate([...rows].reverse(), { cashAmountKrw: 1 });
    assert.equal(forward.status, "ready");
    assert.equal(reverse.status, "ready");
    const allocations = (result) => result.rows.map((item) => [item.allocationKey, item.allocationKrw, item.strategicAllocationKrw]);
    assert.deepEqual(allocations(forward), [["a", 0, 0], ["b", 1, 1], ["c", 0, 0]]);
    assert.deepEqual(allocations(reverse), allocations(forward));
    assertConservation(forward);
  });

  it("retains cash when an extra won would exceed an effective target deficit", () => {
    const result = calculate([
      row("a", 50.2, null, 5_000),
      row("b", 25.9, null, 2_500),
      row("c", 23.9, null, 2_500),
    ], { cashAmountKrw: 5 });
    assert.equal(result.status, "ready");
    assert.equal(result.totalAllocatedKrw, 4);
    assert.equal(result.residualCashKrw, 1);
    assertConservation(result);
  });

  it("floors zero-target exits without selling more than the holding", () => {
    for (const currentValueKrw of [100, 100.4, 100.6, 0.4, 0.6]) {
      const result = calculate([
        row("exit", currentValueKrw, currentValueKrw / 2, 0),
        row("keep", 100, 100, 10_000),
      ], { cashAmountKrw: 1 });
      assert.equal(result.status, "ready");
      const exit = result.rows.find((item) => item.allocationKey === "exit");
      assert.equal(exit.trimAmountKrw, Math.floor(currentValueKrw));
      assert.equal(exit.trimReason, "eligible_zero_target_exit");
      assert.ok(exit.postTradeValueKrw >= 0 && exit.postTradeValueKrw < 1);
      assert.equal(exit.allocationKrw, 0);
      assertConservation(result);
    }
  });

  it("keeps zero-target loss and unknown-cost positions", () => {
    for (const [cost, reason] of [[200, "target_zero_but_loss"], [null, "target_zero_cost_basis_unavailable"], [0, "target_zero_cost_basis_unavailable"]]) {
      const result = calculate([row("exit", 100, cost, 0), row("keep", 100, 100, 10_000)]);
      assert.equal(result.status, "ready");
      const exit = result.rows.find((item) => item.allocationKey === "exit");
      assert.equal(exit.trimAmountKrw, 0);
      assert.equal(exit.trimReason, reason);
      assertConservation(result);
    }
  });

  it("treats zero cost as unavailable and allows a genuine break-even trim", () => {
    for (const [cost, expectedReason, expectedTrim] of [[0, "cost_basis_unavailable", 0], [null, "cost_basis_unavailable", 0], [700_000, "eligible_overweight", 70_000]]) {
      const result = calculate([row("a", 700_000, cost, 5_000), row("b", 300_000, 300_000, 5_000)]);
      assert.equal(result.status, "ready");
      assert.equal(result.rows[0].trimReason, expectedReason);
      assert.equal(result.rows[0].trimAmountKrw, expectedTrim);
    }
  });

  it("lands within one won above 105 percent without rounding a sale upward", () => {
    const result = calculate([row("a", 700_000.75, 500_000, 5_000), row("b", 300_000.25, 300_000, 5_000)]);
    assert.equal(result.status, "ready");
    const trimmed = result.rows[0];
    const landing = result.postContributionTotalKrw * 0.5 * 1.05;
    assert.equal(trimmed.trimAmountKrw, 70_000);
    assert.ok(trimmed.postTrimValueKrw >= landing);
    assert.ok(trimmed.postTrimValueKrw - landing < 1);
    assertConservation(result);
  });

  it("includes the 12 percent relative drift boundary despite floating-point representation", () => {
    const boundary = calculate([row("a", 22.4, 20, 2_000), row("b", 77.6, 77.6, 8_000)], { cashAmountKrw: 1 });
    const below = calculate([row("a", 22.399999, 20, 2_000), row("b", 77.600001, 77, 8_000)], { cashAmountKrw: 1 });
    assert.equal(boundary.status, "ready");
    assert.equal(below.status, "ready");
    assert.equal(boundary.rows[0].trimAmountKrw, 1);
    assert.equal(below.rows[0].trimAmountKrw, 0);
    assert.equal(below.rows[0].trimReason, "not_overweight");
    assertConservation(boundary);
  });

  it("does not suppress a buy when a potential trim has zero executable KRW", () => {
    const result = calculate([row("a", 1, 1, 5_000), row("b", 1, 1, 5_000)], { cashAmountKrw: 3, trimDriftThresholdPct: 0 });
    assert.equal(result.status, "ready");
    assert.ok(result.rows.every((item) => !item.trimTriggered));
    assert.equal(result.totalAllocatedKrw, 2);
    assert.equal(result.residualCashKrw, 1);
    assertConservation(result);
  });

  it("uses each MA class ratio at and below the three-percent boundary", () => {
    for (const [assetClass, ratio] of [["broad_index", 0.8], ["dividend_quality", 0.8], ["large_growth", 0.7], ["thematic", 0.5], ["other", 0.8]]) {
      for (const distance of [-3, -8]) {
        const result = calculate([row("a", 100, 100, 10_000, { maAssetClass: assetClass, ma120Evidence: { status: "below_ma", distanceFromMaPct: distance } })], { cashAmountKrw: 100 });
        assert.equal(result.status, "ready");
        assert.equal(result.rows[0].maEffectiveMultiplier, ratio);
        assert.equal(result.rows[0].maAdjustmentReason, "below_ma120_full_adjustment");
        assertConservation(result);
      }
    }
  });

  it("interpolates continuously in the MA120 buffer", () => {
    for (const distance of [-0.0003, -1.5, -2.9997]) {
      const result = calculate([row("a", 100, 100, 10_000, { maAssetClass: "thematic", ma120Evidence: { status: "below_ma", distanceFromMaPct: distance } })], { cashAmountKrw: 100 });
      assert.equal(result.status, "ready");
      assert.ok(Math.abs(result.rows[0].maEffectiveMultiplier - (1 + distance / 3 * 0.5)) < 1e-12);
      assert.equal(result.rows[0].maAdjustmentReason, "below_ma120_buffer");
    }
  });

  it("exempts gold and bonds and respects the holding rule switch", () => {
    for (const overrides of [{ maAssetClass: "defensive_gold" }, { maAssetClass: "bond" }, { assetType: "pension" }, { maRuleEnabled: false }]) {
      const result = calculate([row("a", 100, 100, 10_000, { maAssetClass: "thematic", ma120Evidence: { status: "below_ma", distanceFromMaPct: -8 }, ...overrides })], { cashAmountKrw: 100 });
      assert.equal(result.status, "ready");
      assert.equal(result.rows[0].maEffectiveMultiplier, 1);
      assert.equal(result.totalAllocatedKrw, 100);
      assert.equal(result.rows[0].maAdjustmentReason, overrides.maRuleEnabled === false ? "asset_rule_disabled" : "asset_class_exempt");
    }
  });

  it("does not invent a reduction from missing, invalid, or contradictory MA evidence", () => {
    for (const evidence of [
      { status: "above_ma", distanceFromMaPct: 1 }, { status: "at_ma", distanceFromMaPct: 0 },
      { status: "unavailable", distanceFromMaPct: null }, { status: "insufficient_history", distanceFromMaPct: -5 },
      { status: "invalid_history", distanceFromMaPct: -5 }, { status: "below_ma", distanceFromMaPct: null },
      { status: "below_ma", distanceFromMaPct: NaN }, { status: "below_ma", distanceFromMaPct: -Infinity },
      { status: "below_ma", distanceFromMaPct: 1 },
    ]) {
      const result = calculate([row("a", 100, 100, 10_000, { maAssetClass: "thematic", ma120Evidence: evidence })], { cashAmountKrw: 100 });
      assert.equal(result.status, "ready");
      assert.equal(result.rows[0].maEffectiveMultiplier, 1);
      assert.equal(result.totalAllocatedKrw, 100);
    }
  });

  it("falls back to other for unknown classes without using prototype properties", () => {
    for (const assetClass of [null, "unknown", "constructor", "__proto__"]) {
      const result = calculate([row("a", 100, 100, 10_000, { maAssetClass: assetClass, ma120Evidence: { status: "below_ma", distanceFromMaPct: -3 } })], { cashAmountKrw: 100 });
      assert.equal(result.status, "ready");
      assert.equal(result.rows[0].maEffectiveMultiplier, 0.8);
    }
  });

  it("reports a minimum execution shortfall without forcing MA-reduced purchases", () => {
    const rows = [row("a", 100, 100, 10_000, { maAssetClass: "thematic", ma120Evidence: { status: "below_ma", distanceFromMaPct: -3 } })];
    const result = calculate(rows, { cashAmountKrw: 100 });
    assert.equal(result.status, "ready");
    assert.equal(result.minimumExecutionTargetKrw, 85);
    assert.equal(result.minimumExecutionSatisfied, false);
    assert.equal(result.totalAllocatedKrw, 0);
    assert.equal(result.residualCashKrw, 100);
    assert.equal(result.rows[0].strategicAllocationKrw, 100);
    const noMinimum = calculate(rows, { cashAmountKrw: 100, minimumExecutionRatioPct: 0 });
    assert.equal(noMinimum.minimumExecutionTargetKrw, 0);
    assert.equal(noMinimum.minimumExecutionSatisfied, true);
  });

  it("uses the next whole won for a fractional minimum execution reference", () => {
    const result = calculate([row("a", 100, 100, 10_000)], { cashAmountKrw: 1 });
    assert.equal(result.status, "ready");
    assert.equal(result.minimumExecutionTargetKrw, 1);
    assert.equal(result.minimumExecutionSatisfied, true);
    for (const [cashAmountKrw, minimumExecutionRatioPct, target] of [[100, 7, 7], [101, 7, 8], [100, 7.5, 8], [100, 1e-7, 1], [100, 100, 100]]) {
      const reference = calculate([row("a", 100, 100, 10_000)], { cashAmountKrw, minimumExecutionRatioPct });
      assert.equal(reference.status, "ready");
      assert.equal(reference.minimumExecutionTargetKrw, target);
    }
  });

  it("blocks invalid and unsafe monetary inputs and aggregate overflow", () => {
    for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      const result = calculate([row("a", value, 100, 10_000)]);
      assert.equal(result.status, "blocked");
      assert.ok(result.blockers.includes("invalid_current_value"));
      const cost = calculate([row("a", 100, value, 10_000)]);
      assert.equal(cost.status, "blocked");
      assert.ok(cost.blockers.includes("invalid_cost_basis"));
    }
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const result = calculate([row("a", 100, 100, 10_000)], { cashAmountKrw: value });
      assert.equal(result.status, "blocked");
      assert.ok(result.blockers.includes("invalid_cash_amount"));
    }
    const overflow = calculate([row("a", Number.MAX_SAFE_INTEGER, 100, 10_000)], { cashAmountKrw: 1 });
    assert.equal(overflow.status, "blocked");
    assert.ok(overflow.blockers.includes("allocation_invariant_failed"));
    const aggregate = calculate([row("a", Number.MAX_SAFE_INTEGER / 2 + 100, 100, 5_000), row("b", Number.MAX_SAFE_INTEGER / 2 + 100, 100, 5_000)], { cashAmountKrw: 1 });
    assert.equal(aggregate.status, "blocked");
    assert.ok(aggregate.blockers.includes("allocation_invariant_failed"));
  });

  it("preserves cash and holdings for a large safe portfolio", () => {
    const result = calculate([row("a", 700_000_000_000, 500_000_000_000, 5_000), row("b", 300_000_000_000, 300_000_000_000, 5_000)], { cashAmountKrw: 200_000_000_000 });
    assert.equal(result.status, "ready");
    assert.equal(result.totalTrimProceedsKrw, 70_000_000_000);
    assertConservation(result);
  });

  it("accepts fractional valuations at portfolio scale while keeping every cash won exact", () => {
    let seed = 7;
    const next = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let index = 0; index < 200; index += 1) {
      const rows = Array.from({ length: 10 }, (_, holding) => row(String(holding), next() * 2e9, null, 1_000));
      const result = calculate(rows, { cashAmountKrw: 10_000_000 });
      assert.equal(result.status, "ready", `portfolio ${index}`);
      assert.equal(result.totalAllocatedKrw + result.residualCashKrw, 10_000_000);
      assert.ok(result.rows.every((item) => item.allocationKrw <= item.baseNeedKrw && Number.isSafeInteger(item.allocationKrw)));
      const difference = Math.abs(result.rows.reduce((total, item) => total + item.postTradeValueKrw, 0) + result.residualCashKrw - result.postContributionTotalKrw);
      assert.ok(difference < 0.001, `portfolio ${index}: ${difference}`);
    }
  });

  it("blocks duplicate keys, unavailable buy targets, invalid parameters, and empty valuations", () => {
    const cases = [
      [calculate([row("a", 100, 100, 5_000), row("a", 100, 100, 5_000)]), "duplicate_allocation_key"],
      [calculate([row("a", 100, 100, 10_000, { buyable: false })]), "unallocatable_target_deficit"],
      [calculate([row("a", 100, 100, 10_000)], { trimDriftThresholdPct: -1 }), "invalid_policy_parameter"],
      [calculate([row("a", 100, 100, 10_000)], { minimumExecutionRatioPct: 101 }), "invalid_policy_parameter"],
      [calculate([row("a", 0, 0, 10_000)]), "empty_valuation_universe"],
      [calculate([]), "empty_valuation_universe"],
      [calculate([row("a", 100, 100, 10_001)]), "invalid_target_weight"],
    ];
    for (const [result, blocker] of cases) {
      assert.equal(result.status, "blocked");
      assert.ok(result.blockers.includes(blocker));
    }
  });
});

function calculate(rows, overrides = {}) {
  return calculateExplainableAdditionalContribution({ rows, cashAmountKrw: 200_000, minimumExecutionRatioPct: 85, trimDriftThresholdPct: 12, ...overrides });
}

function assertConservation(result) {
  assert.equal(result.totalAllocatedKrw + result.residualCashKrw, result.totalAvailableFundsKrw);
  assert.equal(result.cashAmountKrw + result.totalTrimProceedsKrw, result.totalAvailableFundsKrw);
  assert.ok(Math.abs(result.rows.reduce((total, item) => total + item.postTradeValueKrw, 0) + result.residualCashKrw - result.postContributionTotalKrw) < 1e-6);
  for (const item of result.rows) {
    assert.ok(Number.isSafeInteger(item.allocationKrw) && item.allocationKrw >= 0);
    assert.ok(Number.isSafeInteger(item.trimAmountKrw) && item.trimAmountKrw >= 0);
    assert.ok(item.trimAmountKrw <= item.currentValueKrw);
    assert.ok(item.allocationKrw <= item.baseNeedKrw);
    assert.ok(item.strategicAllocationKrw <= item.strategicNeedKrw);
    assert.ok(item.trimAmountKrw === 0 || item.allocationKrw === 0);
  }
}

function row(allocationKey, currentValueKrw, costBasisKrw, targetWeightBps, overrides = {}) {
  return Object.freeze({
    allocationKey,
    assetType: "etf",
    buyable: true,
    costBasisKrw,
    currentValueKrw,
    ma120Evidence: Object.freeze({ status: "above_ma", distanceFromMaPct: 5 }),
    maAssetClass: "other",
    maRuleEnabled: true,
    metadata: Object.freeze({ allocationKey }),
    targetWeightBps,
    ...overrides,
  });
}
