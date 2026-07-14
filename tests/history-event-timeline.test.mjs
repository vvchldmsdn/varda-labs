import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildHistoryEventTimeline,
  HISTORY_EVENT_TIMELINE_POLICY,
  shouldLoadHistoryEvents,
} from "../src/lib/history-event-timeline.ts";

describe("stored named-account history event timeline", () => {
  it("loads only a named account in the all or events lane", () => {
    assert.equal(shouldLoadHistoryEvents("brokerage", "events"), true);
    assert.equal(shouldLoadHistoryEvents("isa", "all"), true);
    assert.equal(shouldLoadHistoryEvents("all", "events"), false);
    assert.equal(shouldLoadHistoryEvents("brokerage", "portfolio"), false);

    assert.equal(
      buildHistoryEventTimeline({
        account: "all",
        lane: "events",
        eventRows: [],
      }).reason,
      "named_account_required",
    );
    assert.equal(
      buildHistoryEventTimeline({
        account: "brokerage",
        lane: "portfolio",
        eventRows: [],
      }).status,
      "idle",
    );
    assert.equal(
      buildHistoryEventTimeline({
        account: "isa",
        lane: "events",
        eventRows: [],
      }).reason,
      "no_event_rows",
    );
  });

  it("preserves trade and lifecycle evidence without exposing identifiers", () => {
    const model = buildHistoryEventTimeline({
      account: "brokerage",
      lane: "events",
      eventRows: [
        event({
          eventType: "buy",
          amountKrw: "-1234",
          quantityDelta: "2.5",
          price: "493.6",
        }),
        event({
          internalId: "internal-lifecycle-id",
          legacyBase44Id: "legacy-lifecycle-id",
          eventType: "asset_removed",
          assetId: null,
          amountKrw: null,
          quantityDelta: null,
          price: null,
        }),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.tradeCount, 1);
    assert.equal(model.lifecycleCount, 1);
    assert.equal(model.legacyOnlyCount, 1);
    assert.equal(model.rows[1].amountKrw, -1234);
    assert.deepEqual(Object.keys(model.rows[0]).sort(), [
      "amountKrw",
      "assetName",
      "assetReferenceStatus",
      "correctionStatus",
      "eventDate",
      "eventKind",
      "eventType",
      "evidenceStatus",
      "fxRate",
      "groupName",
      "missingFields",
      "price",
      "quantityDelta",
      "recordedAt",
      "ruleVersion",
      "source",
      "ticker",
    ]);
    assert.doesNotMatch(
      JSON.stringify(model.rows),
      /internal-event-id|legacy-event-id|internal-lifecycle-id|legacy-lifecycle-id/,
    );
  });

  it("keeps incomplete trade and unknown event rows visible as partial evidence", () => {
    const model = buildHistoryEventTimeline({
      account: "brokerage",
      lane: "events",
      eventRows: [
        event({ amountKrw: null, quantityDelta: null, price: null }),
        event({
          internalId: "unknown-id",
          legacyBase44Id: "unknown-legacy-id",
          eventType: "future_event",
        }),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.eventCount, 2);
    assert.equal(model.partialCount, 2);
    assert.deepEqual(model.rows[0].missingFields, [
      "amount_krw",
      "quantity_delta",
      "price",
    ]);
    assert.ok(model.rows[1].missingFields.includes("unknown_event_type"));
  });

  it("preserves correction references without netting or claiming target trust", () => {
    const model = buildHistoryEventTimeline({
      account: "brokerage",
      lane: "events",
      eventRows: [
        event({ amountKrw: "100" }),
        event({
          internalId: "correction-id",
          legacyBase44Id: "correction-legacy-id",
          amountKrw: "-40",
          correctsEventId: "target-id",
        }),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.correctionCount, 1);
    assert.deepEqual(
      model.rows.map((row) => row.amountKrw).sort((a, b) => a - b),
      [-40, 100],
    );
    assert.ok(
      model.rows.some((row) =>
        row.missingFields.includes("correction_target_unverified"),
      ),
    );
  });

  it("never infers a missing or foreign account from asset evidence", () => {
    const model = buildHistoryEventTimeline({
      account: "brokerage",
      lane: "events",
      eventRows: [
        event(),
        event({
          internalId: "missing-account-id",
          legacyBase44Id: "missing-account-legacy",
          account: null,
        }),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.eventCount, 1);
    assert.equal(model.incompatibleRowCount, 1);
  });

  it("caps display rows and flags duplicate event identities", () => {
    const model = buildHistoryEventTimeline({
      account: "brokerage",
      lane: "events",
      eventRows: Array.from({ length: 101 }, (_, index) =>
        event({
          internalId: index < 2 ? "duplicate-id" : `event-${index}`,
          legacyBase44Id: `legacy-${index}`,
          ticker: `T${String(index).padStart(3, "0")}`,
        }),
      ),
    });

    assert.equal(HISTORY_EVENT_TIMELINE_POLICY.rowLimit, 100);
    assert.equal(model.status, "partial");
    assert.equal(model.eventCount, 100);
    assert.equal(model.rowLimitExceeded, true);
    assert.equal(model.duplicateIdentityCount, 2);
  });

  it("keeps the query server-only, exact-account, bounded, and asset-join free", () => {
    const querySource = readFileSync(
      new URL("../src/db/queries/history-balance.ts", import.meta.url),
      "utf8",
    );
    const viewSource = readFileSync(
      new URL(
        "../src/components/history/history-event-timeline.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(querySource, /HISTORY_EVENT_QUERY_LIMIT/);
    assert.match(querySource, /eventLedgerEntries\.account, account/);
    assert.match(querySource, /eventLedgerEntries\.isSample, false/);
    assert.match(querySource, /Promise\.all/);
    assert.doesNotMatch(querySource, /\.leftJoin\(assets|\.innerJoin\(assets/);
    assert.doesNotMatch(viewSource, /use client|fetch\(|\/api\//);
    assert.doesNotMatch(viewSource, /correctsEventId|legacyBase44Id|assetId/);
  });
});

function event(overrides = {}) {
  return {
    internalId: "internal-event-id",
    legacyBase44Id: "legacy-event-id",
    eventDate: "2026-07-02",
    eventType: "buy",
    source: "manual",
    recordedAt: "2026-07-02T03:00:00.000Z",
    ruleVersion: "event_v1",
    account: "brokerage",
    assetId: "stored-asset-reference",
    legacyAssetId: "legacy-asset-reference",
    ticker: "069500",
    assetName: "KODEX 200",
    groupName: null,
    correctsEventId: null,
    legacyCorrectsEventId: null,
    amountKrw: "100",
    quantityDelta: "1",
    price: "100",
    fxRate: null,
    ...overrides,
  };
}
