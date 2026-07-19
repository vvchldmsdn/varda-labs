import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  MANUAL_ASSET_PRICE_POLICY,
  buildManualAssetPriceUpdate,
} from "../src/lib/market-data/manual-asset-price.ts";

describe("manual asset price", () => {
  it("records a forward-only manual valuation with explicit provenance", () => {
    const recordedAt = new Date("2026-07-19T02:03:04.000Z");
    const update = buildManualAssetPriceUpdate({
      currentPrice: "192000.0000",
      recordedAt,
    });

    assert.deepEqual(MANUAL_ASSET_PRICE_POLICY, {
      version: "manual_asset_price_v1",
      source: "manual_entry",
      quoteType: "manual_valuation",
      status: "stored_manual",
      carryPolicy: "retain_until_next_manual_update",
      historyPolicy: "forward_only_no_backcast",
    });
    assert.deepEqual(update, {
      currentPrice: "192000.0000",
      priceSource: "manual_entry",
      priceFetchedAt: null,
      priceAsOf: recordedAt,
      priceQuoteType: "manual_valuation",
      priceStatus: "stored_manual",
      priceError: null,
    });
    assert.notEqual(update.priceAsOf, recordedAt);
    assert.ok(Object.isFrozen(update));
  });

  it("rejects an invalid manual valuation timestamp", () => {
    assert.throws(
      () =>
        buildManualAssetPriceUpdate({
          currentPrice: "192000",
          recordedAt: new Date("invalid"),
        }),
      /recordedAt must be a valid Date/,
    );
  });

  it("keeps the current CRUD boundary admin-protected", () => {
    const routeSource = readFileSync(
      new URL("../src/app/api/entities/assets/[id]/route.ts", import.meta.url),
      "utf8",
    );

    assert.match(routeSource, /requireAdminJob\(request\)/);
    assert.match(routeSource, /buildManualAssetPriceUpdate/);
    assert.doesNotMatch(routeSource, /FSC_PUBLIC_DATA_SERVICE_KEY/);
  });
});
