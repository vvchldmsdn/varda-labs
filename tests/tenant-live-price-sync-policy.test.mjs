import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeTenantLivePriceTarget,
  planTenantLivePriceSync,
  TENANT_LIVE_PRICE_SYNC_POLICY,
} from "../src/lib/market-data/tenant-live-price-sync-policy.ts";

const now = new Date("2026-08-23T03:00:00.000Z");

describe("tenant live price sync policy", () => {
  it("normalizes an exact shared-cache instrument identity", () => {
    assert.deepEqual(
      normalizeTenantLivePriceTarget({
        ticker: " voo ",
        market: " US ",
        currency: " USD ",
      }),
      { ticker: "VOO", market: "us", currency: "usd" },
    );
    assert.equal(
      normalizeTenantLivePriceTarget({
        ticker: " ",
        market: "us",
        currency: "USD",
      }),
      null,
    );
  });

  it("deduplicates targets and requests only missing, stale, or invalid quotes", () => {
    const result = planTenantLivePriceSync({
      now,
      targets: [
        target("069500", "korea", "KRW"),
        target("069500", "KOREA", "krw"),
        target("VOO", "us", "USD"),
        target("QQQ", "us", "USD"),
        target("SCHD", "us", "USD"),
      ],
      quotes: [
        quote("069500", "korea", "KRW", "2026-08-23T02:54:00.000Z"),
        quote("069500", "korea", "KRW", "2026-08-23T02:57:00.000Z"),
        quote("VOO", "us", "USD", "2026-08-23T02:54:59.000Z"),
        quote("QQQ", "us", "USD", "2026-08-23T02:59:00.000Z", {
          status: "error",
        }),
        quote("SCHD", "us", "USD", "2026-08-23T02:59:00.000Z", {
          price: "0",
        }),
      ],
    });

    assert.equal(TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds, 300_000);
    assert.equal(result.targets.length, 4);
    assert.equal(result.freshTargetCount, 1);
    assert.equal(result.staleTargetCount, 3);
    assert.deepEqual(
      result.staleTargets.map((row) => row.ticker),
      ["QQQ", "SCHD", "VOO"],
    );
  });

  it("does not accept a quote timestamp materially ahead of the server clock", () => {
    const result = planTenantLivePriceSync({
      now,
      targets: [target("VOO", "us", "USD")],
      quotes: [quote("VOO", "us", "USD", "2026-08-23T03:01:01.000Z")],
    });

    assert.equal(result.freshTargetCount, 0);
    assert.equal(result.staleTargetCount, 1);
  });
});

function target(ticker, market, currency) {
  return { ticker, market, currency };
}

function quote(ticker, market, currency, fetchedAt, overrides = {}) {
  return {
    ticker,
    market,
    currency,
    provider: "kis",
    status: "ok",
    price: "100",
    fetchedAt,
    ...overrides,
  };
}
