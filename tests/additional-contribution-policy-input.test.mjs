import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  additionalContributionCostBasisKrw,
  additionalContributionFallbackValueKrw,
  additionalContributionMaAssetClass,
  matchLegacyAdditionalContributionTargets,
  resolveAdditionalContributionPolicyParameters,
} from "../src/lib/additional-contribution-policy-input.ts";

describe("additional contribution policy input evidence", () => {
  it("distinguishes absent settings from explicitly configured zero", () => {
    for (const value of [null, undefined, "", "  ", "not-a-number", "101", "-1"]) {
      const result = resolveAdditionalContributionPolicyParameters({ minExecutionRatioPct: value, trimDriftThreshold: value, useTrendFilter: false });
      assert.equal(result.trimDriftThresholdPct, 12);
      assert.equal(result.minimumExecutionRatioPct, 85);
    }
    assert.deepEqual(resolveAdditionalContributionPolicyParameters({ minExecutionRatioPct: "0", trimDriftThreshold: "0", useTrendFilter: true }), {
      minimumExecutionRatioPct: 0, trimDriftThresholdPct: 0, useTrendFilter: true,
    });
  });

  it("adds fractional KRW cost once without applying FX to it", () => {
    const row = position({ fractionalKrwValue: "80000", fractionalAvgCost: "60000" });
    assert.equal(additionalContributionCostBasisKrw(row, 1500), 360000);
    assert.equal(additionalContributionFallbackValueKrw(row, 1500), 410000);
  });

  it("keeps incomplete fractional cost unknown instead of manufacturing profit", () => {
    assert.equal(additionalContributionCostBasisKrw(position({ fractionalKrwValue: "80000", fractionalAvgCost: null }), 1500), null);
    assert.equal(additionalContributionCostBasisKrw(position({ fractionalKrwValue: "80000", fractionalAvgCost: "0" }), 1500), null);
    assert.equal(additionalContributionCostBasisKrw(position({ fractionalKrwValue: "80000", fractionalAvgCost: "invalid" }), 1500), null);
    assert.equal(additionalContributionCostBasisKrw(position({ averageCost: null }), 1500), null);
  });

  it("retains a known fractional-only KRW position without requiring a fictitious unit price or FX", () => {
    const row = position({ quantity: "0", averageCost: null, currentPrice: "0", fractionalKrwValue: "80000", fractionalAvgCost: "60000" });
    assert.equal(additionalContributionCostBasisKrw(row, null), 60000);
    assert.equal(additionalContributionFallbackValueKrw(row, null), 80000);
  });

  it("does not replace missing or non-finite FX with zero", () => {
    for (const rate of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(additionalContributionCostBasisKrw(position(), rate), null);
      assert.equal(additionalContributionFallbackValueKrw(position(), rate), null);
    }
    assert.equal(additionalContributionCostBasisKrw(position({ currency: "KRW" }), null), 200);
  });

  it("recognizes the canonical gold binding and explicit bond class without exempting other commodities", () => {
    const gold = { assetName: "금현물", assetType: "commodity", ticker: null, market: "korea", currency: "KRW", maAssetClass: null };
    assert.equal(additionalContributionMaAssetClass(gold), "defensive_gold");
    assert.equal(additionalContributionMaAssetClass({ ...gold, assetName: "원유" }), null);
    assert.equal(additionalContributionMaAssetClass({ ...gold, assetName: "채권 ETF", assetType: "etf", ticker: "BOND", maAssetClass: " BOND " }), "bond");
  });

  it("preserves an exact legacy zero-target row using the current asset UUID", () => {
    const input = legacyInput();
    const result = matchLegacyAdditionalContributionTargets(input);
    assert.equal(result.status, "ready");
    assert.equal(result.targetsByAsset.get("asset-b").targetWeightPct, 0);
  });

  it("blocks dropped, duplicated, and foreign-account legacy identities", () => {
    const input = legacyInput();
    const variants = [
      { ...input, modelRows: input.modelRows.slice(0, 1) },
      { ...input, modelRows: [...input.modelRows, { ...input.modelRows[0], assetId: "asset-c" }] },
      { ...input, legacyRows: [input.legacyRows[0], input.legacyRows[0]] },
      { ...input, modelRows: input.modelRows.map((row) => ({ ...row, accountId: "another-account" })) },
      { ...input, legacyRows: input.legacyRows.map((row) => ({ ...row, targetWeightPct: 40 })) },
    ];
    for (const candidate of variants) assert.equal(matchLegacyAdditionalContributionTargets(candidate).status, "blocked");
  });
});

function position(overrides = {}) {
  return { quantity: "2", averageCost: "100", currentPrice: "110", currency: "USD", fractionalKrwValue: null, fractionalAvgCost: null, ...overrides };
}

function legacyInput() {
  const instruments = ["AAA", "BBB"].map((ticker) => ({ market: "korea", currency: "KRW", ticker }));
  return {
    accountId: "account-a", accountCode: "isa",
    modelRows: instruments.map((row, index) => ({ ...row, accountId: "account-a", accountCode: "isa", assetId: index === 0 ? "asset-a" : "asset-b" })),
    legacyRows: instruments.map((row, index) => ({ ...row, targetWeightPct: index === 0 ? 100 : 0 })),
  };
}
