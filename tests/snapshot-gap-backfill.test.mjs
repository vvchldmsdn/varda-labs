import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInclusiveDateRange,
  previousCalendarDate,
  SNAPSHOT_GAP_BACKFILL_POLICY,
  validateSnapshotGapBackfillAuthorization,
} from "../src/lib/snapshots/gap-backfill.ts";

describe("snapshot gap backfill policy", () => {
  const authorization = Object.freeze({
    policyId: SNAPSHOT_GAP_BACKFILL_POLICY.id,
    fromDate: "2026-07-10",
    toDate: "2026-08-02",
    ownerUserId: "owner-1",
    holdingsAttestation: SNAPSHOT_GAP_BACKFILL_POLICY.holdingsAttestation,
    eventLedgerMutationCount: 0,
  });

  it("builds the exact 24-day missing service-date range", () => {
    const result = buildInclusiveDateRange("2026-07-10", "2026-08-02");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.dates.length, 24);
    assert.equal(result.dates[0], "2026-07-10");
    assert.equal(result.dates.at(-1), "2026-08-02");
  });

  it("uses the previous calendar date as the historical FX cutoff", () => {
    assert.equal(previousCalendarDate("2026-07-10"), "2026-07-09");
  });

  it("admits only the attested owner and approved historical range", () => {
    assert.deepEqual(
      validateSnapshotGapBackfillAuthorization({
        authorization,
        requestedDate: "2026-07-20",
        requestedOwnerUserId: "owner-1",
        currentCycleDate: "2026-08-03",
      }),
      {
        ok: true,
        dates: buildInclusiveDateRange("2026-07-10", "2026-08-02").dates,
      },
    );

    assert.deepEqual(
      validateSnapshotGapBackfillAuthorization({
        authorization,
        requestedDate: "2026-07-20",
        requestedOwnerUserId: "owner-2",
        currentCycleDate: "2026-08-03",
      }),
      { ok: false, reason: "owner_mismatch" },
    );
    assert.deepEqual(
      validateSnapshotGapBackfillAuthorization({
        authorization,
        requestedDate: "2026-08-03",
        requestedOwnerUserId: "owner-1",
        currentCycleDate: "2026-08-03",
      }),
      { ok: false, reason: "requested_date_outside_approved_range" },
    );
  });

  it("rejects an event-ledger mutation assertion", () => {
    const result = validateSnapshotGapBackfillAuthorization({
      authorization: { ...authorization, eventLedgerMutationCount: 1 },
      requestedDate: "2026-07-20",
      requestedOwnerUserId: "owner-1",
      currentCycleDate: "2026-08-03",
    });

    assert.deepEqual(result, {
      ok: false,
      reason: "event_ledger_mutations_present",
    });
  });
});
