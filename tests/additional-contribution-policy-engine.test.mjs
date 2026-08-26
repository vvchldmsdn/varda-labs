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
});

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
