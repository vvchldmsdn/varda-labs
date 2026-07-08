import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCycleForSnapshotDate,
  closeCalendarReferenceDateForAsset,
  closeMarketKeyForAsset,
  isUsdListedAsset,
  resolveSnapshotCycle,
} from "../src/lib/snapshots/market-calendar.ts";

describe("market calendar", () => {
  it("uses the KST 07:00 cutoff for the daily snapshot date", () => {
    assert.equal(
      resolveSnapshotCycle(new Date("2026-07-06T21:59:00.000Z")).snapshotDate,
      "2026-07-06",
    );
    assert.equal(
      resolveSnapshotCycle(new Date("2026-07-06T22:00:00.000Z")).snapshotDate,
      "2026-07-07",
    );
  });

  it("builds the snapshot cycle window ending at the previous UTC 22:00", () => {
    const cycle = buildCycleForSnapshotDate(
      "2026-07-07",
      new Date("2026-07-07T00:30:00.000Z"),
    );

    assert.equal(cycle.snapshotDate, "2026-07-07");
    assert.equal(cycle.cycleEndAt.toISOString(), "2026-07-06T22:00:00.000Z");
    assert.equal(cycle.cycleStartAt.toISOString(), "2026-07-05T22:00:00.000Z");
  });

  it("backs up across Korean lunar holidays and weekends", () => {
    assert.equal(
      closeCalendarReferenceDateForAsset(
        { market: "korea", currency: "KRW" },
        "2026-02-19",
      ),
      "2026-02-13",
    );
  });

  it("backs up across US market holidays", () => {
    assert.equal(
      closeCalendarReferenceDateForAsset(
        { market: "us", currency: "USD" },
        "2026-04-04",
      ),
      "2026-04-02",
    );
  });

  it("uses the previous trading day for the 2026-07-08 snapshot cycle", () => {
    assert.equal(
      closeCalendarReferenceDateForAsset(
        { market: "korea", currency: "KRW" },
        "2026-07-08",
      ),
      "2026-07-07",
    );
    assert.equal(
      closeCalendarReferenceDateForAsset(
        { market: "us", currency: "USD" },
        "2026-07-08",
      ),
      "2026-07-07",
    );
  });

  it("treats USD-denominated assets as US-listed for close coverage", () => {
    const asset = { market: "korea", currency: "USD" };

    assert.equal(isUsdListedAsset(asset), true);
    assert.equal(closeMarketKeyForAsset(asset), "us");
    assert.equal(
      closeCalendarReferenceDateForAsset(asset, "2026-07-05"),
      "2026-07-02",
    );
  });
});
