import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  groupPriceRowsByInstrument,
  isSamePriceInstrument,
  normalizePriceInstrumentIdentity,
  priceRowsForInstrument,
} from "../src/lib/market-data/price-instrument-identity.ts";

describe("price instrument identity", () => {
  it("normalizes the composite market, currency, and ticker identity", () => {
    assert.deepEqual(
      normalizePriceInstrumentIdentity({
        market: " US ",
        currency: " usd ",
        ticker: " qqq ",
      }),
      {
        market: "us",
        currency: "USD",
        ticker: "QQQ",
      },
    );
  });

  it("keeps same-ticker rows from different markets in separate groups", () => {
    const korea = {
      market: "korea",
      currency: "KRW",
      ticker: "069500",
      closePrice: 100,
    };
    const us = {
      market: "us",
      currency: "USD",
      ticker: "069500",
      closePrice: 500,
    };
    const grouped = groupPriceRowsByInstrument([us, korea]);

    assert.deepEqual(priceRowsForInstrument(grouped, korea), [korea]);
    assert.deepEqual(priceRowsForInstrument(grouped, us), [us]);
    assert.equal(isSamePriceInstrument(korea, us), false);
  });

  it("uses the composite DB condition in snapshot and dashboard consumers", () => {
    const condition = readFileSync(
      "src/db/queries/asset-price-snapshot-scope.ts",
      "utf8",
    );
    const daily = readFileSync("src/lib/snapshots/daily.ts", "utf8");
    const dashboard = readFileSync("src/lib/portfolio-dashboard.ts", "utf8");
    const adminStatusQuery = readFileSync(
      "src/db/queries/admin-market-sync-status.ts",
      "utf8",
    );

    assert.match(condition, /assetPriceSnapshots\.market/);
    assert.match(condition, /assetPriceSnapshots\.currency/);
    assert.match(condition, /assetPriceSnapshots\.ticker/);
    assert.match(daily, /assetPriceSnapshotInstrumentCondition\(instruments\)/);
    assert.match(
      dashboard,
      /assetPriceSnapshotInstrumentCondition\(priceInstruments\)/,
    );
    assert.match(
      adminStatusQuery,
      /assetPriceSnapshotInstrumentCondition\(targetAssets\)/,
    );
    assert.doesNotMatch(
      daily,
      /inArray\(assetPriceSnapshots\.ticker/,
    );
    assert.doesNotMatch(
      dashboard,
      /inArray\(assetPriceSnapshots\.ticker/,
    );
    assert.doesNotMatch(
      adminStatusQuery,
      /inArray\(assetPriceSnapshots\.ticker/,
    );
  });
});
