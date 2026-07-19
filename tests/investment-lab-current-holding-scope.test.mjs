import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyInvestmentLabCurrentHoldingScope } from "../src/lib/investment-lab-current-holding-scope.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";

describe("investment lab current holding scope", () => {
  it("excludes the exact reviewed Fount holding and renormalizes remaining weights", () => {
    const result = applyInvestmentLabCurrentHoldingScope({
      holdingRows: [
        holding("Listed A", "irp", 600),
        fountHolding(400),
      ],
      exclusions: [],
    });

    assert.equal(result.status, "applied");
    assert.equal(result.excludedHoldingCount, 1);
    assert.equal(result.excludedCurrentValueKrw, 400);
    assert.equal(result.portfolio.holdingRows.length, 1);
    assert.equal(result.portfolio.holdingRows[0].name, "Listed A");
    assert.equal(result.portfolio.holdingRows[0].currentWeightPct, 100);
  });

  it("removes an exact excluded valuation gap without hiding unrelated gaps", () => {
    const unrelated = exclusion("Missing quote", "irp");
    const result = applyInvestmentLabCurrentHoldingScope({
      holdingRows: [],
      exclusions: [fountExclusion(), unrelated],
    });

    assert.equal(result.status, "applied");
    assert.equal(result.excludedValuationGapCount, 1);
    assert.deepEqual(result.portfolio.exclusions, [unrelated]);
  });

  it("does not infer an exclusion from a partial metadata match", () => {
    const nearMatch = {
      ...fountHolding(400),
      account: "brokerage",
    };
    const result = applyInvestmentLabCurrentHoldingScope({
      holdingRows: [nearMatch],
      exclusions: [],
    });

    assert.equal(result.status, "not_applicable");
    assert.equal(result.excludedHoldingCount, 0);
    assert.equal(result.portfolio.holdingRows[0].name, nearMatch.name);
  });
});

function fountHolding(currentValueKrw) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  return holding(
    decision.assetName,
    decision.account,
    currentValueKrw,
    decision.market,
    decision.currency,
    decision.assetType,
  );
}

function holding(
  name,
  account,
  currentValueKrw,
  market = "korea",
  currency = "KRW",
  assetType = "etf",
) {
  return {
    name,
    ticker: "TEST",
    account,
    market,
    currency,
    assetType,
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: currentValueKrw,
    currentValueKrw,
    currentWeightPct: 40,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "missing_target",
    priceEvidenceSource: "asset_current_price_fallback",
    priceSource: "manual",
    priceFetchedAt: null,
    priceAsOf: null,
  };
}

function fountExclusion() {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  return exclusion(
    decision.assetName,
    decision.account,
    decision.market,
    decision.currency,
    decision.assetType,
  );
}

function exclusion(
  name,
  account,
  market = "korea",
  currency = "KRW",
  assetType = "etf",
) {
  return {
    reason: "missing_price",
    name,
    ticker: null,
    account,
    market,
    currency,
    assetType,
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: null,
  };
}
