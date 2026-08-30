import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdditionalContributionView } from "../src/lib/additional-contribution-view.ts";

describe("additional contribution presentation view", () => {
  it("reconciles both displayed flows to funds including trim proceeds", () => {
    const view = buildAdditionalContributionView({
      cashAmountKrw: 150,
      currentPortfolioTotalKrw: 1_000,
      postTopupTotalKrw: 1_100,
      totalAllocatedKrw: 120,
      residualCashKrw: 30,
      rows: [
        row({
          allocationKrw: 120,
          strategicAllocationKrw: 140,
          ma120ReductionKrw: 20,
        }),
      ],
    });
    assert.equal(view.allocatedPct, 80);
    assert.equal(
      view.flowRows.reduce((sum, item) => sum + item.allocationKrw, 0),
      150,
    );
    assert.equal(
      view.flowRows.reduce((sum, item) => sum + item.strategicAllocationKrw, 0),
      150,
    );
    assert.equal(
      view.flowRows.find((item) => item.kind === "cash").strategicAllocationKrw,
      10,
    );
  });
  it("measures target-distance improvement while treating residual cash as zero-target weight", () => {
    const view = buildAdditionalContributionView({
      cashAmountKrw: 20,
      currentPortfolioTotalKrw: 100,
      postTopupTotalKrw: 120,
      totalAllocatedKrw: 15,
      residualCashKrw: 5,
      rows: [
        row({
          ticker: "AAA",
          name: "Alpha",
          currentValueKrw: 60,
          currentWeightPct: 60,
          targetWeightPct: 50,
          allocationKrw: 0,
          strategicAllocationKrw: 0,
          postTopupValueKrw: 60,
          postTopupWeightPct: 50,
        }),
        row({
          ticker: "BBB",
          name: "Beta",
          currentValueKrw: 40,
          currentWeightPct: 40,
          targetWeightPct: 50,
          allocationKrw: 15,
          strategicAllocationKrw: 20,
          ma120ReductionKrw: 5,
          postTopupValueKrw: 55,
          postTopupWeightPct: 55 / 1.2,
        }),
      ],
    });

    assert.equal(view.recipientCount, 1);
    assert.equal(view.reducedHoldingCount, 1);
    assert.equal(view.totalReductionKrw, 5);
    assert.equal(view.allocatedPct, 75);
    assert.equal(view.targetDistanceBeforePct, 10);
    assert.ok(Math.abs(view.targetDistanceAfterPct - 4.1666666667) < 1e-8);
    assert.ok(
      Math.abs(view.targetDistanceImprovementPct - 5.8333333333) < 1e-8,
    );
    assert.deepEqual(
      view.flowRows.map((flow) => [flow.id, flow.allocationKrw]),
      [
        ["brokerage:korea:KRW:BBB", 15],
        ["residual-cash", 5],
      ],
    );
  });

  it("keeps the graph bounded by aggregating only the smallest overflow rows", () => {
    const rows = Array.from({ length: 11 }, (_, index) =>
      row({
        ticker: `A${String(index).padStart(2, "0")}`,
        name: `Asset ${index}`,
        currentValueKrw: 1_000,
        currentWeightPct: 100 / 11,
        targetWeightPct: 100 / 11,
        allocationKrw: 11 - index,
        strategicAllocationKrw: 11 - index,
        postTopupValueKrw: 1_011 - index,
        postTopupWeightPct: 100 / 11,
      }),
    );
    const view = buildAdditionalContributionView({
      cashAmountKrw: 66,
      currentPortfolioTotalKrw: 11_000,
      postTopupTotalKrw: 11_066,
      totalAllocatedKrw: 66,
      residualCashKrw: 0,
      rows,
    });

    assert.equal(view.recipientCount, 11);
    assert.equal(view.flowRows.length, 10);
    assert.deepEqual(view.flowRows.at(-1), {
      id: "other-holdings",
      name: "기타 2종목",
      ticker: null,
      accountName: "여러 계좌",
      allocationKrw: 3,
      strategicAllocationKrw: 3,
      reductionKrw: 0,
      targetWeightPct: 200 / 11,
      postTopupWeightPct: 200 / 11,
      aggregatedHoldingCount: 2,
      kind: "other",
    });
  });
});

function row(overrides = {}) {
  return {
    accountCode: "brokerage",
    accountName: "증권",
    allocationKrw: 0,
    currentValueKrw: 0,
    currentWeightPct: 0,
    currency: "KRW",
    ma120ReductionKrw: 0,
    market: "korea",
    name: "Asset",
    postTopupValueKrw: 0,
    postTopupWeightPct: 0,
    strategicAllocationKrw: 0,
    targetWeightPct: 0,
    ticker: "AAA",
    ...overrides,
  };
}
