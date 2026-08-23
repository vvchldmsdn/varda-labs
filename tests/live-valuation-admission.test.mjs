import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSessionAwareValuationPrice,
  shouldAdmitLiveLocalPrice,
} from "../src/lib/market-data/live-valuation-admission.ts";
import { calculateFxAwareSnapshotMovementKrw } from "../src/lib/portfolio-math.ts";

const korea = { market: "korea", currency: "KRW" };
const us = { market: "us", currency: "USD" };

describe("live valuation admission", () => {
  it("keeps local prices closed throughout a weekend service cycle", () => {
    const liveWindowStartAt = new Date("2026-08-22T22:00:00.000Z");

    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: korea,
        evaluatedAt: new Date("2026-08-23T08:00:00.000Z"),
        liveWindowStartAt,
      }),
      false,
    );
    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: us,
        evaluatedAt: new Date("2026-08-23T08:00:00.000Z"),
        liveWindowStartAt,
      }),
      false,
    );
  });

  it("admits Korean prices from the regular-session open", () => {
    const liveWindowStartAt = new Date("2026-08-23T22:00:00.000Z");

    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: korea,
        evaluatedAt: new Date("2026-08-23T23:59:00.000Z"),
        liveWindowStartAt,
      }),
      false,
    );
    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: korea,
        evaluatedAt: new Date("2026-08-24T00:00:00.000Z"),
        liveWindowStartAt,
      }),
      true,
    );
  });

  it("uses the New York clock for the US regular-session open", () => {
    const liveWindowStartAt = new Date("2026-08-23T22:00:00.000Z");

    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: us,
        evaluatedAt: new Date("2026-08-24T13:29:00.000Z"),
        liveWindowStartAt,
      }),
      false,
    );
    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: us,
        evaluatedAt: new Date("2026-08-24T13:30:00.000Z"),
        liveWindowStartAt,
      }),
      true,
    );
  });

  it("does not admit prices on a market holiday", () => {
    assert.equal(
      shouldAdmitLiveLocalPrice({
        asset: us,
        evaluatedAt: new Date("2026-09-07T15:00:00.000Z"),
        liveWindowStartAt: new Date("2026-09-06T22:00:00.000Z"),
      }),
      false,
    );
  });

  it("uses the baseline snapshot price while the market is closed", () => {
    const asset = {
      id: "asset-1",
      legacyBase44Id: "legacy-1",
      account: "brokerage",
      ticker: "VOO",
      name: "Vanguard S&P 500 ETF",
      currentPrice: "686.10",
      ...us,
    };
    const baselinePositions = [
      {
        account: "brokerage",
        assetId: "asset-1",
        legacyAssetId: "legacy-1",
        ticker: "VOO",
        assetName: "Vanguard S&P 500 ETF",
        unitPrice: "687.03",
        closePrice: null,
        currentPrice: null,
        capturedAt: new Date("2026-08-22T22:03:00.000Z"),
      },
    ];

    assert.deepEqual(
      resolveSessionAwareValuationPrice({
        asset,
        baselinePositions,
        evaluatedAt: new Date("2026-08-23T08:00:00.000Z"),
        liveWindowStartAt: new Date("2026-08-22T22:00:00.000Z"),
      }),
      {
        price: 687.03,
        basis: "market_closed_snapshot",
        basisAsOf: new Date("2026-08-22T22:03:00.000Z"),
      },
    );
  });

  it("keeps the current price when no matching baseline exists", () => {
    assert.deepEqual(
      resolveSessionAwareValuationPrice({
        asset: {
          id: "asset-1",
          legacyBase44Id: null,
          account: "brokerage",
          ticker: "VOO",
          name: "Vanguard S&P 500 ETF",
          currentPrice: "686.10",
          ...us,
        },
        baselinePositions: [],
        evaluatedAt: new Date("2026-08-23T08:00:00.000Z"),
        liveWindowStartAt: new Date("2026-08-22T22:00:00.000Z"),
      }),
      { price: 686.1, basis: "current", basisAsOf: null },
    );
  });

  it("attributes a weekend valuation change entirely to FX", () => {
    const quantity = 10;
    const previousPrice = 100;
    const previousFxRate = 1_380;
    const currentFxRate = 1_400;
    const admitted = resolveSessionAwareValuationPrice({
      asset: {
        id: "asset-1",
        legacyBase44Id: null,
        account: "brokerage",
        ticker: "VOO",
        name: "Vanguard S&P 500 ETF",
        currentPrice: "99.50",
        ...us,
      },
      baselinePositions: [
        {
          account: "brokerage",
          assetId: "asset-1",
          legacyAssetId: null,
          ticker: "VOO",
          assetName: "Vanguard S&P 500 ETF",
          unitPrice: String(previousPrice),
          closePrice: null,
          currentPrice: null,
          capturedAt: new Date("2026-08-22T22:03:00.000Z"),
        },
      ],
      evaluatedAt: new Date("2026-08-23T08:00:00.000Z"),
      liveWindowStartAt: new Date("2026-08-22T22:00:00.000Z"),
    });
    const movement = calculateFxAwareSnapshotMovementKrw({
      quantity,
      currentPrice: admitted.price,
      currentValueKrw: quantity * admitted.price * currentFxRate,
      previousPrice,
      previousValueKrw: quantity * previousPrice * previousFxRate,
      currentFxRate,
      previousFxRate,
    });

    assert.equal(admitted.basis, "market_closed_snapshot");
    assert.equal(movement.changeKrw, 20_000);
    assert.equal(movement.priceChangeKrw, 0);
    assert.equal(movement.fxChangeKrw, movement.changeKrw);
  });
});
