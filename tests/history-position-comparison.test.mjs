import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildHistoryPositionComparison,
  HISTORY_POSITION_COMPARISON_POLICY,
  HISTORY_POSITION_COMPARISON_QUERY_LIMIT,
  normalizeHistoryPositionComparisonSelection,
} from "../src/lib/history-position-comparison.ts";

describe("stored named-account history position comparison", () => {
  it("accepts one chronological same-source pair and blocks unsupported selections", () => {
    assert.deepEqual(
      normalizeHistoryPositionComparisonSelection({
        account: "brokerage",
        lane: "portfolio",
        comparisonFrom: undefined,
        comparisonTo: undefined,
      }),
      { status: "idle", reason: "not_requested" },
    );
    assert.deepEqual(
      normalizeHistoryPositionComparisonSelection({
        account: "isa",
        lane: "all",
        comparisonFrom: "2026-07-08~stored_source",
        comparisonTo: "2026-07-09~stored_source",
      }),
      {
        status: "requested",
        reason: "valid_selection",
        account: "isa",
        from: { snapshotDate: "2026-07-08", source: "stored_source" },
        to: { snapshotDate: "2026-07-09", source: "stored_source" },
      },
    );
    assert.equal(
      selection({ account: "all" }).reason,
      "named_account_required",
    );
    assert.equal(
      selection({ lane: "events" }).reason,
      "portfolio_lane_required",
    );
    assert.equal(
      selection({ comparisonTo: "2026-07-09~other_source" }).reason,
      "same_source_required",
    );
    assert.equal(
      selection({ comparisonFrom: "2026-07-09~stored_source" }).reason,
      "chronological_order_required",
    );

    for (const invalid of [
      { comparisonFrom: ["2026-07-08~stored_source"] },
      { comparisonFrom: "2026-07-08~stored_source~extra" },
      { comparisonFrom: "2026-02-30~stored_source" },
      { comparisonFrom: "2026-07-08~bad source" },
      { comparisonTo: undefined },
    ]) {
      assert.equal(selection(invalid).reason, "invalid_parameters");
    }
  });

  it("compares added, removed, changed, and unchanged stored positions", () => {
    const model = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [
        portfolio({ snapshotDate: "2026-07-08", totalMarketValue: 600 }),
        portfolio({ snapshotDate: "2026-07-09", totalMarketValue: 850 }),
      ],
      fromRows: [
        position({ legacyAssetId: "a", assetName: "A", marketValueKrw: "100" }),
        position({ legacyAssetId: "b", assetName: "B", quantity: "2", marketValueKrw: "200" }),
        position({ legacyAssetId: "c", assetName: "C", quantity: "3", marketValueKrw: "300" }),
      ],
      toRows: [
        position({ snapshotDate: "2026-07-09", legacyAssetId: "a", assetName: "A", marketValueKrw: "150" }),
        position({ snapshotDate: "2026-07-09", legacyAssetId: "c", assetName: "C", quantity: "3", marketValueKrw: "300" }),
        position({ snapshotDate: "2026-07-09", legacyAssetId: "d", assetName: "D", quantity: "4", marketValueKrw: "400" }),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.addedCount, 1);
    assert.equal(model.removedCount, 1);
    assert.equal(model.changedCount, 1);
    assert.equal(model.unchangedCount, 1);
    assert.equal(model.unresolvedCount, 0);
    assert.equal(model.from?.reconciliationStatus, "matched");
    assert.equal(model.to?.reconciliationStatus, "matched");
    assert.equal(model.options.length, 2);
    assert.equal(model.rows.find((row) => row.assetName === "A")?.marketValueChangeKrw, 50);
    assert.equal(model.rows.find((row) => row.assetName === "B")?.marketValueChangeKrw, -200);
    assert.equal(model.rows.find((row) => row.assetName === "D")?.marketValueChangeKrw, 400);
  });

  it("uses the stored legacy identity while keeping it out of the display model", () => {
    const model = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [
        portfolio({ snapshotDate: "2026-07-08" }),
        portfolio({ snapshotDate: "2026-07-09" }),
      ],
      fromRows: [position({ assetId: null, legacyAssetId: "stable-id" })],
      toRows: [
        position({
          snapshotDate: "2026-07-09",
          assetId: "mapped-current-id",
          legacyAssetId: "stable-id",
        }),
      ],
    });

    assert.equal(model.changedCount, 1);
    assert.equal(model.addedCount, 0);
    assert.equal(model.removedCount, 0);
    assert.deepEqual(model.rows[0].changeReasons, ["reference_status"]);
    assert.doesNotMatch(
      JSON.stringify(model),
      /stable-id|mapped-current-id/,
    );
  });

  it("preserves unresolved duplicate and invalid rows without claiming completeness", () => {
    const model = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [
        portfolio({ snapshotDate: "2026-07-08", totalMarketValue: 200 }),
        portfolio({ snapshotDate: "2026-07-09", totalMarketValue: 100 }),
      ],
      fromRows: [
        position({ legacyAssetId: "duplicate", assetName: "Duplicate 1" }),
        position({ legacyAssetId: "duplicate", assetName: "Duplicate 2" }),
        position({ legacyAssetId: null, assetName: "No identity" }),
      ],
      toRows: [
        position({ snapshotDate: "2026-07-09", quantity: null, marketValueKrw: null }),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.unresolvedCount, 3);
    assert.equal(model.from?.duplicateIdentityCount, 2);
    assert.equal(model.from?.invalidIdentityCount, 1);
    assert.equal(model.to?.quantityPositionCount, 0);
    assert.equal(model.to?.valuedPositionCount, 0);
    assert.equal(model.from?.reconciliationStatus, "not_comparable");
    assert.equal(model.to?.reconciliationStatus, "not_comparable");
  });

  it("requires one exact stored portfolio row at each endpoint", () => {
    const missing = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio({ snapshotDate: "2026-07-08" })],
      fromRows: [position()],
      toRows: [position({ snapshotDate: "2026-07-09" })],
    });
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.to?.reason, "no_matching_portfolio_snapshot");

    const ambiguous = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [
        portfolio({ snapshotDate: "2026-07-08" }),
        portfolio({ snapshotDate: "2026-07-08" }),
        portfolio({ snapshotDate: "2026-07-09" }),
      ],
      fromRows: [position()],
      toRows: [position({ snapshotDate: "2026-07-09" })],
    });
    assert.equal(ambiguous.status, "unavailable");
    assert.equal(ambiguous.from?.reason, "ambiguous_portfolio_snapshot");
  });

  it("caps each endpoint and marks the comparison partial", () => {
    const endpointRows = (snapshotDate) =>
      Array.from({ length: HISTORY_POSITION_COMPARISON_QUERY_LIMIT }, (_, index) =>
        position({
          snapshotDate,
          legacyAssetId: `legacy-${index}`,
          assetName: `Asset ${index}`,
          marketValueKrw: "1",
        }),
      );
    const model = buildHistoryPositionComparison({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [
        portfolio({ snapshotDate: "2026-07-08", totalMarketValue: 201 }),
        portfolio({ snapshotDate: "2026-07-09", totalMarketValue: 201 }),
      ],
      fromRows: endpointRows("2026-07-08"),
      toRows: endpointRows("2026-07-09"),
    });

    assert.equal(HISTORY_POSITION_COMPARISON_POLICY.endpointRowLimit, 200);
    assert.equal(model.status, "partial");
    assert.equal(model.from?.rowLimitExceeded, true);
    assert.equal(model.to?.rowLimitExceeded, true);
    assert.equal(model.rowCount, 200);
  });

  it("keeps the server read bounded and excludes current/live fallback paths", () => {
    const querySource = readFileSync(
      new URL("../src/db/queries/history-balance.ts", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/history/page.tsx", import.meta.url),
      "utf8",
    );
    const viewSource = readFileSync(
      new URL(
        "../src/components/history/history-position-comparison.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const resultSource = readFileSync(
      new URL(
        "../src/components/history/history-position-comparison-result.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(querySource, /loadPositionComparisonRows/);
    assert.match(querySource, /HISTORY_POSITION_COMPARISON_QUERY_LIMIT/);
    assert.match(querySource, /dailyPositionSnapshots\.legacyAssetId/);
    assert.doesNotMatch(querySource, /\.leftJoin\(assets|\.innerJoin\(assets/);
    assert.doesNotMatch(querySource, /livePriceQuotes|assetPriceSnapshots|fxRates/);
    assert.doesNotMatch(pageSource, /fetch\(|\/api\//);
    assert.doesNotMatch(viewSource, /use client|fetch\(|\/api\//);
    assert.doesNotMatch(resultSource, /use client|fetch\(|\/api\//);
  });
});

function selection(overrides = {}) {
  return normalizeHistoryPositionComparisonSelection({
    account: "brokerage",
    lane: "portfolio",
    comparisonFrom: "2026-07-08~stored_source",
    comparisonTo: "2026-07-09~stored_source",
    ...overrides,
  });
}

function requested() {
  return {
    status: "requested",
    reason: "valid_selection",
    account: "brokerage",
    from: { snapshotDate: "2026-07-08", source: "stored_source" },
    to: { snapshotDate: "2026-07-09", source: "stored_source" },
  };
}

function portfolio(overrides = {}) {
  return {
    snapshotDate: "2026-07-08",
    account: "brokerage",
    source: "stored_source",
    rowKind: "stored",
    derivedFromAccounts: [],
    cashValue: 0,
    investedAmount: 100,
    totalCost: 100,
    totalMarketValue: 100,
    totalPnl: 0,
    totalReturnPct: 0,
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    snapshotDate: "2026-07-08",
    account: "brokerage",
    source: "stored_source",
    assetId: "asset-id",
    legacyAssetId: "legacy-id",
    ticker: "069500",
    assetName: "KODEX 200",
    market: "korea",
    currency: "KRW",
    quantity: "1",
    marketValueKrw: "100",
    ...overrides,
  };
}
