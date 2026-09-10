import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

import {
  analyzePortfolioDirectHoldings,
  buildPortfolioDirectHoldingsBaseline,
} from "../src/lib/portfolio-direct-holdings.ts";

describe("portfolio direct holdings baseline", () => {
  it("shows authorized account names in allocation details and evidence without changing holding identities", async () => {
    const ringEntries = [];
    const ports = {
      "next/link": { default: ({ children, href }) => React.createElement("a", { href }, children) },
      "@/components/portfolio-primary-navigation": { PortfolioPrimaryNavigation: () => null },
      "@/components/portfolio-analysis-scope-tabs": { PortfolioAnalysisScopeTabs: () => null },
      "@/components/presentation/presentation-dialog": { PresentationDialog: ({ children }) => children },
      "@/components/portfolio/direct-holdings-baseline": { DirectHoldingsBaseline: () => null },
      "@/components/portfolio/portfolio-fx-shock": { PortfolioFxShock: () => null },
      "@/components/portfolio/portfolio-structure-risk-analytics": { PortfolioStructureRiskAnalytics: () => null },
      "@/components/portfolio/special-holdings-coverage": { SpecialHoldingsCoverage: () => null },
      "./portfolio-allocation-ring": { PortfolioAllocationRing: ({ entries }) => { ringEntries.push(entries); return null; } },
    };
    const [view, locale] = await importUiWithPorts([
      "src/components/portfolio/portfolio-structure-view.tsx",
      "src/components/i18n/locale-provider.tsx",
    ], ports);
    const accountCode = "acct_3ef012345678";
    const rows = [{ ...holding("Apple", "AAPL", "us", "USD", 350_000, accountCode), currentWeightPct: 100 }];
    const originalRows = structuredClone(rows);
    const accountScope = { kind: "account", key: "account:11111111-1111-4111-8111-111111111111", accountId: "11111111-1111-4111-8111-111111111111", accountCode, label: "My first investments" };
    const data = {
      analysisScopes: [{ kind: "all", key: "all", label: "All assets" }, accountScope],
      selectedScope: { kind: "all", key: "all", label: "All assets" },
      generatedAt: "2026-09-10T07:00:00Z", serviceDate: "2026-09-10",
      structure: { totalValueKrw: 350_000, includedHoldingCount: 1, groupRows: [], holdingRows: rows,
        exclusions: [{ ...exclusion("Waiting for price", "MISSING"), account: accountCode }],
        usdKrwRate: 1340, dataHealth: { missingPriceCount: 1, missingFxCount: 0, unsupportedCurrencyCount: 0 } },
      targetProjection: { status: "missing" }, targetEffectiveServiceDate: null,
      riskModel: { calculation: { portfolio: null }, pathAnalytics: { maximumDrawdownPct: { value: null } } },
    };
    for (const language of ["ko", "en"]) {
      const html = renderToStaticMarkup(React.createElement(locale.LocaleProvider, { initialLocale: language }, React.createElement(view.PortfolioStructureView, { data })));
      const visibleText = html.replace(/<[^>]*>/g, "");
      assert.equal(visibleText.includes(accountCode), false, "internal account code must not be presented as the account name");
      assert.ok(visibleText.split(accountScope.label).length >= 5, "selected detail, expanded detail, holding table and exclusion table all use the authorized name");
      assert.equal(ringEntries.at(-1)[0].key.split("|")[0], accountCode, "visual selection identity still uses the original account code");
      assert.equal(ringEntries.at(-1)[0].weightPct, 100);
    }
    assert.deepEqual(rows, originalRows);
  });

  it("groups exact identities and calculates concentration and currency exposure", () => {
    const model = buildPortfolioDirectHoldingsBaseline({
      selectedAccount: "brokerage",
      holdingRows: [
        holding("KODEX 200", "069500", "korea", "KRW", 500_000),
        holding("KODEX 200 lot 2", "069500", "korea", "KRW", 100_000),
        holding("VOO", "VOO", "us", "USD", 300_000),
        holding("QQQ", "QQQ", "us", "USD", 100_000),
      ],
      exclusions: [],
    });

    assert.equal(model.status, "complete");
    assert.equal(model.inputHoldingCount, 4);
    assert.equal(model.resolvedInputHoldingCount, 4);
    assert.equal(model.directHoldingCount, 3);
    assert.equal(model.metrics.totalValueKrw, 1_000_000);
    assert.equal(model.metrics.largestHoldingWeightPct, 60);
    assert.equal(model.metrics.topThreeWeightPct, 100);
    assertClose(model.metrics.hhiPoints, 4600);
    assertClose(model.metrics.effectiveHoldingCount, 1 / 0.46);
    assert.equal(model.largestHolding.ticker, "069500");
    assert.deepEqual(model.metrics.currencyExposures, [
      {
        currency: "KRW",
        holdingCount: 1,
        currentValueKrw: 600_000,
        currentWeightPct: 60,
      },
      {
        currency: "USD",
        holdingCount: 2,
        currentValueKrw: 400_000,
        currentWeightPct: 40,
      },
    ]);
  });

  it("keeps account-scoped adjustment identities separate", () => {
    const analysis = analyzePortfolioDirectHoldings([
      holding("Asset A", "SAME", "korea", "KRW", 100),
      holding("Asset B", "SAME", "us", "USD", 200),
      holding("Asset C", "SAME", "us", "USD", 300, "isa"),
    ]);

    assert.equal(analysis.holdings.length, 3);
    assert.equal(new Set(analysis.holdings.map((row) => row.key)).size, 3);
  });

  it("merges the same economic exposure across accounts in the all baseline", () => {
    const rows = [
      holding("Asset A brokerage", "SAME", "korea", "KRW", 60),
      holding("Asset A ISA", "SAME", "korea", "KRW", 40, "isa"),
      holding("Asset B", "OTHER", "korea", "KRW", 100),
      holding("US SAME", "SAME", "us", "USD", 50),
    ];
    const model = buildPortfolioDirectHoldingsBaseline({
      selectedAccount: "all",
      holdingRows: rows,
      exclusions: [],
    });
    const analysis = analyzePortfolioDirectHoldings(rows, {
      identityScope: "cross_account_exposure",
    });

    assert.equal(model.status, "complete");
    assert.equal(model.directHoldingCount, 3);
    assert.equal(
      model.metrics.currencyExposures.find((row) => row.currency === "KRW")
        .currentValueKrw,
      200,
    );
    const koreaSame = analysis.holdings.find(
      (row) => row.market === "korea" && row.ticker === "SAME",
    );
    assert.equal(koreaSame.currentValueKrw, 100);
    assert.equal(koreaSame.account, "all");
    assertClose(model.metrics.hhiPoints, 3600);
    assertClose(model.metrics.effectiveHoldingCount, 1 / 0.36);
  });

  it("shows partial metrics without treating unresolved identity as a holding", () => {
    const model = buildPortfolioDirectHoldingsBaseline({
      selectedAccount: "brokerage",
      holdingRows: [
        holding("KODEX 200", "069500", "korea", "KRW", 600_000),
        holding("VOO", "VOO", "us", "USD", 400_000),
        holding("Tickerless", null, "korea", "KRW", 10_000),
        holding("Unknown FX", "UNKNOWN-FX", "us", "UNKNOWN", 10_000),
        holding("Missing market", "NO-MARKET", "", "KRW", 10_000),
      ],
      exclusions: [exclusion("Missing price", "MISSING")],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.directHoldingCount, 2);
    assert.equal(model.unresolvedIdentityCount, 3);
    assert.equal(model.excludedHoldingCount, 1);
    assert.equal(model.metrics.totalValueKrw, 1_000_000);
    assert.doesNotMatch(
      JSON.stringify(model.metrics),
      /Tickerless|Unknown FX|Missing market/,
    );
  });

  it("is unavailable when no exact valued holding remains", () => {
    const model = buildPortfolioDirectHoldingsBaseline({
      selectedAccount: "brokerage",
      holdingRows: [holding("Tickerless", null, "korea", "KRW", 10_000)],
      exclusions: [],
    });

    assert.equal(model.status, "unavailable");
    assert.equal(model.metrics, null);
    assert.equal(model.unresolvedIdentityCount, 1);
  });

  it("keeps the baseline server-rendered on the existing structure read", () => {
    const componentSource = readFileSync(
      new URL(
        "../src/components/portfolio/direct-holdings-baseline.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/portfolio/structure/page.tsx", import.meta.url),
      "utf8",
    );
    const viewSource = readFileSync(
      new URL(
        "../src/components/portfolio/portfolio-structure-view.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    assert.doesNotMatch(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(/);
    assert.match(componentSource, /data-section="direct-holdings-baseline"/);
    assert.match(pageSource, /buildPortfolioDirectHoldingsBaseline\(structure\)/);
    assert.match(viewSource, /<DirectHoldingsBaseline/);
  });
});

function holding(
  name,
  ticker,
  market,
  currency,
  currentValueKrw,
  account = "brokerage",
) {
  return {
    name,
    ticker,
    account,
    market,
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

function exclusion(name, ticker) {
  return {
    reason: "missing_price",
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

function assertClose(actual, expected, tolerance = 1e-8) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}
