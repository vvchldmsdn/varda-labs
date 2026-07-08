import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDailyPositionMovement,
  buildPreviousCloseMovement,
  hasFreshMovementPrice,
} from "../src/lib/portfolio-movement.ts";

const movementCycle = {
  snapshotDate: "2026-07-08",
  liveWindowStartAt: new Date("2026-07-07T22:00:00.000Z"),
  liveWindowEndAt: new Date("2026-07-08T22:00:00.000Z"),
};

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function holding(overrides = {}) {
  return {
    id: "asset-kr",
    legacyBase44Id: "legacy-kr",
    name: "KODEX 200",
    ticker: "069500",
    account: "brokerage",
    currency: "KRW",
    quantity: 10,
    currentPrice: 95,
    valueKrw: 950,
    priceFetchedAt: "2026-07-08T01:00:00.000Z",
    priceAsOf: null,
    priceQuoteType: "live",
    priceStatus: "ok",
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    id: "snap-kr",
    account: "brokerage",
    assetId: "asset-kr",
    legacyAssetId: "legacy-kr",
    ticker: "069500",
    assetName: "KODEX 200",
    assetType: "etf",
    marketValueKrw: 1000,
    unitPrice: 100,
    closePrice: null,
    currentPrice: null,
    fxRate: null,
    previousFxRate: null,
    ...overrides,
  };
}

function tradeEvent(overrides = {}) {
  return {
    eventDate: "2026-07-08",
    eventType: "buy",
    account: "brokerage",
    assetId: "asset-kr",
    legacyAssetId: "legacy-kr",
    ticker: "069500",
    assetName: "KODEX 200",
    amountKrw: 200,
    beforeValue: {},
    afterValue: {},
    ...overrides,
  };
}

function buildDaily(overrides = {}) {
  return buildDailyPositionMovement({
    holdings: [holding()],
    positionRows: [position()],
    eventRows: [],
    selectedAccount: "brokerage",
    baselineDate: "2026-07-07",
    usdKrwRate: 1516.89994,
    movementCycle,
    ...overrides,
  });
}

describe("portfolio movement builder", () => {
  it("computes KRW snapshot movement from fresh current prices", () => {
    const result = buildDaily();
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.source, "daily_position_snapshot");
    assert.equal(result.previousTotalKrw, 1000);
    assert.equal(result.changeKrw, -50);
    assert.equal(result.fxChangeKrw, 0);
    assert.equal(result.coverage.currentCoveragePct, 100);
    assert.equal(result.coverage.snapshotCoveragePct, 100);
    assert.equal(contribution?.changeKrw, -50);
    assert.equal(contribution?.fxChangeKrw, 0);
  });

  it("separates USD FX-only movement from unchanged prices", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 100,
          valueKrw: 1_516_899.94,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: 1531.722979,
        }),
      ],
    });
    const contribution = result.contributions.get("asset-us");

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, -14_823.039);
    assertClose(result.fxChangeKrw, -14_823.039);
    assertClose(contribution?.changeKrw, -14_823.039);
    assertClose(contribution?.fxChangeKrw, -14_823.039);
  });

  it("keeps USD price and FX movement in one aggregate path", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 105,
          valueKrw: 1_592_744.937,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: 1531.722979,
        }),
      ],
    });
    const contribution = result.contributions.get("asset-us");

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, 61_021.958);
    assertClose(result.fxChangeKrw, -15_564.19095);
    assertClose(contribution?.changeKrw, 61_021.958);
    assertClose(contribution?.fxChangeKrw, -15_564.19095);
  });

  it("subtracts post-baseline trade flow from holding movement", () => {
    const result = buildDaily({
      holdings: [holding({ currentPrice: 120, valueKrw: 1200 })],
      eventRows: [tradeEvent({ amountKrw: 200 })],
    });
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.changeKrw, 0);
    assert.equal(contribution?.tradeFlowKrw, 200);
    assert.equal(contribution?.changeKrw, 0);
  });

  it("excludes stale current prices from snapshot movement coverage", () => {
    const result = buildDaily({
      holdings: [
        holding({
          priceFetchedAt: "2026-07-07T21:59:59.000Z",
        }),
      ],
    });

    assert.equal(hasFreshMovementPrice(holding(), movementCycle), true);
    assert.equal(
      hasFreshMovementPrice(
        holding({ priceFetchedAt: "2026-07-07T21:59:59.000Z" }),
        movementCycle,
      ),
      false,
    );
    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.contributions.size, 0);
    assert.equal(result.coverage.currentCoveragePct, 0);
  });

  it("excludes unsupported currency instead of treating it as KRW", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-jpy",
          legacyBase44Id: "legacy-jpy",
          name: "Japan ETF",
          ticker: "JPETF",
          currency: "JPY",
        }),
      ],
      positionRows: [
        position({
          id: "snap-jpy",
          assetId: "asset-jpy",
          legacyAssetId: "legacy-jpy",
          ticker: "JPETF",
          assetName: "Japan ETF",
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.contributions.size, 0);
    assert.equal(result.changeKrw, null);
  });

  it("does not render missing baseline FX as a clean zero contribution", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 100,
          valueKrw: 1_516_899.94,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: null,
          previousFxRate: null,
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.fxChangeKrw, null);
    assert.equal(result.contributions.has("asset-us"), false);
  });

  it("accounts for removed baseline positions in aggregate movement", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-a",
          legacyBase44Id: "legacy-a",
          name: "Asset A",
          ticker: "A",
          currentPrice: 95,
          valueKrw: 950,
        }),
        holding({
          id: "asset-b",
          legacyBase44Id: "legacy-b",
          name: "Asset B",
          ticker: "B",
          currentPrice: 195,
          valueKrw: 1950,
        }),
      ],
      positionRows: [
        position({
          id: "snap-a",
          assetId: "asset-a",
          legacyAssetId: "legacy-a",
          ticker: "A",
          assetName: "Asset A",
          marketValueKrw: 1000,
          unitPrice: 100,
        }),
        position({
          id: "snap-b",
          assetId: "asset-b",
          legacyAssetId: "legacy-b",
          ticker: "B",
          assetName: "Asset B",
          marketValueKrw: 2000,
          unitPrice: 200,
        }),
        position({
          id: "snap-removed",
          assetId: null,
          legacyAssetId: "legacy-removed",
          ticker: "OLD",
          assetName: "Removed ETF",
          marketValueKrw: 100,
          unitPrice: 100,
        }),
      ],
    });
    const contributionSum = [...result.contributions.values()].reduce(
      (sum, contribution) => sum + contribution.changeKrw,
      0,
    );

    assert.equal(result.ready, true);
    assert.equal(contributionSum, -100);
    assert.equal(result.previousTotalKrw, 3100);
    assert.equal(result.changeKrw, -200);
  });

  it("computes previous-close fallback movement without snapshot rows", () => {
    const result = buildPreviousCloseMovement({
      holdings: [holding()],
      priceRows: [
        {
          ticker: "069500",
          priceDate: "2026-07-07",
          adjustedClosePrice: 100,
          closePrice: 100,
          closePriceKrw: 100,
          fxRate: null,
        },
      ],
      referenceDate: "2026-07-08",
      usdKrwRate: 1516.89994,
      movementCycle,
    });
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.source, "asset_price_snapshot");
    assert.equal(result.previousTotalKrw, 1000);
    assert.equal(result.changeKrw, -50);
    assert.equal(contribution?.source, "asset_price_snapshot");
  });
});
