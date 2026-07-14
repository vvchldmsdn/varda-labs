import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildPortfolioDirectHoldingsBaseline } from "../src/lib/portfolio-direct-holdings.ts";
import {
  calculatePortfolioFxShock,
  PORTFOLIO_FX_SHOCK_POLICY,
} from "../src/lib/portfolio-fx-shock.ts";

describe("portfolio direct USD FX shock", () => {
  it("holds local prices fixed and shocks only explicit USD direct exposure", () => {
    const result = calculatePortfolioFxShock({
      baseline: baseline([
        holding("KODEX 200", "069500", "korea", "KRW", 600_000),
        holding("VOO", "VOO", "us", "USD", 300_000),
        holding("QQQ", "QQQ", "us", "USD", 100_000),
      ]),
      currentUsdKrwRate: 1_500,
      shockPct: 10,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.policy.version, "static_usdkrw_direct_holdings_shock_v1");
    assert.equal(result.evaluatedSubsetValueKrw, 1_000_000);
    assert.equal(result.usdDirectExposureValueKrw, 400_000);
    assert.equal(result.usdDirectExposureWeightPct, 40);
    assert.equal(result.appliedAssetCount, 2);
    assert.equal(result.estimatedChangeKrw, 40_000);
    assert.equal(result.estimatedChangePctPoints, 4);
    assert.equal(result.estimatedPostShockSubsetValueKrw, 1_040_000);
    assertClose(result.estimatedUsdKrwRate, 1_650);
  });

  it("keeps negative shocks signed and does not reinterpret them as return forecasts", () => {
    const result = calculatePortfolioFxShock({
      baseline: baseline([
        holding("KRW", "KRW", "korea", "KRW", 750_000),
        holding("USD", "USD", "us", "USD", 250_000),
      ]),
      currentUsdKrwRate: 1_500,
      shockPct: -8,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.estimatedChangeKrw, -20_000);
    assert.equal(result.estimatedChangePctPoints, -2);
    assert.equal(result.estimatedPostShockSubsetValueKrw, 980_000);
    assert.equal(result.estimatedUsdKrwRate, 1_380);
  });

  it("returns partial evidence without normalizing away excluded rows", () => {
    const model = baseline(
      [holding("VOO", "VOO", "us", "USD", 400_000)],
      [exclusion("Missing price", "MISSING")],
    );
    const result = calculatePortfolioFxShock({
      baseline: model,
      currentUsdKrwRate: 1_500,
      shockPct: 5,
    });

    assert.equal(model.status, "partial");
    assert.equal(result.status, "ready");
    assert.equal(result.coverageStatus, "partial");
    assert.equal(result.evaluatedSubsetValueKrw, 400_000);
    assert.equal(result.excludedEvidenceCount, 1);
    assert.equal(result.estimatedChangeKrw, 20_000);
  });

  it("reports no observed USD exposure as unavailable instead of a zero impact", () => {
    const result = calculatePortfolioFxShock({
      baseline: baseline([
        holding("KODEX 200", "069500", "korea", "KRW", 1_000_000),
      ]),
      currentUsdKrwRate: 1_500,
      shockPct: 5,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "no_observed_usd_direct_exposure");
    assert.equal(result.appliedAssetCount, 0);
    assert.equal(result.estimatedChangeKrw, null);
    assert.equal(result.estimatedChangePctPoints, null);
    assert.equal(result.estimatedPostShockSubsetValueKrw, null);
  });

  it("blocks invalid shock and FX inputs without materializing scenario output", () => {
    const model = baseline([
      holding("VOO", "VOO", "us", "USD", 400_000),
    ]);
    const invalidShock = calculatePortfolioFxShock({
      baseline: model,
      currentUsdKrwRate: 1_500,
      shockPct: PORTFOLIO_FX_SHOCK_POLICY.maxShockPct + 1,
    });
    const invalidFx = calculatePortfolioFxShock({
      baseline: model,
      currentUsdKrwRate: null,
      shockPct: 5,
    });

    assert.equal(invalidShock.status, "blocked");
    assert.equal(invalidShock.reason, "invalid_shock_pct");
    assert.equal(invalidShock.estimatedChangeKrw, null);
    assert.equal(invalidShock.estimatedPostShockSubsetValueKrw, null);
    assert.equal(invalidFx.status, "blocked");
    assert.equal(invalidFx.reason, "invalid_current_usd_krw_rate");
    assert.equal(invalidFx.estimatedChangeKrw, null);
  });

  it("keeps data reads on the Server Component and only local input in the client", () => {
    const calculatorSource = readFileSync(
      new URL("../src/lib/portfolio-fx-shock.ts", import.meta.url),
      "utf8",
    );
    const componentSource = readFileSync(
      new URL(
        "../src/components/portfolio/portfolio-fx-shock.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/portfolio/structure/page.tsx", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(calculatorSource, /@\/db|\bfetch\s*\(|DATABASE_URL/);
    assert.match(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(|\/api\//);
    assert.match(componentSource, /data-section="portfolio-fx-shock"/);
    assert.match(pageSource, /<PortfolioFxShock/);
    assert.match(pageSource, /currentUsdKrwRate=\{structure\.usdKrwRate\}/);
  });
});

function baseline(holdingRows, exclusions = []) {
  return buildPortfolioDirectHoldingsBaseline({
    selectedAccount: "brokerage",
    holdingRows,
    exclusions,
  });
}

function holding(name, ticker, market, currency, currentValueKrw) {
  return {
    name,
    ticker,
    account: "brokerage",
    market,
    currency,
    currentValueKrw,
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
  };
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}
