import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  summarizeCloseCoverageStatus,
  summarizeLivePriceStatus,
} from "../src/lib/admin-market-sync-status.ts";

const cycle = {
  snapshotDate: "2026-07-08",
  liveWindowStartAt: new Date("2026-07-07T22:00:00.000Z"),
  liveWindowEndAt: new Date("2026-07-08T22:00:00.000Z"),
};

const baseAssets = [
  {
    id: "asset-kr",
    name: "KODEX 200",
    ticker: "069500",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    priceQuoteType: "live",
    priceStatus: "ok",
    priceFetchedAt: "2026-07-08T01:00:00.000Z",
    priceAsOf: null,
  },
  {
    id: "asset-us",
    name: "VOO",
    ticker: "VOO",
    account: "brokerage",
    market: "us",
    currency: "USD",
    assetType: "etf",
    priceQuoteType: "live",
    priceStatus: "ok",
    priceFetchedAt: "2026-07-08T03:00:00.000Z",
    priceAsOf: null,
  },
  {
    id: "cash",
    name: "Cash",
    ticker: null,
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    assetType: "cash",
    priceQuoteType: null,
    priceStatus: null,
    priceFetchedAt: null,
    priceAsOf: null,
  },
];

describe("admin market sync status helpers", () => {
  it("summarizes live price freshness without calling providers", () => {
    const liveQuotes = [
      {
        ticker: "069500",
        market: "korea",
        currency: "KRW",
        quoteType: "live",
        status: "ok",
        fetchedAt: "2026-07-08T01:00:00.000Z",
        priceAsOf: null,
      },
      {
        ticker: "VOO",
        market: "us",
        currency: "USD",
        quoteType: "live",
        status: "ok",
        fetchedAt: "2026-07-08T03:00:00.000Z",
        priceAsOf: null,
      },
      {
        ticker: "QQQ",
        market: "us",
        currency: "USD",
        quoteType: "live",
        status: "ok",
        fetchedAt: "2026-07-07T10:00:00.000Z",
        priceAsOf: null,
      },
    ];
    const summary = summarizeLivePriceStatus(
      [
        ...baseAssets,
        {
          ...baseAssets[1],
          id: "asset-stale",
          ticker: "QQQ",
          name: "QQQ",
          priceFetchedAt: "2026-07-07T10:00:00.000Z",
        },
      ],
      liveQuotes,
      cycle,
    );

    assert.equal(summary.targetCount, 3);
    assert.equal(summary.freshCount, 2);
    assert.equal(summary.staleOrMissingCount, 1);
    assert.deepEqual(
      summary.staleOrMissingTargets.map((target) => target.ticker),
      ["QQQ"],
    );
  });

  it("summarizes close coverage from stored rows only", () => {
    const summary = summarizeCloseCoverageStatus(
      baseAssets,
      [
        {
          ticker: "069500",
          priceDate: "2026-07-07",
          source: "kis",
          updatedAt: "2026-07-08T01:00:00.000Z",
        },
        {
          ticker: "VOO",
          priceDate: "2026-07-03",
          source: "kis_overseas_dailyprice",
          updatedAt: "2026-07-08T01:00:00.000Z",
        },
      ],
      "2026-07-08",
    );

    assert.equal(summary.targetCount, 2);
    assert.equal(summary.coveredCount, 1);
    assert.equal(summary.staleOrMissingCount, 1);
    assert.deepEqual(summary.gaps, [
      {
        ticker: "VOO",
        name: "VOO",
        account: "brokerage",
        market: "us",
        currency: "USD",
        expectedCloseDate: "2026-07-07",
        selectedCloseDate: "2026-07-03",
        source: "kis_overseas_dailyprice",
        status: "stale",
      },
    ]);
  });
});
