import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTodayMovementAttribution,
  selectTodayHoldingHistory,
} from "../src/lib/today-movement-view.ts";
import { buildTodayQuoteFreshness, formatTodayEvidenceRange } from "../src/lib/today-quote-freshness.ts";

describe("today quote retrieval evidence", () => {
  const now = "2026-09-10T03:37:00.000Z";
  const holding = (overrides = {}) => ({ movementEligible: true, currency: "KRW", currentPrice: 100, priceStatus: "ok", priceFetchedAt: "2026-09-10T03:36:00.000Z", priceAsOf: "2026-09-09T06:30:00.000Z", ...overrides });
  it("keeps oldest and newest retrieval times separate from market evidence and render time", () => {
    const result = buildTodayQuoteFreshness({ holdings: [holding(), holding({ priceFetchedAt: "2026-09-10T03:33:40.000Z", priceAsOf: now })], fxFetchedAt: null, now });
    assert.deepEqual(result.fetched, { oldest: "2026-09-10T03:33:40.000Z", newest: "2026-09-10T03:36:00.000Z" });
    assert.deepEqual(result.observed, { oldest: "2026-09-09T06:30:00.000Z", newest: now });
    assert.equal(result.staleQuoteCount, 0, "a newly retrieved closed-market price is not a stale retrieval");
    assert.equal(formatTodayEvidenceRange(result.fetched, now), "12:33:40–12:36:00 KST");
    assert.equal(formatTodayEvidenceRange(result.observed, now), "2026-09-09 15:30:00–2026-09-10 12:37:00 KST");
  });
  it("does not let a freshly retrieved holding hide another stale quote or FX rate", () => {
    const result = buildTodayQuoteFreshness({ holdings: [holding(), holding({ currency: "USD", priceFetchedAt: "2026-09-10T03:20:00Z" })], fxFetchedAt: "2026-09-10T03:30:00Z", now });
    assert.equal(result.staleQuoteCount, 1);
    assert.equal(result.hasFxExposure, true);
    assert.equal(result.fxNeedsRefresh, true);
    assert.equal(result.fxFetchedAt, "2026-09-10T03:30:00.000Z");
  });
  it("retains missing retrieval evidence instead of replacing it with price or render time", () => {
    const result = buildTodayQuoteFreshness({ holdings: [holding({ priceFetchedAt: null, priceAsOf: now, currency: "USD" }), holding({ priceFetchedAt: "invalid" }), holding({ priceStatus: "error" }), holding({ priceFetchedAt: "2026-09-10T04:00:00Z" })], fxFetchedAt: "invalid", now });
    assert.equal(result.missingQuoteCount, 4);
    assert.deepEqual(result.fetched, { oldest: null, newest: null });
    assert.equal(formatTodayEvidenceRange(result.fetched, now), "—");
    assert.equal(result.fxFetchedAt, null);
    assert.equal(result.fxNeedsRefresh, true);
  });
  it("excludes manually valued non-movement holdings and ignores FX for a KRW-only scope", () => {
    const result = buildTodayQuoteFreshness({ holdings: [holding(), holding({ movementEligible: false, currency: "USD", priceFetchedAt: null })], fxFetchedAt: null, now });
    assert.equal(result.missingQuoteCount, 0);
    assert.equal(result.hasFxExposure, false);
    assert.equal(result.fxNeedsRefresh, false);
    assert.equal(formatTodayEvidenceRange(result.fetched, now), "12:36:00 KST");
  });
});

describe("today movement view attribution", () => {
  it("keeps trade flow outside price and FX performance attribution", () => {
    assert.deepEqual(
      buildTodayMovementAttribution({
        ready: true,
        changeKrw: 700,
        priceChangeKrw: 500,
        fxChangeKrw: 200,
        scopePreviousTotalKrw: 10_000,
        scopeCurrentTotalKrw: 11_700,
        movementExcludedCurrentValueKrw: 0,
        tradeFlowKrw: 1_000,
      }),
      {
        changeKrw: 700,
        currentEvidenceKrw: 11_700,
        fxImpactKrw: 200,
        movementExcludedCurrentValueKrw: 0,
        previousEvidenceKrw: 10_000,
        priceImpactKrw: 500,
        tradeFlowKrw: 1_000,
      },
    );
  });

  it("returns pending values when aggregate movement is not ready", () => {
    assert.deepEqual(
      buildTodayMovementAttribution({
        ready: false,
        changeKrw: null,
        priceChangeKrw: null,
        fxChangeKrw: 200,
        scopePreviousTotalKrw: null,
        scopeCurrentTotalKrw: null,
        movementExcludedCurrentValueKrw: 1_806_000,
        tradeFlowKrw: 1_000,
      }),
      {
        changeKrw: null,
        currentEvidenceKrw: null,
        fxImpactKrw: null,
        movementExcludedCurrentValueKrw: 1_806_000,
        previousEvidenceKrw: null,
        priceImpactKrw: null,
        tradeFlowKrw: null,
      },
    );
  });

  it("keeps non-movement holdings in both scope totals without attributing movement", () => {
    assert.deepEqual(
      buildTodayMovementAttribution({
        ready: true,
        changeKrw: -9_932,
        priceChangeKrw: -9_932,
        fxChangeKrw: 0,
        scopePreviousTotalKrw: 25_748_395,
        scopeCurrentTotalKrw: 25_738_463,
        movementExcludedCurrentValueKrw: 1_806_000,
        tradeFlowKrw: 0,
      }),
      {
        changeKrw: -9_932,
        currentEvidenceKrw: 25_738_463,
        fxImpactKrw: 0,
        movementExcludedCurrentValueKrw: 1_806_000,
        previousEvidenceKrw: 25_748_395,
        priceImpactKrw: -9_932,
        tradeFlowKrw: 0,
      },
    );
  });
});

describe("today selected holding history", () => {
  it("selects only finite stored valuation evidence for the requested holding", () => {
    const history = {
      dates: ["2026-08-20", "2026-08-21", "2026-08-22"],
      rows: [
        {
          holdingId: "holding-a",
          name: "Alpha",
          ticker: "AAA",
          account: "brokerage",
          currentWeight: 50,
          cells: [
            { date: "2026-08-20", changePct: 1, marketValueKrw: 100, changeKrw: 1, priceChangeKrw: 1, fxChangeKrw: 0, basis: "unit_value" },
            { date: "2026-08-21", changePct: null, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "missing" },
            { date: "2026-08-22", changePct: -2, marketValueKrw: 98, changeKrw: -2, priceChangeKrw: -2, fxChangeKrw: 0, basis: "unit_value" },
          ],
        },
        {
          holdingId: "holding-b",
          name: "Beta",
          ticker: "BBB",
          account: "isa",
          currentWeight: 50,
          cells: [
            { date: "2026-08-20", changePct: 3, marketValueKrw: 300, changeKrw: 9, priceChangeKrw: 9, fxChangeKrw: 0, basis: "unit_value" },
          ],
        },
      ],
      observedCellCount: 3,
      expectedCellCount: 4,
      coveragePct: 75,
    };

    assert.deepEqual(selectTodayHoldingHistory(history, "holding-a"), [
      { basis: "market_value", chartValue: 100, changePct: 1, date: "2026-08-20", marketValueKrw: 100 },
      { basis: "market_value", chartValue: 98, changePct: -2, date: "2026-08-22", marketValueKrw: 98 },
    ]);
    assert.deepEqual(selectTodayHoldingHistory(history, "missing"), []);
  });

  it("uses a normalized return path when legacy rows lack valuation amounts", () => {
    const history = {
      dates: ["2026-08-20", "2026-08-21", "2026-08-22"],
      rows: [{
        holdingId: "holding-a",
        name: "Alpha",
        ticker: "AAA",
        account: "brokerage",
        currentWeight: 100,
        cells: [
          { date: "2026-08-20", changePct: 1, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
          { date: "2026-08-21", changePct: -2, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
          { date: "2026-08-22", changePct: 3, marketValueKrw: null, changeKrw: null, priceChangeKrw: null, fxChangeKrw: null, basis: "unit_value" },
        ],
      }],
      observedCellCount: 3,
      expectedCellCount: 3,
      coveragePct: 100,
    };

    const points = selectTodayHoldingHistory(history, "holding-a");
    assert.equal(points.length, 3);
    assert.deepEqual(points.map((point) => point.basis), [
      "normalized_return",
      "normalized_return",
      "normalized_return",
    ]);
    assert.equal(points[0].chartValue, 100);
    assert.equal(points[1].chartValue, 98);
    assert.ok(Math.abs(points[2].chartValue - 100.94) < 1e-9);
  });
});
