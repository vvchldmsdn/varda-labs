import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  admitAdjustedHistoricalPriceRows,
  ASSET_PRICE_CONSUMER_ADMISSION_POLICY,
  resolveOperationalClosePrice,
} from "../src/lib/market-data/asset-price-consumer-admission.ts";

describe("asset price consumer admission", () => {
  it("uses raw close for operational valuation even when adjusted close differs", () => {
    assert.equal(
      resolveOperationalClosePrice({
        closePrice: 120,
        adjustedClosePrice: 80,
      }),
      120,
    );
    assert.equal(
      resolveOperationalClosePrice({
        closePrice: null,
        adjustedClosePrice: 80,
      }),
      null,
    );
  });

  it("admits only provider-adjusted rows with complete provenance", () => {
    const result = admitAdjustedHistoricalPriceRows([
      providerRow({ priceDate: "2026-07-09", adjustedClosePrice: 100 }),
      providerRow({ priceDate: "2026-07-10", adjustedClosePrice: 101 }),
      providerRow({
        ticker: "QQQ",
        market: "us",
        currency: "USD",
        adjustedCloseBasis: "legacy_unverified",
      }),
      providerRow({
        ticker: "VOO",
        market: "us",
        currency: "USD",
        adjustedClosePrice: null,
        adjustedCloseBasis: null,
        adjustedCloseProvider: null,
        adjustedCloseSource: null,
        adjustedCloseFetchedAt: null,
        providerSymbol: null,
        providerExchange: null,
        source: "kis_overseas_dailyprice",
      }),
    ]);

    assert.equal(
      result.policy.adjustedCloseBasis,
      ASSET_PRICE_CONSUMER_ADMISSION_POLICY.historicalReturn
        .adjustedCloseBasis,
    );
    assert.deepEqual(
      result.rows.map((row) => row.priceDate),
      ["2026-07-09", "2026-07-10"],
    );
    assert.equal(result.summary.suppliedRowCount, 4);
    assert.equal(result.summary.admittedRowCount, 2);
    assert.equal(result.summary.excludedRowCount, 2);
    assert.deepEqual(result.issues, [
      "adjusted_close_basis_ineligible",
      "adjusted_close_fetched_at_invalid",
      "adjusted_close_missing",
      "adjusted_close_provider_missing",
      "adjusted_close_source_missing",
      "provider_exchange_missing",
      "provider_symbol_missing",
    ]);
  });

  it("fails closed when one instrument has conflicting provider bindings", () => {
    const result = admitAdjustedHistoricalPriceRows([
      providerRow({ priceDate: "2026-07-09" }),
      providerRow({
        priceDate: "2026-07-10",
        providerSymbol: "069500.KO",
      }),
      providerRow({
        market: "us",
        currency: "USD",
        ticker: "069500",
        priceDate: "2026-07-10",
        providerSymbol: "069500.US",
        providerExchange: "US",
      }),
    ]);

    assert.deepEqual(
      result.rows.map((row) => `${row.market}|${row.currency}|${row.ticker}`),
      ["us|USD|069500"],
    );
    assert.equal(result.summary.admittedInstrumentCount, 1);
    assert.equal(result.summary.excludedInstrumentCount, 1);
    assert.deepEqual(result.issues, ["conflicting_provider_binding"]);
  });

  it("excludes malformed identity rows without inventing an instrument", () => {
    const result = admitAdjustedHistoricalPriceRows([
      providerRow({ market: "" }),
      providerRow({ currency: "" }),
      providerRow(),
    ]);

    assert.equal(result.summary.suppliedRowCount, 3);
    assert.equal(result.summary.admittedRowCount, 1);
    assert.equal(result.summary.excludedRowCount, 2);
    assert.equal(result.summary.admittedInstrumentCount, 1);
    assert.equal(result.summary.excludedInstrumentCount, 0);
    assert.deepEqual(result.issues, ["invalid_instrument_identity"]);
  });

  it("keeps operational and historical consumers on their explicit boundaries", () => {
    const historicalAdapters = [
      "src/db/queries/simulation-return-matrix.ts",
      "src/db/queries/investment-lab.ts",
      "src/db/queries/portfolio-risk.ts",
    ].map((path) => readFileSync(path, "utf8"));
    const operationalConsumers = [
      "src/lib/portfolio-movement.ts",
      "src/lib/snapshots/daily.ts",
    ].map((path) => readFileSync(path, "utf8"));

    for (const source of historicalAdapters) {
      assert.match(source, /admitAdjustedHistoricalPriceRows/);
      assert.match(source, /adjustedCloseBasis/);
      assert.match(source, /adjustedCloseProvider/);
      assert.match(source, /adjustedCloseFetchedAt/);
      assert.match(source, /providerSymbol/);
      assert.match(source, /providerExchange/);
    }
    assert.ok(
      historicalAdapters[1].match(/admitAdjustedHistoricalPriceRows/g)
        ?.length >= 2,
      "investment lab scenario and anchor history must both use admission",
    );
    for (const source of operationalConsumers) {
      assert.match(source, /resolveOperationalClosePrice/);
    }
  });
});

function providerRow(overrides = {}) {
  return {
    market: "korea",
    currency: "KRW",
    ticker: "069500",
    priceDate: "2026-07-09",
    closePrice: 100,
    adjustedClosePrice: 100,
    adjustedCloseBasis: "provider_adjusted_close_v1",
    adjustedCloseProvider: "fixture_provider",
    adjustedCloseSource: "fixture_provider_adjusted_history",
    adjustedCloseFetchedAt: "2026-07-10T00:00:00.000Z",
    providerSymbol: "069500",
    providerExchange: "KRX",
    source: "fixture",
    ...overrides,
  };
}
