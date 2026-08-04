import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  admitAdjustedHistoricalPriceRows,
  admitPrivateSingleTenantRawHistoricalPriceRows,
  admitRawHistoricalPriceRows,
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
      ASSET_PRICE_CONSUMER_ADMISSION_POLICY.adjustedHistoricalReturn
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

  it("fails raw historical analysis closed even with complete row metadata", () => {
    const result = admitRawHistoricalPriceRows([
      providerRow({
        source: "kis_overseas_dailyprice:AMS",
        fetchedAt: "2026-07-10T00:00:00.000Z",
      }),
    ]);

    assert.equal(result.policy.priceField, "close_price");
    assert.equal(result.policy.consumerRights, "not_admitted");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.summary, {
      suppliedRowCount: 1,
      admittedRowCount: 0,
      excludedRowCount: 1,
      admittedInstrumentCount: 0,
      excludedInstrumentCount: 1,
    });
    assert.deepEqual(result.issues, [
      "raw_history_consumer_rights_not_admitted",
    ]);
  });

  it("admits complete KIS raw rows only for the matching sole active owner", () => {
    const ownerUserId = "11111111-1111-4111-8111-111111111111";
    const result = admitPrivateSingleTenantRawHistoricalPriceRows({
      requestedOwnerUserId: ownerUserId,
      activeOwnerUserIds: [ownerUserId],
      rows: [
        providerRow({
          adjustedClosePrice: null,
          adjustedCloseBasis: null,
          adjustedCloseProvider: null,
          adjustedCloseSource: null,
          adjustedCloseFetchedAt: null,
          source: "kis_domestic_dailyitemchartprice",
          fetchedAt: "2026-07-10T00:00:00.000Z",
        }),
      ],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.policy.priceBasis, "raw_price_return");
    assert.equal(result.policy.corporateActionAdjustment, "not_claimed");
    assert.equal(result.summary.admittedRowCount, 1);
    assert.deepEqual(result.issues, []);
  });

  it("fails private raw history closed when another active owner exists", () => {
    const result = admitPrivateSingleTenantRawHistoricalPriceRows({
      requestedOwnerUserId: "11111111-1111-4111-8111-111111111111",
      activeOwnerUserIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
      rows: [providerRow()],
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.issues, [
      "private_single_tenant_scope_not_established",
    ]);
  });

  it("rejects incomplete or non-KIS private raw provenance", () => {
    const ownerUserId = "11111111-1111-4111-8111-111111111111";
    const result = admitPrivateSingleTenantRawHistoricalPriceRows({
      requestedOwnerUserId: ownerUserId,
      activeOwnerUserIds: [ownerUserId],
      rows: [
        providerRow({
          closePrice: null,
          source: "legacy_import",
          providerSymbol: null,
          providerExchange: null,
          fetchedAt: null,
        }),
      ],
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.issues, [
      "fetched_at_invalid",
      "provider_exchange_missing",
      "provider_symbol_missing",
      "raw_close_missing",
      "raw_source_not_kis",
    ]);
  });

  it("does not let stale adjusted metadata admit a newer KIS raw close", () => {
    const result = admitRawHistoricalPriceRows([
      providerRow({
        closePrice: 99,
        adjustedClosePrice: 101,
        adjustedCloseProvider: "older_adjusted_provider",
        adjustedCloseSource: "older_adjusted_history",
        adjustedCloseFetchedAt: "2026-07-09T00:00:00.000Z",
        source: "kis_overseas_dailyprice:AMS",
        fetchedAt: "2026-07-10T00:00:00.000Z",
      }),
    ]);

    assert.equal(result.summary.admittedRowCount, 0);
    assert.deepEqual(result.issues, [
      "raw_history_consumer_rights_not_admitted",
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
    const adjustedHistoricalAdapters = [
      "src/db/queries/simulation-return-matrix.ts",
      "src/db/queries/portfolio-risk.ts",
    ].map((path) => readFileSync(path, "utf8"));
    const investmentLabAdapter = readFileSync(
      "src/db/queries/investment-lab.ts",
      "utf8",
    );
    const operationalConsumers = [
      "src/lib/portfolio-movement.ts",
      "src/lib/snapshots/daily.ts",
    ].map((path) => readFileSync(path, "utf8"));

    for (const source of adjustedHistoricalAdapters) {
      assert.match(source, /admitAdjustedHistoricalPriceRows/);
      assert.match(source, /adjustedCloseBasis/);
      assert.match(source, /adjustedCloseProvider/);
      assert.match(source, /adjustedCloseFetchedAt/);
      assert.match(source, /providerSymbol/);
      assert.match(source, /providerExchange/);
    }
    assert.equal(
      investmentLabAdapter.match(/admitAdjustedHistoricalPriceRows/g)
        ?.length,
      2,
      "investment lab KODEX history must use adjusted admission",
    );
    assert.equal(
      investmentLabAdapter.match(/admitRawHistoricalPriceRows/g)?.length,
      3,
      "investment lab VOO and anchor history must use raw admission",
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
    fetchedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}
