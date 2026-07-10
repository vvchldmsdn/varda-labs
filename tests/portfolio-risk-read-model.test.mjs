import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadPortfolioRiskReadModel,
  normalizePortfolioRiskAccount,
  normalizePortfolioRiskWindow,
} from "../src/lib/portfolio-risk-read-loader.ts";
import { composePortfolioRiskReadModel } from "../src/lib/portfolio-risk-read-model.ts";
import {
  fxRow,
  portfolioRiskReadModelFixture,
} from "./fixtures/portfolio-risk-read-model.mjs";

describe("portfolio risk read model", () => {
  it("normalizes URL-style account and window selections", () => {
    assert.equal(normalizePortfolioRiskAccount(["ISA", "all"]), "isa");
    assert.equal(normalizePortfolioRiskAccount("unknown"), "brokerage");
    assert.equal(normalizePortfolioRiskWindow(["252", "30"]), 252);
    assert.equal(normalizePortfolioRiskWindow("31"), 90);
  });

  it("composes a complete safe model with calculation order as matrix order", () => {
    const result = composePortfolioRiskReadModel(
      portfolioRiskReadModelFixture(),
    );
    const instrumentKeys = result.calculation.instruments.map(
      (instrument) => instrument.instrumentKey,
    );

    assert.equal(result.inputHealth.status, "ready");
    assert.equal(result.calculation.calculationStatus, "complete");
    assert.equal(result.provenance.usableReturnObservations, 30);
    assert.deepEqual(instrumentKeys, ["korea|KRW|069500", "us|USD|VOO"]);
    assert.equal(
      result.calculation.portfolio?.correlationMatrix.length,
      instrumentKeys.length,
    );
    assert.ok(
      result.calculation.portfolio?.correlationMatrix.every(
        (row) => row.length === instrumentKeys.length,
      ),
    );

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /legacyBase44Id|holdingId|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i,
    );
    assert.doesNotMatch(
      serialized,
      /api[_-]?key|authorization|password|secret|token/i,
    );
  });

  it("filters holdings by account before instrument aggregation and weights", () => {
    const baselineFixture = portfolioRiskReadModelFixture();
    const baseline = composePortfolioRiskReadModel(baselineFixture);
    const filteredFixture = portfolioRiskReadModelFixture();
    filteredFixture.assetRows.push({
      ...filteredFixture.assetRows[0],
      account: "isa",
      quantity: "1000",
    });

    const filtered = composePortfolioRiskReadModel(filteredFixture);

    assert.equal(filtered.provenance.selectedHoldingCount, 2);
    assert.deepEqual(
      filtered.calculation.instruments.map((instrument) => instrument.weight),
      baseline.calculation.instruments.map((instrument) => instrument.weight),
    );
  });

  it("removes sample and failed-source rows before duplicate checks", () => {
    const fixture = portfolioRiskReadModelFixture();
    const duplicatedPrice = fixture.priceRows[0];
    const duplicatedFx = fixture.fxRows[0];
    fixture.priceRows.push({
      ...duplicatedPrice,
      source: "sample_price",
      isSample: true,
    });
    fixture.fxRows.push({
      ...duplicatedFx,
      source: "sample_fx",
      isSample: true,
    });
    fixture.fxRows.push({
      ...duplicatedFx,
      source: "failed_fx",
      status: "empty",
    });

    const result = composePortfolioRiskReadModel(fixture);

    assert.equal(result.inputHealth.status, "ready");
    assert.equal(result.inputHealth.sourceRows.price.sampleExcluded, 1);
    assert.equal(result.inputHealth.sourceRows.fx.sampleExcluded, 1);
    assert.equal(result.inputHealth.sourceRows.fx.invalidStatusExcluded, 1);
    assert.deepEqual(result.inputHealth.sourceRows.fx.sources, {
      fixture_fx: 31,
    });
  });

  it("blocks approved FX duplicates in the selected evidence range", () => {
    const fixture = portfolioRiskReadModelFixture();
    fixture.fxRows.push(
      fxRow({ rateDate: "2026-07-08", usdKrw: 1320.3 }),
    );

    const result = composePortfolioRiskReadModel(fixture);

    assert.equal(result.inputHealth.status, "blocked");
    assert.deepEqual(result.inputHealth.blockers, [
      { reason: "duplicate_fx_date", dates: ["2026-07-08"] },
    ]);
    assert.equal(result.calculation.portfolio, null);
  });

  it("preserves undefined correlation values and reasons", () => {
    const result = composePortfolioRiskReadModel(
      portfolioRiskReadModelFixture({ constantKrwPrice: true }),
    );

    assert.equal(result.calculation.portfolio?.correlationMatrix[0][0], null);
    assert.equal(result.calculation.portfolio?.correlationMatrix[0][1], null);
    assert.equal(
      result.calculation.portfolio?.weightedAverageCorrelation.reason,
      "undefined_pair_correlation",
    );
    assert.deepEqual(result.calculation.dataHealth.zeroVarianceInstruments, [
      "korea|KRW|069500",
    ]);
  });

  it("loads assets first, then starts bounded price and FX reads in parallel", async () => {
    const fixture = portfolioRiskReadModelFixture();
    const calls = [];
    let resolvePrices;
    let resolveFxRates;
    const repository = {
      async loadAssets(account) {
        calls.push(["assets", account]);
        return fixture.assetRows;
      },
      loadPrices(options) {
        calls.push(["prices", options]);
        return new Promise((resolve) => {
          resolvePrices = resolve;
        });
      },
      loadFxRates(options) {
        calls.push(["fx", options]);
        return new Promise((resolve) => {
          resolveFxRates = resolve;
        });
      },
    };

    const pending = loadPortfolioRiskReadModel(repository, {
      account: "all",
      window: "30",
      now: new Date("2026-07-10T00:00:00Z"),
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls.map(([name]) => name), ["assets", "prices", "fx"]);
    assert.deepEqual(calls[1][1].tickers, ["069500", "VOO"]);
    assert.equal(calls[1][1].sourceDateTo, "2026-07-09");
    assert.deepEqual(calls[2][1], {
      sourceDateFrom: "2026-03-23",
      sourceDateTo: "2026-07-09",
    });
    assert.equal(calls[1][1].sourceDateFrom, "2026-03-26");

    resolvePrices(fixture.priceRows);
    resolveFxRates(fixture.fxRows);
    const result = await pending;

    assert.deepEqual(result.selection, { account: "all", window: 30 });
    assert.equal(result.inputHealth.status, "ready");
  });
});
