import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeTodayHoldingDetailQuery,
  selectTodayHoldingDetail,
  todayHoldingDetailHref,
} from "../src/lib/today-holding-detail.ts";

function holding(overrides = {}) {
  return {
    id: "asset-kr",
    legacyBase44Id: "legacy-kr",
    name: "KODEX 200",
    ticker: "069500",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    quantity: 10,
    currentPrice: 95,
    valueKrw: 950,
    priceSource: "kis_domestic_inquire_price",
    priceFetchedAt: "2026-07-09T01:00:00.000Z",
    priceAsOf: null,
    priceQuoteType: "live",
    priceStatus: "ok",
    dailyChangeKrw: -50,
    dailyReturnPct: -5,
    dailySource: "daily_position_snapshot",
    previousCloseValueKrw: 1000,
    fxDailyChangeKrw: 0,
    ...overrides,
  };
}

function contribution(overrides = {}) {
  return {
    holdingId: "asset-kr",
    previousValueKrw: 1000,
    changeKrw: -50,
    returnPct: -5,
    tradeFlowKrw: 0,
    fxChangeKrw: 0,
    source: "daily_position_snapshot",
    ...overrides,
  };
}

function exclusion(overrides = {}) {
  return {
    subject: "holding",
    reason: "missing_fresh_live_prices",
    source: "daily_position_snapshot",
    holdingId: "asset-kr",
    snapshotId: null,
    ticker: "069500",
    assetName: "KODEX 200",
    account: "brokerage",
    currency: "KRW",
    valueKrw: 950,
    ...overrides,
  };
}

function dashboard(overrides = {}) {
  return {
    selectedAccount: "brokerage",
    holdings: [holding()],
    todayMovement: {
      contributionRows: [contribution()],
      exclusions: [],
    },
    ...overrides,
  };
}

function assertNoInternalIds(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("asset-kr"), false);
  assert.equal(serialized.includes("asset-us"), false);
  assert.equal(serialized.includes("legacy-kr"), false);
  assert.equal(serialized.includes("legacy-us"), false);
  assert.equal(serialized.includes("holdingId"), false);
  assert.equal(serialized.includes("legacyBase44Id"), false);
}

describe("today holding detail selector", () => {
  it("normalizes ticker and market query values", () => {
    assert.deepEqual(
      normalizeTodayHoldingDetailQuery({
        ticker: [" voo "],
        market: " US ",
      }),
      { ticker: "VOO", market: "us" },
    );
  });

  it("selects a contribution row without exposing internal ids", () => {
    const result = selectTodayHoldingDetail(dashboard(), {
      ticker: "069500",
      market: "korea",
    });

    assert.equal(result.status, "selected");
    assert.equal(result.holding.ticker, "069500");
    assert.equal(result.holding.name, "KODEX 200");
    assert.equal(result.contribution?.changeKrw, -50);
    assert.equal(result.contribution?.source, "daily_position_snapshot");
    assert.deepEqual(result.exclusions, []);
    assertNoInternalIds(result);
  });

  it("selects matching exclusion evidence for an excluded holding", () => {
    const result = selectTodayHoldingDetail(
      dashboard({
        todayMovement: {
          contributionRows: [],
          exclusions: [exclusion()],
        },
      }),
      { ticker: "069500", market: "korea" },
    );

    assert.equal(result.status, "selected");
    assert.equal(result.contribution, null);
    assert.equal(result.exclusions.length, 1);
    assert.equal(result.exclusions[0].reason, "missing_fresh_live_prices");
    assert.equal(result.exclusions[0].ticker, "069500");
    assertNoInternalIds(result);
  });

  it("returns not found when no current holding matches", () => {
    const result = selectTodayHoldingDetail(dashboard(), {
      ticker: "VOO",
      market: "us",
    });

    assert.equal(result.status, "not_found");
    assert.deepEqual(result.query, { ticker: "VOO", market: "us" });
    assertNoInternalIds(result);
  });

  it("requires account disambiguation for duplicate tickers under all accounts", () => {
    const result = selectTodayHoldingDetail(
      dashboard({
        selectedAccount: "all",
        holdings: [
          holding(),
          holding({
            id: "asset-kr-isa",
            legacyBase44Id: "legacy-kr-isa",
            account: "isa",
            valueKrw: 900,
          }),
        ],
      }),
      { ticker: "069500", market: "korea" },
    );

    assert.equal(result.status, "ambiguous");
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.account).sort(),
      ["brokerage", "isa"],
    );
    assertNoInternalIds(result);
  });

  it("builds detail links from account, ticker, and market only", () => {
    assert.equal(
      todayHoldingDetailHref("brokerage", holding()),
      "/today?ticker=069500&market=korea",
    );
    assert.equal(
      todayHoldingDetailHref(
        "all",
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          ticker: "voo",
          market: "us",
        }),
      ),
      "/today?account=all&ticker=VOO&market=us",
    );
  });
});
