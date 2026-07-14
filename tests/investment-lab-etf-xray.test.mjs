import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabEtfXray,
  selectInvestmentLabEtfXrayMasterIds,
} from "../src/lib/investment-lab-etf-xray.ts";

describe("investment lab ETF X-ray", () => {
  it("keeps mixed ETF dates and uncovered weights explicit without renormalizing", () => {
    const portfolioHoldings = [
      holding("ETF A", "A", "etf", 40),
      holding("ETF B", "B", "etf", 30),
      holding("Direct X", "X", "stock", 10),
      holding("Unmapped service", null, "etf", 5),
      holding("Gold", null, "commodity", 15),
    ];
    const masters = [master("master-a", "A"), master("master-b", "B")];
    const holdingEvidence = [
      evidence("row-a-x", "master-a", "A", "2026-07-01", "X", 50),
      evidence("row-a-y", "master-a", "A", "2026-07-01", "Y", 40),
      evidence(
        "row-a-unmapped",
        "master-a",
        "A",
        "2026-07-01",
        null,
        10,
      ),
      evidence("row-b-x", "master-b", "B", "2026-07-02", "X", 50),
      evidence("row-b-z", "master-b", "B", "2026-07-02", "Z", 50),
    ];

    assert.deepEqual(
      selectInvestmentLabEtfXrayMasterIds({ portfolioHoldings, masters }),
      ["master-a", "master-b"],
    );

    const model = buildInvestmentLabEtfXray({
      portfolioHoldings,
      masters,
      holdingEvidence,
    });

    assert.equal(model.status, "partial");
    assert.equal(model.summary.heldEtfCount, 3);
    assert.equal(model.summary.matchedEtfCount, 2);
    assert.equal(model.summary.missingReferenceCount, 1);
    assert.deepEqual(model.summary.asOfDates, ["2026-07-01", "2026-07-02"]);
    assert.equal(model.summary.mixedAsOfDates, true);
    assert.equal(model.summary.etfPortfolioWeightPct, 75);
    assert.equal(model.summary.observedPortfolioExposurePct, 66);
    assert.equal(model.summary.uncoveredPortfolioExposurePct, 9);

    const etfA = model.etfRows.find((row) => row.ticker === "A");
    assert.equal(etfA.evidenceStatus, "partial");
    assert.equal(etfA.unmappedComponentCount, 1);
    assert.equal(etfA.observedWeightPct, 90);
    assert.equal(etfA.uncoveredWeightPct, 10);

    const x = model.componentRows.find((row) => row.symbol === "X");
    assert.equal(x.portfolioExposurePct, 35);
    assert.equal(x.directPortfolioWeightPct, 10);
    assert.equal(x.throughEtfCount, 2);
    assert.equal(x.hasDirectOverlap, true);
    assert.equal(x.hasMultiEtfOverlap, true);
    assert.equal(model.summary.overlapCount, 1);

    const serialized = JSON.stringify(model);
    assert.doesNotMatch(serialized, /master-a|master-b|row-a|row-b/);
    assert.doesNotMatch(serialized, /legacyBase44Id|etfMasterId|referenceId/);
  });

  it("fails an ETF closed when reported component weights exceed 100 percent", () => {
    const model = buildInvestmentLabEtfXray({
      portfolioHoldings: [holding("ETF A", "A", "etf", 40)],
      masters: [master("master-a", "A")],
      holdingEvidence: [
        evidence("row-x", "master-a", "A", "2026-07-01", "X", 60),
        evidence("row-y", "master-a", "A", "2026-07-01", "Y", 50),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.etfRows[0].evidenceStatus, "invalid_weight_total");
    assert.equal(model.etfRows[0].observedWeightPct, null);
    assert.equal(model.summary.observedPortfolioExposurePct, 0);
    assert.equal(model.summary.uncoveredPortfolioExposurePct, 40);
    assert.equal(model.componentRows.length, 0);
  });

  it("uses each ETF's latest stored evidence and reports a complete common date", () => {
    const model = buildInvestmentLabEtfXray({
      portfolioHoldings: [
        holding("ETF A", "A", "etf", 40),
        holding("ETF B", "B", "etf", 30),
      ],
      masters: [master("master-a", "A"), master("master-b", "B")],
      holdingEvidence: [
        evidence("row-a-old", "master-a", "A", "2026-06-30", "OLD", 100),
        evidence("row-a-new", "master-a", "A", "2026-07-01", "X", 100),
        evidence("row-b-new", "master-b", "B", "2026-07-01", "Y", 100),
      ],
    });

    assert.equal(model.status, "complete_common_date");
    assert.deepEqual(model.summary.asOfDates, ["2026-07-01"]);
    assert.equal(model.summary.uncoveredPortfolioExposurePct, 0);
    assert.deepEqual(
      model.componentRows.map((row) => row.symbol),
      ["X", "Y"],
    );
  });

  it("keeps the production adapter server-only, read-only, and separately suspended", () => {
    const querySource = readFileSync(
      new URL(
        "../src/db/queries/investment-lab-etf-xray.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/investment-lab/page.tsx", import.meta.url),
      "utf8",
    );

    assert.match(querySource, /import "server-only"/);
    assert.doesNotMatch(querySource, /\.(insert|update|delete)\s*\(/);
    assert.doesNotMatch(querySource, /\bfetch\s*\(/);
    assert.match(pageSource, /getReadOnlyInvestmentLabEtfXray\(\)/);
    assert.match(pageSource, /InvestmentLabEtfXraySkeleton/);
    assert.match(pageSource, /InvestmentLabEtfXrayUnavailable/);
  });
});

function holding(name, ticker, assetType, currentWeightPct) {
  return {
    name,
    ticker,
    account: "brokerage",
    market: "us",
    currency: "USD",
    assetType,
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: 1,
    currentValueKrw: currentWeightPct * 1_000,
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

function master(referenceId, ticker) {
  return {
    referenceId,
    ticker,
    name: `ETF ${ticker}`,
    market: "us",
    currency: "USD",
  };
}

function evidence(
  id,
  etfMasterId,
  etfTicker,
  asOfDate,
  holdingSymbol,
  weightPct,
) {
  return {
    id,
    legacyBase44Id: null,
    etfMasterId,
    legacyEtfId: null,
    etfTicker,
    etfName: `ETF ${etfTicker}`,
    asOfDate,
    holdingSymbol,
    holdingName: holdingSymbol ? `Holding ${holdingSymbol}` : "Unknown holding",
    holdingMarket: holdingSymbol ? "us" : null,
    holdingCountry: holdingSymbol ? "US" : null,
    currency: holdingSymbol ? "USD" : null,
    sector: null,
    industry: null,
    securityType: "stock",
    source: "fixture",
    rank: 1,
    weightPct,
    shares: null,
    marketValue: null,
  };
}
