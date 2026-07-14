import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildPortfolioSpecialHoldingsModel } from "../src/lib/portfolio-special-holdings.ts";

describe("portfolio special holdings coverage", () => {
  it("classifies only explicit product evidence and preserves adjustment blockers", () => {
    const model = buildPortfolioSpecialHoldingsModel({
      selectedAccount: "all",
      holdingRows: [
        holding("KODEX 200", "069500", "etf", 500_000, 50),
        holding("금현물", null, "commodity", 200_000, 20),
        holding("Explicit managed", null, "managed_sleeve", 100_000, 10),
        holding("Fount 일임서비스", null, "etf", 200_000, 20, "irp"),
      ],
      exclusions: [exclusion("Missing quote", "MISSING", "missing_price")],
    });

    assert.equal(model.status, "review_required");
    assert.equal(model.totalPositionCount, 5);
    assert.equal(model.valuedPositionCount, 4);
    assert.equal(model.excludedPositionCount, 1);
    assert.equal(model.adjustablePositionCount, 1);
    assert.equal(model.ineligiblePositionCount, 4);
    assert.equal(model.listedInstrumentCount, 2);
    assert.equal(model.physicalCommodityPositionCount, 1);
    assert.equal(model.managedSleeveCount, 1);
    assert.equal(model.unresolvedCount, 1);
    assert.equal(model.adjustableValuedWeightPct, 50);
    assert.equal(model.ineligibleValuedWeightPct, 50);

    const gold = row(model, "금현물");
    assert.equal(gold.classification, "physical_commodity_position");
    assert.equal(
      gold.adjustmentReason,
      "physical_commodity_execution_model_unavailable",
    );
    const managed = row(model, "Explicit managed");
    assert.equal(managed.classification, "managed_sleeve");
    assert.equal(
      managed.adjustmentReason,
      "managed_sleeve_not_directly_adjustable",
    );
    const fount = row(model, "Fount 일임서비스");
    assert.equal(fount.classification, "unresolved");
    assert.equal(
      fount.adjustmentReason,
      "instrument_classification_unresolved",
    );
    const missing = row(model, "Missing quote");
    assert.equal(missing.classification, "listed_instrument");
    assert.equal(missing.valuationStatus, "missing_price");
    assert.equal(missing.adjustmentReason, "valuation_evidence_incomplete");
  });

  it("does not infer a managed sleeve from a display name", () => {
    const model = buildPortfolioSpecialHoldingsModel({
      selectedAccount: "irp",
      holdingRows: [
        holding("Managed robo advisory service", null, "etf", 100_000, 100),
      ],
      exclusions: [],
    });

    assert.equal(model.managedSleeveCount, 0);
    assert.equal(model.unresolvedCount, 1);
    assert.equal(model.attentionRows[0].classification, "unresolved");
  });

  it("treats a ticker-bearing commodity as a listed instrument", () => {
    const model = buildPortfolioSpecialHoldingsModel({
      selectedAccount: "brokerage",
      holdingRows: [
        holding("Listed gold ETF", "GLD", "commodity", 100_000, 100),
      ],
      exclusions: [],
    });

    assert.equal(model.status, "complete");
    assert.equal(model.listedInstrumentCount, 1);
    assert.equal(model.physicalCommodityPositionCount, 0);
    assert.equal(model.adjustablePositionCount, 1);
    assert.deepEqual(model.attentionRows, []);
  });

  it("keeps coverage server-rendered on the existing structure query", () => {
    const componentSource = readFileSync(
      new URL(
        "../src/components/portfolio/special-holdings-coverage.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/portfolio/structure/page.tsx", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
    assert.match(componentSource, /data-section="special-holdings-coverage"/);
    assert.match(pageSource, /buildPortfolioSpecialHoldingsModel\(structure\)/);
    assert.match(pageSource, /<SpecialHoldingsCoverage/);
    assert.doesNotMatch(componentSource, /legacyBase44Id|assetId|ownerUserId/);
  });
});

function row(model, name) {
  return model.attentionRows.find((candidate) => candidate.name === name);
}

function holding(
  name,
  ticker,
  assetType,
  currentValueKrw,
  currentWeightPct,
  account = "brokerage",
) {
  return {
    name,
    ticker,
    account,
    market: "korea",
    currency: "KRW",
    assetType,
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: 1,
    currentValueKrw,
    currentWeightPct,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "missing_target",
    priceEvidenceSource: "asset_current_price_fallback",
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
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: null,
  };
}
