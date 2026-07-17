import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabSmallAdjustmentModel,
  calculateInvestmentLabSmallAdjustment,
} from "../src/lib/investment-lab-small-adjustment.ts";

describe("investment lab small adjustment", () => {
  it("builds account-scoped direct holding evidence without internal ids", () => {
    const model = buildInvestmentLabSmallAdjustmentModel({
      holdingRows: [
        holding("KODEX 200", "069500", "KRW", 500_000),
        holding("KODEX 200 lot 2", "069500", "KRW", 100_000),
        holding("VOO", "VOO", "USD", 400_000),
        holding("ISA ETF", "133690", "KRW", 300_000, "isa"),
      ],
      exclusions: [],
    });

    const brokerage = account(model, "brokerage");
    assert.equal(brokerage.status, "ready");
    assert.equal(brokerage.holdings.length, 2);
    assert.equal(brokerage.totalValueKrw, 1_000_000);
    assert.equal(brokerage.holdings[0].ticker, "069500");
    assert.equal(brokerage.holdings[0].currentValueKrw, 600_000);
    assert.equal(brokerage.holdings[0].currentWeightPct, 60);

    const isa = account(model, "isa");
    assert.equal(isa.status, "unavailable");
    assert.deepEqual(isa.blockers, ["insufficient_holdings"]);
    assert.doesNotMatch(JSON.stringify(model), /assetId|legacyBase44Id|groupId/);
  });

  it("returns only the account selected by the page scope", () => {
    const portfolio = {
      holdingRows: [
        holding("Brokerage ETF", "069500", "KRW", 500_000),
        holding("ISA ETF 1", "133690", "KRW", 300_000, "isa"),
        holding("ISA ETF 2", "360200", "KRW", 200_000, "isa"),
      ],
      exclusions: [],
    };

    const isa = buildInvestmentLabSmallAdjustmentModel(portfolio, "isa");
    assert.deepEqual(
      isa.accounts.map((row) => row.account),
      ["isa"],
    );
    assert.equal(isa.accounts[0].status, "ready");
    assert.equal(isa.accounts[0].totalValueKrw, 500_000);

    const all = buildInvestmentLabSmallAdjustmentModel(portfolio);
    assert.deepEqual(
      all.accounts.map((row) => row.account),
      ["brokerage", "isa", "irp"],
    );
  });

  it("moves a user-specified KRW value and reconciles concentration and FX exposure", () => {
    const model = buildInvestmentLabSmallAdjustmentModel({
      holdingRows: [
        holding("KODEX 200", "069500", "KRW", 600_000),
        holding("VOO", "VOO", "USD", 300_000),
        holding("QQQ", "QQQ", "USD", 100_000),
      ],
      exclusions: [],
    });
    const brokerage = account(model, "brokerage");
    const source = brokerage.holdings.find((row) => row.ticker === "069500");
    const destination = brokerage.holdings.find((row) => row.ticker === "VOO");

    const result = calculateInvestmentLabSmallAdjustment({
      account: brokerage,
      sourceKey: source.key,
      destinationKey: destination.key,
      transferAmountKrw: 100_000,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.totalValueKrw, 1_000_000);
    assert.equal(result.source.beforeValueKrw, 600_000);
    assert.equal(result.source.afterValueKrw, 500_000);
    assert.equal(result.destination.beforeValueKrw, 300_000);
    assert.equal(result.destination.afterValueKrw, 400_000);
    assert.equal(result.beforeConcentration.largestHoldingWeightPct, 60);
    assert.equal(result.afterConcentration.largestHoldingWeightPct, 50);
    assertClose(result.beforeConcentration.hhiPoints, 4600);
    assertClose(result.afterConcentration.hhiPoints, 4200);

    const krw = result.currencyExposures.find((row) => row.currency === "KRW");
    const usd = result.currencyExposures.find((row) => row.currency === "USD");
    assert.deepEqual(krw, {
      currency: "KRW",
      beforeValueKrw: 600_000,
      afterValueKrw: 500_000,
      beforeWeightPct: 60,
      afterWeightPct: 50,
      changePercentagePoints: -10,
    });
    assert.deepEqual(usd, {
      currency: "USD",
      beforeValueKrw: 400_000,
      afterValueKrw: 500_000,
      beforeWeightPct: 40,
      afterWeightPct: 50,
      changePercentagePoints: 10,
    });
  });

  it("fails the whole account closed when any holding lacks valuation evidence", () => {
    const model = buildInvestmentLabSmallAdjustmentModel({
      holdingRows: [
        holding("KODEX 200", "069500", "KRW", 600_000),
        holding("VOO", "VOO", "USD", 400_000),
      ],
      exclusions: [exclusion("Missing ETF", "MISSING", "missing_fx")],
    });
    const brokerage = account(model, "brokerage");

    assert.equal(brokerage.status, "unavailable");
    assert.deepEqual(brokerage.blockers, ["incomplete_valuation_coverage"]);
    assert.equal(brokerage.excludedHoldingCount, 1);
    assert.equal(brokerage.exclusionReasonCounts.missingFx, 1);

    const result = calculateInvestmentLabSmallAdjustment({
      account: brokerage,
      sourceKey: brokerage.holdings[0].key,
      destinationKey: brokerage.holdings[1].key,
      transferAmountKrw: 10_000,
    });
    assert.deepEqual(result.blockers, ["account_unavailable"]);
  });

  it("fails closed instead of merging holdings with unresolved canonical identity", () => {
    const model = buildInvestmentLabSmallAdjustmentModel({
      holdingRows: [
        holding("KODEX 200", "069500", "KRW", 600_000),
        holding("VOO", "VOO", "USD", 400_000),
        holding("Shared name", null, "KRW", 10_000),
        { ...holding("Shared name", "UNKNOWN-FX", "KRW", 10_000), currency: "UNKNOWN" },
        { ...holding("Missing market", "NO-MARKET", "KRW", 10_000), market: "" },
      ],
      exclusions: [],
    });
    const brokerage = account(model, "brokerage");

    assert.equal(brokerage.status, "unavailable");
    assert.equal(brokerage.unresolvedInstrumentCount, 3);
    assert.ok(brokerage.blockers.includes("unresolved_holding_identity"));
    assert.equal(brokerage.holdings.length, 2);
    assert.doesNotMatch(JSON.stringify(brokerage.holdings), /Shared name/);

    const result = calculateInvestmentLabSmallAdjustment({
      account: brokerage,
      sourceKey: brokerage.holdings[0].key,
      destinationKey: brokerage.holdings[1].key,
      transferAmountKrw: 10_000,
    });
    assert.deepEqual(result.blockers, ["account_unavailable"]);
  });

  it("blocks invalid, same-holding, unknown, and overdrawn transfers", () => {
    const model = buildInvestmentLabSmallAdjustmentModel({
      holdingRows: [
        holding("KODEX 200", "069500", "KRW", 600_000),
        holding("VOO", "VOO", "USD", 400_000),
      ],
      exclusions: [],
    });
    const brokerage = account(model, "brokerage");
    const [source, destination] = brokerage.holdings;

    assert.deepEqual(
      calculateInvestmentLabSmallAdjustment({
        account: brokerage,
        sourceKey: source.key,
        destinationKey: destination.key,
        transferAmountKrw: 1.5,
      }).blockers,
      ["invalid_transfer_amount"],
    );
    assert.deepEqual(
      calculateInvestmentLabSmallAdjustment({
        account: brokerage,
        sourceKey: source.key,
        destinationKey: source.key,
        transferAmountKrw: 1,
      }).blockers,
      ["same_holding"],
    );
    assert.deepEqual(
      calculateInvestmentLabSmallAdjustment({
        account: brokerage,
        sourceKey: "unknown",
        destinationKey: destination.key,
        transferAmountKrw: 1,
      }).blockers,
      ["source_holding_unavailable"],
    );
    assert.deepEqual(
      calculateInvestmentLabSmallAdjustment({
        account: brokerage,
        sourceKey: source.key,
        destinationKey: destination.key,
        transferAmountKrw: Math.floor(source.currentValueKrw) + 1,
      }).blockers,
      ["insufficient_source_value"],
    );
  });

  it("keeps the interactive boundary client-only and the DB read server-only", () => {
    const componentSource = readFileSync(
      new URL(
        "../src/components/investment-lab/investment-lab-small-adjustment.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const querySource = readFileSync(
      new URL("../src/db/queries/portfolio-structure.ts", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/investment-lab/page.tsx", import.meta.url),
      "utf8",
    );

    assert.match(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
    assert.doesNotMatch(componentSource, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
    assert.match(
      querySource,
      /cache\(\s*loadReadOnlyAllPortfolioStructure,\s*\)/,
    );
    assert.match(pageSource, /InvestmentLabSmallAdjustmentSkeleton/);
    assert.match(pageSource, /InvestmentLabSmallAdjustmentUnavailable/);
  });
});

function account(model, accountCode) {
  return model.accounts.find((row) => row.account === accountCode);
}

function holding(name, ticker, currency, currentValueKrw, accountCode = "brokerage") {
  return {
    name,
    ticker,
    account: accountCode,
    market: currency === "USD" ? "us" : "korea",
    currency,
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: 1,
    currentValueKrw,
    currentWeightPct: 0,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "missing_target",
    priceEvidenceSource: "live_price_quote",
    priceSource: "fixture",
    priceFetchedAt: null,
    priceAsOf: null,
  };
}

function exclusion(name, ticker, reason) {
  return {
    reason,
    name,
    ticker,
    account: "brokerage",
    market: "us",
    currency: "USD",
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: 1,
  };
}

function assertClose(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}
