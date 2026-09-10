import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS,
  selectSnapshotCutoffQuote,
  selectSnapshotCutoffValuation,
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
    priceAsOf: new Date("2026-08-23T21:59:00.000Z"),
    fetchedAt: new Date("2026-08-23T21:59:01.000Z"),
    ...overrides,
  };
}

describe("snapshot cutoff valuation quote selection", () => {
  it("selects the latest fresh KIS quote for the exact instrument", () => {
    const selected = selectSnapshotCutoffQuote({
      instrument,
      capturedAt: new Date("2026-08-23T22:05:00.000Z"),
      cycleEndAt: new Date("2026-08-23T22:00:00.000Z"),
      rows: [
        quote({ id: "older", fetchedAt: new Date("2026-08-23T21:58:00.000Z") }),
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
    const cycleEndAt = new Date("2026-08-23T22:00:00.000Z");
    const staleFetchedAt = new Date(
      cycleEndAt.getTime() - SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS - 1,
    );
    const rows = [
      quote({ id: "stale", fetchedAt: staleFetchedAt }),
      quote({ id: "future", fetchedAt: new Date("2026-08-23T22:05:01.000Z") }),
      quote({ id: "failed", status: "failed" }),
      quote({ id: "other-provider", provider: "fixture" }),
      quote({ id: "close", quoteType: "close" }),
      quote({ id: "invalid-source-time", priceAsOf: "invalid" }),
    ];

    assert.equal(selectSnapshotCutoffQuote({ instrument, capturedAt, cycleEndAt, rows }), null);
  });

  it("does not add weekend or market-session behavior to price selection", () => {
    const saturday = new Date("2026-08-22T22:05:00.000Z");
    const selected = selectSnapshotCutoffQuote({
      instrument,
      capturedAt: saturday,
      cycleEndAt: new Date("2026-08-22T22:00:00.000Z"),
      rows: [
        quote({
          fetchedAt: new Date("2026-08-22T21:59:00.000Z"),
          priceAsOf: new Date("2026-08-22T21:59:00.000Z"),
        }),
      ],
    });

    assert.equal(selected?.price, 703.71);
  });

  it("does not let an 08:43 or intraday retry redefine the 07:00 cutoff", () => {
    const cycleEndAt = new Date("2026-09-09T22:00:00.000Z");
    const preCutoff = quote({
      id: "observed-before-cutoff",
      priceAsOf: new Date("2026-09-09T21:59:00.000Z"),
      fetchedAt: new Date("2026-09-09T21:59:00.000Z"),
    });
    const postCutoff = quote({
      id: "fresh-but-after-cutoff", price: "900",
      priceAsOf: new Date("2026-09-09T23:42:00.000Z"),
      fetchedAt: new Date("2026-09-09T23:42:00.000Z"),
    });
    for (const capturedAt of [
      new Date("2026-09-09T23:43:00.000Z"),
      new Date("2026-09-10T03:00:00.000Z"),
    ]) {
      const selected = selectSnapshotCutoffQuote({
        instrument, capturedAt, cycleEndAt, rows: [postCutoff, preCutoff],
      });
      assert.equal(selected?.row.id, "observed-before-cutoff");
      assert.equal(selected?.ageMs, 60_000);
      assert.equal(selectSnapshotCutoffQuote({
        instrument, capturedAt, cycleEndAt, rows: [postCutoff],
      }), null);
    }
  });

  it("requires both fetch and price evidence timestamps to be at or before cutoff", () => {
    const cycleEndAt = new Date("2026-08-23T22:00:00.000Z");
    const capturedAt = new Date("2026-08-23T23:00:00.000Z");
    for (const overrides of [
      { fetchedAt: new Date("2026-08-23T22:00:00.001Z") },
      { priceAsOf: new Date("2026-08-23T22:00:00.001Z") },
    ]) {
      assert.equal(selectSnapshotCutoffQuote({
        instrument, capturedAt, cycleEndAt, rows: [quote(overrides)],
      }), null);
    }
    const boundary = selectSnapshotCutoffQuote({
      instrument, capturedAt, cycleEndAt,
      rows: [quote({ fetchedAt: cycleEndAt, priceAsOf: cycleEndAt })],
    });
    assert.equal(boundary?.ageMs, 0);
  });

  it("uses the exact official close when no pre-cutoff quote was retained", () => {
    const cycleEndAt = new Date("2026-09-09T22:00:00.000Z");
    const capturedAt = new Date("2026-09-10T03:00:00.000Z");
    const officialClose = {
      price: 700, referenceDate: "2026-09-09", expectedCloseDate: "2026-09-09",
      fromCloseSnapshot: true,
    };
    const input = {
      instrument, capturedAt, cycleEndAt, officialClose,
      rows: [quote({ price: "900", fetchedAt: capturedAt, priceAsOf: capturedAt })],
    };
    const selected = selectSnapshotCutoffValuation(input);
    assert.equal(selected?.basis, "close");
    assert.equal(selected?.close.price, 700);
    for (const change of [
      { referenceDate: "2026-09-08" },
      { referenceDate: "2026-09-10", expectedCloseDate: "2026-09-10" },
      { fromCloseSnapshot: false },
      { price: 0 },
    ]) {
      assert.equal(selectSnapshotCutoffValuation({
        ...input, officialClose: { ...officialClose, ...change },
      }), null);
    }
  });

  it("rejects a capture before the requested cutoff and invalid clock inputs", () => {
    const cycleEndAt = new Date("2026-08-23T22:00:00.000Z");
    for (const capturedAt of [new Date("invalid"), new Date("2026-08-23T21:59:59.000Z")]) {
      assert.equal(selectSnapshotCutoffQuote({
        instrument, capturedAt, cycleEndAt, rows: [quote()],
      }), null);
    }
    assert.equal(selectSnapshotCutoffQuote({
      instrument, capturedAt: cycleEndAt, cycleEndAt: new Date("invalid"), rows: [quote()],
    }), null);
  });
});
