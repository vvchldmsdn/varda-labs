import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS,
  selectSnapshotCutoffQuote,
} from "../src/lib/snapshots/cutoff-valuation.ts";

const instrument = {
  market: "us",
  currency: "USD",
  ticker: "VOO",
};

function quote(overrides = {}) {
  return {
    id: "quote-1",
    ...instrument,
    provider: "kis",
    source: "kis_overseas_price:AMS",
    quoteType: "live",
    status: "ok",
    price: "703.71",
    priceAsOf: new Date("2026-08-23T22:04:00.000Z"),
    fetchedAt: new Date("2026-08-23T22:04:01.000Z"),
    ...overrides,
  };
}

describe("snapshot cutoff valuation quote selection", () => {
  it("selects the latest fresh KIS quote for the exact instrument", () => {
    const selected = selectSnapshotCutoffQuote({
      instrument,
      capturedAt: new Date("2026-08-23T22:05:00.000Z"),
      rows: [
        quote({ id: "older", fetchedAt: new Date("2026-08-23T22:03:00.000Z") }),
        quote({ id: "latest" }),
        quote({ id: "other", ticker: "QQQ", price: "713.44" }),
      ],
    });

    assert.equal(selected?.row.id, "latest");
    assert.equal(selected?.price, 703.71);
    assert.equal(selected?.ageMs, 59_000);
  });

  it("rejects stale, future, failed, non-KIS, and non-live rows", () => {
    const capturedAt = new Date("2026-08-23T22:05:00.000Z");
    const staleFetchedAt = new Date(
      capturedAt.getTime() - SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS - 1,
    );
    const rows = [
      quote({ id: "stale", fetchedAt: staleFetchedAt }),
      quote({ id: "future", fetchedAt: new Date("2026-08-23T22:05:01.000Z") }),
      quote({ id: "failed", status: "failed" }),
      quote({ id: "other-provider", provider: "fixture" }),
      quote({ id: "close", quoteType: "close" }),
    ];

    assert.equal(selectSnapshotCutoffQuote({ instrument, capturedAt, rows }), null);
  });

  it("does not add weekend or market-session behavior to price selection", () => {
    const saturday = new Date("2026-08-22T22:05:00.000Z");
    const selected = selectSnapshotCutoffQuote({
      instrument,
      capturedAt: saturday,
      rows: [
        quote({
          fetchedAt: new Date("2026-08-22T22:04:00.000Z"),
          priceAsOf: new Date("2026-08-22T22:04:00.000Z"),
        }),
      ],
    });

    assert.equal(selected?.price, 703.71);
  });
});
