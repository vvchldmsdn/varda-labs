import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioStructure,
  normalizeStructureAccount,
} from "../src/lib/portfolio-structure.ts";

function asset(overrides = {}) {
  return {
    id: "asset-kr",
    legacyBase44Id: "legacy-kr",
    name: "KODEX 200",
    ticker: "069500",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    quantity: 10,
    currentPrice: 90,
    targetWeight: 40,
    groupId: "group-growth",
    priceSource: "manual",
    ...overrides,
  };
}

function group(overrides = {}) {
  return {
    id: "group-growth",
    name: "Growth",
    targetWeight: 60,
    isActive: true,
    ...overrides,
  };
}

function member(overrides = {}) {
  return {
    assetId: "asset-kr",
    groupId: "group-growth",
    allocationRatio: null,
    isActive: true,
    ...overrides,
  };
}

function quote(overrides = {}) {
  return {
    ticker: "069500",
    market: "korea",
    currency: "KRW",
    price: 100,
    source: "kis",
    status: "ok",
    quoteType: "live",
    fetchedAt: "2026-07-09T01:00:00.000Z",
    ...overrides,
  };
}

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function assertNoInternalIds(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("asset-kr"), false);
  assert.equal(serialized.includes("asset-us"), false);
  assert.equal(serialized.includes("group-growth"), false);
  assert.equal(serialized.includes("legacy-kr"), false);
  assert.equal(serialized.includes("legacy-us"), false);
  assert.equal(serialized.includes("assetId"), false);
  assert.equal(serialized.includes("groupId"), false);
  assert.equal(serialized.includes("legacyBase44Id"), false);
}

describe("portfolio structure read model", () => {
  it("normalizes unknown account filters to brokerage", () => {
    assert.equal(normalizeStructureAccount("invalid"), "brokerage");
    assert.equal(normalizeStructureAccount("all"), "all");
  });

  it("computes KRW valuation from usable live quotes", () => {
    const result = buildPortfolioStructure({
      assets: [asset()],
      groups: [group()],
      liveQuotes: [quote()],
      usdKrwRate: 1516.9,
      selectedAccount: "brokerage",
    });

    assert.equal(result.totalValueKrw, 1000);
    assert.equal(result.includedHoldingCount, 1);
    assert.equal(result.excludedHoldingCount, 0);
    assert.equal(result.holdingRows[0].currentPrice, 100);
    assert.equal(result.holdingRows[0].priceEvidenceSource, "live_price_quote");
    assert.equal(result.holdingRows[0].priceSource, "kis");
    assert.equal(result.holdingRows[0].currentWeightPct, 100);
    assert.equal(result.holdingRows[0].groupTargetPct, 60);
    assert.equal(result.groupRows[0].name, "Growth");
    assert.equal(result.groupRows[0].currentValueKrw, 1000);
    assert.equal(result.groupRows[0].groupTargetPct, 60);
    assertNoInternalIds(result);
  });

  it("computes USD valuation with stored FX", () => {
    const result = buildPortfolioStructure({
      assets: [
        asset({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          market: "us",
          currency: "USD",
          quantity: 2,
          currentPrice: 490,
          groupId: null,
        }),
      ],
      liveQuotes: [
        quote({
          ticker: "VOO",
          market: "us",
          currency: "USD",
          price: 500,
        }),
      ],
      usdKrwRate: 1500,
      selectedAccount: "brokerage",
    });

    assert.equal(result.totalValueKrw, 1_500_000);
    assert.equal(result.holdingRows[0].currentPrice, 500);
    assert.equal(result.holdingRows[0].groupName, "Ungrouped");
    assert.equal(result.groupRows[0].name, "Ungrouped");
    assertNoInternalIds(result);
  });

  it("excludes USD rows when FX is missing", () => {
    const result = buildPortfolioStructure({
      assets: [
        asset({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          market: "us",
          currency: "USD",
          quantity: 2,
        }),
      ],
      liveQuotes: [
        quote({
          ticker: "VOO",
          market: "us",
          currency: "USD",
          price: 500,
        }),
      ],
      usdKrwRate: null,
      selectedAccount: "brokerage",
    });

    assert.equal(result.totalValueKrw, 0);
    assert.equal(result.exclusions.length, 1);
    assert.equal(result.exclusions[0].reason, "missing_fx");
    assert.equal(result.dataHealth.missingFxCount, 1);
    assertNoInternalIds(result);
  });

  it("excludes unsupported currencies instead of treating them as KRW", () => {
    const result = buildPortfolioStructure({
      assets: [
        asset({
          name: "Japan ETF",
          ticker: "101280",
          market: "japan",
          currency: "JPY",
          quantity: 2,
        }),
      ],
      liveQuotes: [
        quote({
          ticker: "101280",
          market: "japan",
          currency: "JPY",
          price: 1000,
        }),
      ],
      usdKrwRate: 1500,
      selectedAccount: "brokerage",
    });

    assert.equal(result.exclusions.length, 1);
    assert.equal(result.exclusions[0].reason, "unsupported_currency");
    assert.equal(result.dataHealth.unsupportedCurrencyCount, 1);
    assertNoInternalIds(result);
  });

  it("uses asset current price as a labeled fallback when no quote exists", () => {
    const result = buildPortfolioStructure({
      assets: [asset({ currentPrice: 90, priceSource: "manual_cache" })],
      groups: [group()],
      liveQuotes: [],
      usdKrwRate: 1500,
      selectedAccount: "brokerage",
    });

    assert.equal(result.totalValueKrw, 900);
    assert.equal(result.holdingRows[0].currentPrice, 90);
    assert.equal(
      result.holdingRows[0].priceEvidenceSource,
      "asset_current_price_fallback",
    );
    assert.equal(result.holdingRows[0].priceSource, "manual_cache");
    assertNoInternalIds(result);
  });

  it("keeps member allocation as unresolved raw policy evidence", () => {
    const result = buildPortfolioStructure({
      assets: [asset()],
      groups: [group()],
      groupMembers: [member({ allocationRatio: 25 })],
      liveQuotes: [quote()],
      usdKrwRate: 1500,
      selectedAccount: "brokerage",
    });

    const holding = result.holdingRows[0];
    assert.equal(holding.rawAssetTargetPct, 40);
    assert.equal(holding.groupTargetPct, 60);
    assert.equal(holding.memberAllocationRatioPct, 25);
    assert.equal(holding.effectiveTargetPct, null);
    assert.equal(holding.driftPct, null);
    assert.equal(holding.targetPolicyStatus, "target_policy_unresolved");
    assert.equal(result.dataHealth.unresolvedTargetPolicyCount, 1);
    assertNoInternalIds(result);
  });

  it("groups ungrouped holdings in an explicit bucket", () => {
    const result = buildPortfolioStructure({
      assets: [
        asset(),
        asset({
          id: "asset-cashlike",
          name: "SCHD",
          ticker: "SCHD",
          market: "us",
          currency: "USD",
          quantity: 1,
          currentPrice: 50,
          targetWeight: null,
          groupId: null,
        }),
      ],
      groups: [group()],
      liveQuotes: [
        quote(),
        quote({
          ticker: "SCHD",
          market: "us",
          currency: "USD",
          price: 50,
        }),
      ],
      usdKrwRate: 1500,
      selectedAccount: "all",
    });

    assertClose(result.totalValueKrw, 76_000);
    assert.deepEqual(
      result.groupRows.map((row) => row.name),
      ["Growth", "Ungrouped"],
    );
    assert.equal(result.groupRows[0].currentValueKrw, 1000);
    assert.equal(result.groupRows[1].currentValueKrw, 75_000);
    assertNoInternalIds(result);
  });
});
