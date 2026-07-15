import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  KRX_GOLD_CLOSE_CYCLE_POLICY,
  resolveKrxGoldCloseCycle,
} from "../src/lib/krx-gold-close-cycle.ts";
import { resolveSnapshotCycle } from "../src/lib/snapshots/market-calendar.ts";

describe("KRX gold close service-cycle mapping", () => {
  it("maps a trading-date close into the actual next 07:00 KST cycle", () => {
    const snapshotDate = resolveSnapshotCycle(
      new Date("2026-07-09T22:00:00.000Z"),
    ).snapshotDate;
    const result = resolveKrxGoldCloseCycle({
      snapshotDate,
      priceDate: "2026-07-09",
    });

    assert.equal(snapshotDate, "2026-07-10");
    assert.deepEqual(result, {
      status: "usable",
      reason: "first_eligible_cycle",
      snapshotDate: "2026-07-10",
      expectedCloseDate: "2026-07-09",
      observationDate: "2026-07-09",
      firstEligibleServiceDate: "2026-07-10",
      carryCalendarDays: 0,
      createsSyntheticObservation: false,
    });
  });

  it("does not admit the new close before the 07:00 KST cutoff", () => {
    const snapshotDate = resolveSnapshotCycle(
      new Date("2026-07-09T21:59:00.000Z"),
    ).snapshotDate;
    const result = resolveKrxGoldCloseCycle({
      snapshotDate,
      priceDate: "2026-07-09",
    });

    assert.equal(snapshotDate, "2026-07-09");
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "future_close");
    assert.equal(result.expectedCloseDate, "2026-07-08");
  });

  it("carries Friday close across weekend cycles without changing its date", () => {
    const saturday = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-11",
      priceDate: "2026-07-10",
    });
    const sunday = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-12",
      priceDate: "2026-07-10",
    });
    const mondayBeforeOpen = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-13",
      priceDate: "2026-07-10",
    });

    assert.equal(saturday.reason, "first_eligible_cycle");
    assert.equal(saturday.carryCalendarDays, 0);
    assert.equal(sunday.reason, "non_trading_cycle_carry");
    assert.equal(sunday.carryCalendarDays, 1);
    assert.equal(mondayBeforeOpen.reason, "non_trading_cycle_carry");
    assert.equal(mondayBeforeOpen.carryCalendarDays, 2);
    assert.equal(mondayBeforeOpen.observationDate, "2026-07-10");
    assert.equal(mondayBeforeOpen.expectedCloseDate, "2026-07-10");
    assert.equal(mondayBeforeOpen.createsSyntheticObservation, false);
  });

  it("keeps Friday close usable until Monday close reaches the next 07:00 cycle", () => {
    const instants = [
      ["2026-07-12T21:59:00.000Z", "2026-07-12", "2026-07-10", "usable"],
      ["2026-07-12T22:00:00.000Z", "2026-07-13", "2026-07-10", "usable"],
      ["2026-07-13T21:59:00.000Z", "2026-07-13", "2026-07-10", "usable"],
      ["2026-07-13T22:00:00.000Z", "2026-07-14", "2026-07-13", "stale_close"],
    ];

    for (const [instant, snapshotDate, expectedCloseDate, expectedStatus] of
      instants) {
      const resolvedSnapshotDate = resolveSnapshotCycle(
        new Date(instant),
      ).snapshotDate;
      const result = resolveKrxGoldCloseCycle({
        snapshotDate: resolvedSnapshotDate,
        priceDate: "2026-07-10",
      });

      assert.equal(resolvedSnapshotDate, snapshotDate);
      assert.equal(result.expectedCloseDate, expectedCloseDate);
      assert.equal(
        expectedStatus === "usable" ? result.status : result.reason,
        expectedStatus,
      );
      assert.equal(result.observationDate, "2026-07-10");
      assert.equal(result.createsSyntheticObservation, false);
    }
  });

  it("carries one Friday observation across a Monday KRX holiday", () => {
    const result = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-05-26",
      priceDate: "2026-05-22",
    });

    assert.equal(result.status, "usable");
    assert.equal(result.reason, "non_trading_cycle_carry");
    assert.equal(result.expectedCloseDate, "2026-05-22");
    assert.equal(result.firstEligibleServiceDate, "2026-05-23");
    assert.equal(result.carryCalendarDays, 3);
  });

  it("rejects a missing expected trading close instead of carrying through it", () => {
    const result = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-14",
      priceDate: "2026-07-10",
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "stale_close");
    assert.equal(result.expectedCloseDate, "2026-07-13");
    assert.equal(result.observationDate, "2026-07-10");
    assert.equal(result.carryCalendarDays, null);
  });

  it("rejects future and malformed evidence without creating an observation", () => {
    const future = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-11",
      priceDate: "2026-07-11",
    });
    const invalidPrice = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-07-11",
      priceDate: "2026-02-30",
    });
    const invalidSnapshot = resolveKrxGoldCloseCycle({
      snapshotDate: "2026-02-30",
      priceDate: "2026-02-27",
    });

    assert.equal(future.reason, "future_close");
    assert.equal(invalidPrice.reason, "invalid_price_date");
    assert.equal(invalidSnapshot.reason, "invalid_snapshot_date");
    assert.equal(future.createsSyntheticObservation, false);
    assert.equal(invalidPrice.createsSyntheticObservation, false);
    assert.equal(invalidSnapshot.createsSyntheticObservation, false);
  });

  it("stays pure and reuses the existing snapshot and risk calendars", () => {
    const source = readFileSync("src/lib/krx-gold-close-cycle.ts", "utf8");

    assert.equal(KRX_GOLD_CLOSE_CYCLE_POLICY.cutoff, "07:00_KST");
    assert.match(source, /closeCalendarReferenceDateForAsset/);
    assert.match(source, /mapRiskEvidenceDateToServiceDate/);
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|process\.env|\bfetch\s*\(|insert\s+into|update\s+\w+\s+set|delete\s+from/i,
    );
  });
});
