import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KisRawHistoryInputError,
  mergeKisRawHistoryRows,
  normalizeKisRawHistoryPayload,
  planKisRawHistoryRequests,
} from "../src/lib/market-data/providers/kis-history.ts";
import {
  KIS_HISTORY_PREVIEW_POLICY,
  KisHistoryPreviewInputError,
  parseKisHistoryPreviewRequest,
  summarizeKisHistoryPreview,
} from "../src/lib/market-data/kis-history-preview.ts";

describe("KIS raw close history", () => {
  it("plans bounded newest-first windows and explicit transport limits", () => {
    const plan = planKisRawHistoryRequests({
      targets: [
        target({ ticker: "069500", market: "korea", currency: "KRW" }),
        target({ ticker: "qqq", market: "us", currency: "USD" }),
      ],
      startDate: "2026-01-01",
      endDate: "2026-07-10",
    });

    assert.equal(plan.policy.version, "kis_raw_close_history_v1");
    assert.equal(plan.policy.priceBasis, "raw_price_return");
    assert.equal(plan.windows.length, 3);
    assert.deepEqual(plan.windows[0], {
      index: 0,
      startDate: "2026-04-12",
      endDate: "2026-07-10",
    });
    assert.deepEqual(plan.windows.at(-1), {
      index: 2,
      startDate: "2026-01-01",
      endDate: "2026-01-11",
    });
    assert.equal(plan.requests.length, 6);
    assert.equal(plan.maximumTransportRequestCount, 12);
    assert.deepEqual(
      plan.instruments.map((instrument) => instrument.key),
      ["korea|KRW|069500", "us|USD|QQQ"],
    );
  });

  it("rejects malformed ranges, oversized ranges, and duplicate instruments", () => {
    assert.throws(
      () =>
        planKisRawHistoryRequests({
          targets: [
            target({ ticker: "QQQ", market: "us", currency: "USD" }),
          ],
          startDate: "2026-02-30",
          endDate: "2026-07-10",
        }),
      (error) =>
        error instanceof KisRawHistoryInputError &&
        error.code === "invalid_date_range",
    );

    assert.throws(
      () =>
        planKisRawHistoryRequests({
          targets: [
            target({ ticker: "QQQ", market: "us", currency: "USD" }),
          ],
          startDate: "2024-01-01",
          endDate: "2026-07-10",
        }),
      (error) =>
        error instanceof KisRawHistoryInputError &&
        error.code === "range_too_large",
    );

    assert.throws(
      () =>
        planKisRawHistoryRequests({
          targets: [
            target({ ticker: "qqq", market: "us", currency: "USD" }),
            target({ ticker: "QQQ", market: "us", currency: "usd" }),
          ],
          startDate: "2026-01-01",
          endDate: "2026-01-10",
        }),
      (error) =>
        error instanceof KisRawHistoryInputError &&
        error.code === "duplicate_instrument",
    );
  });

  it("normalizes domestic rows without claiming adjusted-close evidence", () => {
    const fetchedAt = new Date("2026-07-11T00:00:00.000Z");
    const normalized = normalizeKisRawHistoryPayload({
      target: target({
        ticker: "069500",
        market: "korea",
        currency: "KRW",
      }),
      window: {
        index: 0,
        startDate: "2026-07-01",
        endDate: "2026-07-10",
      },
      fetchedAt,
      rawRows: [
        { stck_bsop_date: "20260710", stck_clpr: "117700" },
        { stck_bsop_date: "20260709", stck_clpr: "116000" },
        { stck_bsop_date: "20260709", stck_clpr: "116000.0" },
        { stck_bsop_date: "20260630", stck_clpr: "115000" },
        { stck_bsop_date: "invalid", stck_clpr: "1" },
      ],
    });

    assert.equal(normalized.rows.length, 2);
    assert.equal(normalized.duplicateRowCount, 1);
    assert.equal(normalized.invalidRowCount, 1);
    assert.equal(normalized.outsideWindowRowCount, 1);
    assert.deepEqual(
      normalized.rows.map((row) => row.priceDate),
      ["2026-07-09", "2026-07-10"],
    );
    assert.ok(
      normalized.rows.every(
        (row) =>
          row.adjustedClosePrice === null &&
          row.adjustedCloseBasis === null &&
          row.adjustedCloseProvider === null &&
          row.adjustedCloseSource === null &&
          row.adjustedCloseFetchedAt === null,
      ),
    );
    assert.equal(normalized.rows[0].closePriceKrw, "116000");
    assert.equal(
      normalized.rows[0].source,
      "kis_domestic_itemchartprice",
    );
  });

  it("normalizes overseas rows with explicit exchange provenance", () => {
    const normalized = normalizeKisRawHistoryPayload({
      target: target({ ticker: "QQQ", market: "us", currency: "USD" }),
      window: {
        index: 0,
        startDate: "2026-07-01",
        endDate: "2026-07-10",
      },
      fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
      exchange: "NAS",
      rawRows: [
        { xymd: "20260710", clos: "717.61" },
        { xymd: "20260709", clos: "710.20" },
      ],
    });

    assert.equal(normalized.rows.length, 2);
    assert.equal(normalized.rows[0].closePriceKrw, null);
    assert.equal(normalized.rows[0].providerExchange, "NAS");
    assert.equal(
      normalized.rows[0].source,
      "kis_overseas_dailyprice:NAS",
    );
  });

  it("fails closed on conflicting same-day provider rows", () => {
    assert.throws(
      () =>
        normalizeKisRawHistoryPayload({
          target: target({
            ticker: "069500",
            market: "korea",
            currency: "KRW",
          }),
          window: {
            index: 0,
            startDate: "2026-07-01",
            endDate: "2026-07-10",
          },
          fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
          rawRows: [
            { stck_bsop_date: "20260710", stck_clpr: "117700" },
            { stck_bsop_date: "20260710", stck_clpr: "117800" },
          ],
        }),
      (error) =>
        error instanceof KisRawHistoryInputError &&
        error.code === "conflicting_duplicate_date",
    );
  });

  it("merges overlapping windows deterministically and rejects conflicts", () => {
    const first = normalizeKisRawHistoryPayload({
      target: target({ ticker: "QQQ", market: "us", currency: "USD" }),
      window: {
        index: 0,
        startDate: "2026-07-09",
        endDate: "2026-07-10",
      },
      fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
      exchange: "NAS",
      rawRows: [
        { xymd: "20260709", clos: "710.20" },
        { xymd: "20260710", clos: "717.61" },
      ],
    }).rows;
    const overlap = normalizeKisRawHistoryPayload({
      target: target({ ticker: "QQQ", market: "us", currency: "USD" }),
      window: {
        index: 1,
        startDate: "2026-07-08",
        endDate: "2026-07-09",
      },
      fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
      exchange: "NAS",
      rawRows: [
        { xymd: "20260708", clos: "705.00" },
        { xymd: "20260709", clos: "710.2" },
      ],
    }).rows;

    const merged = mergeKisRawHistoryRows([first, overlap]);
    assert.deepEqual(
      merged.map((row) => row.priceDate),
      ["2026-07-08", "2026-07-09", "2026-07-10"],
    );

    const conflicting = [{ ...overlap[1], closePrice: "999" }];
    assert.throws(
      () => mergeKisRawHistoryRows([first, conflicting]),
      (error) =>
        error instanceof KisRawHistoryInputError &&
        error.code === "conflicting_duplicate_date",
    );
  });
});

describe("KIS history preview boundary", () => {
  it("accepts a bounded read-only request and creates no user ownership claims", () => {
    const request = parseKisHistoryPreviewRequest({
      dryRun: true,
      startDate: "2026-01-12",
      endDate: "2026-07-10",
      targets: [
        { ticker: "069500", market: "korea", currency: "KRW" },
        { ticker: "qqq", market: "us", currency: "USD" },
      ],
    });

    assert.equal(request.targets.length, 2);
    assert.deepEqual(request.targets[1], {
      key: "us|USD|QQQ",
      ticker: "QQQ",
      market: "us",
      currency: "USD",
      accounts: [],
      assetIds: [],
      assetNames: [],
    });
  });

  it("rejects writes and ranges above the synchronous preview cap", () => {
    assert.throws(
      () =>
        parseKisHistoryPreviewRequest({
          write: true,
          startDate: "2026-07-01",
          endDate: "2026-07-10",
          targets: [{ ticker: "QQQ", market: "us", currency: "USD" }],
        }),
      KisHistoryPreviewInputError,
    );

    assert.throws(
      () =>
        parseKisHistoryPreviewRequest({
          startDate: "2026-01-01",
          endDate: "2026-07-10",
          targets: [{ ticker: "QQQ", market: "us", currency: "USD" }],
        }),
      (error) =>
        error instanceof KisHistoryPreviewInputError &&
        error.message.includes(
          String(KIS_HISTORY_PREVIEW_POLICY.maximumRangeCalendarDays),
        ),
    );
  });

  it("returns coverage summaries rather than the complete price series", () => {
    const fetchedAt = new Date("2026-07-11T00:00:00.000Z");
    const rows = normalizeKisRawHistoryPayload({
      target: target({ ticker: "QQQ", market: "us", currency: "USD" }),
      window: {
        index: 0,
        startDate: "2026-07-09",
        endDate: "2026-07-10",
      },
      fetchedAt,
      exchange: "NAS",
      rawRows: [
        { xymd: "20260709", clos: "710.20" },
        { xymd: "20260710", clos: "717.61" },
      ],
    }).rows;
    const summary = summarizeKisHistoryPreview({
      provider: "kis",
      fetchedAt,
      priceBasis: "raw_price_return",
      rows: [...rows],
      failures: [],
      requestCount: 1,
      warnings: [],
    });

    assert.equal(summary.databaseWrites, 0);
    assert.equal(summary.rowCount, 2);
    assert.equal(summary.instruments[0].firstDate, "2026-07-09");
    assert.equal(summary.instruments[0].lastDate, "2026-07-10");
    assert.equal(summary.instruments[0].adjustedCloseRowCount, 0);
    assert.equal("rows" in summary, false);
  });
});

function target({ ticker, market, currency }) {
  return {
    key: `${market}|${currency}|${ticker}`,
    ticker,
    market,
    currency,
    accounts: [],
    assetIds: [],
    assetNames: [],
  };
}
