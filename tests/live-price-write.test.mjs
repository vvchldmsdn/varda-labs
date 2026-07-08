import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIVE_PRICE_WRITE_CONTRACT,
  planLiveAssetPriceWrite,
} from "../src/lib/market-data/live-price-write.ts";

const requestedAt = new Date("2026-07-08T08:00:00.000Z");

function target(overrides = {}) {
  return {
    key: "korea:069500:KRW",
    ticker: "069500",
    market: "korea",
    currency: "KRW",
    accounts: ["brokerage"],
    assetIds: ["asset-1"],
    assetNames: ["KODEX 200"],
    ...overrides,
  };
}

function quote(overrides = {}) {
  return {
    ticker: "069500",
    market: "korea",
    currency: "KRW",
    price: "123710",
    priceAsOf: requestedAt,
    fetchedAt: requestedAt,
    source: "kis_domestic_inquire_price",
    quoteType: "live",
    status: "ok",
    ...overrides,
  };
}

describe("live price write planning", () => {
  it("keeps live price writes scoped to assets and out of snapshots", () => {
    assert.equal(LIVE_PRICE_WRITE_CONTRACT.snapshotWrites, false);
    assert.deepEqual(LIVE_PRICE_WRITE_CONTRACT.inserts, []);
    assert.ok(LIVE_PRICE_WRITE_CONTRACT.updates.includes("assets.current_price"));
    assert.ok(
      LIVE_PRICE_WRITE_CONTRACT.updates.includes("assets.price_fetched_at"),
    );
    assert.ok(
      LIVE_PRICE_WRITE_CONTRACT.updates.every(
        (entry) => !entry.includes("asset_price_snapshots"),
      ),
    );
  });

  it("plans an asset current-price update for a valid KIS live quote", () => {
    const planned = planLiveAssetPriceWrite({
      row: quote(),
      target: target(),
      dryRun: true,
      allowWrite: false,
      writePolicy: "kis",
    });

    assert.equal(planned.result.action, "planned_update");
    assert.deepEqual(planned.result.assetIds, ["asset-1"]);
    assert.equal(planned.update?.currentPrice, "123710");
    assert.equal(planned.update?.priceSource, "kis_domestic_inquire_price");
    assert.equal(planned.update?.priceQuoteType, "live");
  });

  it("rejects live writes from unsupported sources", () => {
    const planned = planLiveAssetPriceWrite({
      row: quote({ source: "manual" }),
      target: target(),
      dryRun: false,
      allowWrite: true,
      writePolicy: "kis",
    });

    assert.equal(planned.result.action, "skipped");
    assert.equal(planned.result.reason, "unsupported_write_source");
    assert.equal(planned.update, null);
  });

  it("keeps actual writes behind the explicit write guard", () => {
    const planned = planLiveAssetPriceWrite({
      row: quote(),
      target: target(),
      dryRun: false,
      allowWrite: false,
      writePolicy: "kis",
    });

    assert.equal(planned.result.action, "skipped");
    assert.equal(planned.result.reason, "write_guard_not_satisfied");
    assert.equal(planned.update, null);
  });
});
