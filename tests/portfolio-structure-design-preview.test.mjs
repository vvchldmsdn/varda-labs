import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortfolioRiskDesignPreview } from "../src/lib/portfolio-risk-design-preview.ts";

describe("portfolio structure design preview", () => {
  it("anchors risk weights to the same current holding values as the structure view", () => {
    const eligibleHoldings = [
      holding({
        ticker: "069500",
        name: "KODEX 200",
        market: "korea",
        currency: "KRW",
        currentPrice: 117_700,
        currentValueKrw: 5_612_300,
      }),
      holding({
        ticker: "VOO",
        name: "Vanguard S&P 500 ETF",
        market: "us",
        currency: "USD",
        currentPrice: 687.03,
        currentValueKrw: 4_706_500,
      }),
      holding({
        ticker: "0139P0",
        name: "ACE 고배당",
        market: "korea",
        currency: "KRW",
        currentPrice: 13_305,
        currentValueKrw: 4_103_200,
      }),
    ];
    const preview = buildPortfolioRiskDesignPreview(eligibleHoldings);
    const eligibleValue = eligibleHoldings.reduce(
      (sum, holding) => sum + holding.currentValueKrw,
      0,
    );
    const expectedWeightByTicker = new Map();

    for (const holding of eligibleHoldings) {
      expectedWeightByTicker.set(
        holding.ticker,
        (expectedWeightByTicker.get(holding.ticker) ?? 0) +
          holding.currentValueKrw / eligibleValue,
      );
    }

    assert.equal(preview.calculation.calculationStatus, "complete");
    for (const instrument of preview.calculation.instruments) {
      const expectedWeight = expectedWeightByTicker.get(instrument.ticker);
      assert.notEqual(expectedWeight, undefined);
      assert.notEqual(instrument.weight, null);
      assert.ok(
        Math.abs(instrument.weight - expectedWeight) < 0.005,
        `${instrument.ticker} risk weight should remain aligned with its current holding weight`,
      );
    }
  });
});

function holding({
  ticker,
  name,
  market,
  currency,
  currentPrice,
  currentValueKrw,
}) {
  return {
    name,
    ticker,
    account: "brokerage",
    market,
    currency,
    assetType: "etf",
    groupName: "테스트",
    quantity: 1,
    currentPrice,
    currentValueKrw,
    currentWeightPct: 0,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "missing_target",
    priceEvidenceSource: "asset_current_price_fallback",
    priceSource: "test",
    priceFetchedAt: null,
    priceAsOf: null,
  };
}
