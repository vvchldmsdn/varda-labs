import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHoldingPriceReturn } from "../src/lib/holding-price-return.ts";
import { currentKstDate } from "../src/lib/current-kst-date.ts";
import { resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

const now = new Date("2026-09-08T15:20:00Z"); // September 9, 00:20 KST; September 8 in New York.
const movementCycle = { snapshotDate: "2026-09-08", liveWindowStartAt: new Date("2026-09-07T22:00:00Z"), liveWindowEndAt: new Date("2026-09-08T22:00:00Z") };
const holding = { id: "asset-a", legacyBase44Id: null, name: "Actual holding name", ticker: "QQQ", market: "us", currency: "USD", account: "brokerage", assetType: "etf", quantity: 15,
  currentPrice: 103, valueKrw: 2_163_000, priceQuoteType: "live", priceStatus: "ok", priceAsOf: "2026-09-08T15:19:00Z", priceFetchedAt: "2026-09-08T15:19:30Z" };
const close = { market: "us", currency: "USD", ticker: "QQQ", priceDate: "2026-09-04", closePrice: "100", adjustedClosePrice: "98", closePriceKrw: "140000", fxRate: "1400" };
const calculate = (overrides = {}) => buildHoldingPriceReturn({ holding, priceRows: [close], movementCycle, now, ...overrides });

describe("native unit-price return for today's heatmap", () => {
  it("shows a 3% price move independently of holding size, trade flows, weight and FX", () => {
    const result = calculate();
    assert.equal(result.changePct, 3);
    assert.equal(result.previousClose, 100, "raw close, not adjusted total-return close");
    assert.equal(result.previousCloseDate, "2026-09-04");
    assert.equal(result.observedAt, "2026-09-08T15:19:00.000Z");
    assert.equal(result.currency, "USD");
    assert.deepEqual(calculate({ holding: { ...holding, quantity: 0.4, valueKrw: 17, dailyReturnPct: -25, tradeFlowKrw: 1_000_000, fxRate: 2000, currentWeight: 90 } }), result);
    assert.equal(holding.name, "Actual holding name");
  });

  it("uses the quote's market calendar date rather than KST and ignores wrong-instrument or same-day closes", () => {
    const priceRows = [close, { ...close, priceDate: "2026-09-08", closePrice: "103" }, { ...close, priceDate: "2026-09-07", market: "korea", closePrice: "95" }, { ...close, priceDate: "2026-09-07", currency: "KRW", closePrice: "96" }, { ...close, ticker: "OTHER", priceDate: "2026-09-07", closePrice: "97" }];
    const result = calculate({ priceRows });
    assert.equal(result.previousCloseDate, "2026-09-04");
    assert.equal(result.changePct, 3);
  });

  it("shows a natural zero on unchanged quotes without any weekday or holiday substitution", () => {
    const weekendNow = new Date("2026-09-06T02:00:00Z");
    const result = calculate({ now: weekendNow, holding: { ...holding, currentPrice: 100, priceAsOf: weekendNow.toISOString(), priceFetchedAt: weekendNow.toISOString() },
      movementCycle: { snapshotDate: "2026-09-06", liveWindowStartAt: new Date("2026-09-05T22:00:00Z"), liveWindowEndAt: new Date("2026-09-06T22:00:00Z") } });
    assert.equal(result.changePct, 0);
    assert.equal(result.previousCloseDate, "2026-09-04");
  });

  it("does not let a fresh fetch relabel an old market observation as today's price", () => {
    const stale = calculate({ holding: { ...holding, priceAsOf: "2026-09-01T15:00:00Z", priceFetchedAt: now.toISOString() }, priceRows: [{ ...close, priceDate: "2026-09-08", closePrice: 110 }] });
    assert.equal(stale.changePct, null);
    assert.equal(stale.reason, "missing_current_quote");
    assert.equal(stale.observedAt, "2026-09-01T15:00:00.000Z");
  });

  it("keeps unsupported, stale, future or missing quotes missing instead of using saved portfolio returns", () => {
    for (const changes of [{ currentPrice: 0 }, { priceStatus: "error" }, { priceQuoteType: "close" }, { priceAsOf: null, priceFetchedAt: null }, { priceAsOf: "invalid" }, { priceAsOf: "2026-09-09T15:20:00Z" }, { priceAsOf: "2026-09-07T15:20:00Z" }]) {
      const result = calculate({ holding: { ...holding, dailyReturnPct: 0, ...changes } });
      assert.equal(result.changePct, null, JSON.stringify(changes));
      assert.equal(result.reason, "missing_current_quote");
    }
  });

  it("fails closed on absent, adjusted-only, invalid, expired or conflicting previous closes", () => {
    for (const priceRows of [[], [{ ...close, closePrice: null }], [{ ...close, closePrice: "0" }], [{ ...close, priceDate: "2026-08-20" }], [{ ...close, priceDate: "2026-09-31" }]]) {
      const result = calculate({ priceRows });
      assert.equal(result.changePct, null);
      assert.equal(result.reason, "missing_previous_close");
    }
    const result = calculate({ priceRows: [close, { ...close, closePrice: "101" }] });
    assert.equal(result.changePct, null);
    assert.equal(result.reason, "conflicting_previous_close");
  });

  it("keeps today's KST display date independent from the unchanged 07:00 snapshot cutoff", () => {
    assert.equal(currentKstDate(now), "2026-09-09");
    assert.equal(resolveSnapshotCycle(now).snapshotDate, "2026-09-08");
    assert.equal(currentKstDate(new Date("2026-09-08T14:59:59Z")), "2026-09-08");
    assert.equal(currentKstDate(new Date("2026-09-08T22:00:00Z")), "2026-09-09");
  });
});
