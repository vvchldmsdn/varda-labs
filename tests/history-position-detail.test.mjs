import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildHistoryPositionDetail,
  HISTORY_POSITION_DETAIL_POLICY,
  normalizeHistoryPositionSelection,
} from "../src/lib/history-position-detail.ts";

describe("stored named-account history position drilldown", () => {
  it("accepts one strict tuple and blocks ambiguous or unsupported selection", () => {
    assert.deepEqual(
      normalizeHistoryPositionSelection({
        account: "brokerage",
        lane: "portfolio",
        positionDate: undefined,
        positionSource: undefined,
      }),
      { status: "idle", reason: "not_requested" },
    );
    assert.deepEqual(
      normalizeHistoryPositionSelection({
        account: "isa",
        lane: "all",
        positionDate: "2026-07-09",
        positionSource: "varda_manual_daily_snapshot",
      }),
      {
        status: "requested",
        reason: "valid_selection",
        account: "isa",
        snapshotDate: "2026-07-09",
        source: "varda_manual_daily_snapshot",
      },
    );
    assert.equal(
      normalizeHistoryPositionSelection({
        account: "all",
        lane: "portfolio",
        positionDate: "2026-07-09",
        positionSource: "base44_import",
      }).reason,
      "named_account_required",
    );
    assert.equal(
      normalizeHistoryPositionSelection({
        account: "brokerage",
        lane: "balance",
        positionDate: "2026-07-09",
        positionSource: "base44_import",
      }).reason,
      "portfolio_lane_required",
    );
    for (const invalid of [
      { positionDate: " 2026-07-09", positionSource: "base44_import" },
      { positionDate: "2026-02-30", positionSource: "base44_import" },
      { positionDate: "2026-07-09", positionSource: "bad source" },
      { positionDate: ["2026-07-09"], positionSource: "base44_import" },
      { positionDate: "2026-07-09", positionSource: undefined },
    ]) {
      assert.equal(
        normalizeHistoryPositionSelection({
          account: "brokerage",
          lane: "portfolio",
          ...invalid,
        }).reason,
        "invalid_parameters",
      );
    }
  });

  it("preserves mapped and legacy-only stored rows without exposing ids", () => {
    const model = buildHistoryPositionDetail({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio({ totalMarketValue: 300, cashValue: 25 })],
      positionRows: [
        position({
          assetId: "current-id",
          legacyAssetId: "legacy-a",
          ticker: "069500",
          assetName: "KODEX 200",
          marketValueKrw: "100",
        }),
        position({
          assetId: null,
          legacyAssetId: "legacy-only-id",
          ticker: "411060",
          assetName: "ACE KRX금현물",
          marketValueKrw: "200",
        }),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.positionCount, 2);
    assert.equal(model.legacyOnlyCount, 1);
    assert.equal(model.reconciliationStatus, "matched");
    assert.equal(model.reconciliationDifferenceKrw, 0);
    assert.equal(model.portfolioCashValueKrw, 25);
    assert.equal(model.rows[0].assetName, "ACE KRX금현물");
    assert.deepEqual(Object.keys(model.rows[0]).sort(), [
      "assetName",
      "costKrw",
      "currency",
      "currentPrice",
      "currentWeight",
      "evidenceStatus",
      "fxRate",
      "mappingStatus",
      "market",
      "marketValueKrw",
      "marketValueLocal",
      "pnlKrw",
      "pnlPct",
      "priceBasis",
      "priceSource",
      "quantity",
      "ticker",
      "valuationStatus",
    ]);
    assert.doesNotMatch(JSON.stringify(model.rows), /current-id|legacy-only-id/);
  });

  it("shows a complete stored-value mismatch without normalizing either side", () => {
    const model = buildHistoryPositionDetail({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio({ totalMarketValue: 500 })],
      positionRows: [position({ marketValueKrw: "300" })],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.positionMarketValueKrw, 300);
    assert.equal(model.portfolioTotalMarketValueKrw, 500);
    assert.equal(model.reconciliationStatus, "mismatch");
    assert.equal(model.reconciliationDifferenceKrw, -200);
  });

  it("keeps compatible rows visible while flagging duplicate, missing, and foreign evidence", () => {
    const model = buildHistoryPositionDetail({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio()],
      positionRows: [
        position({ assetId: "duplicate", marketValueKrw: "100" }),
        position({
          assetId: "duplicate",
          legacyAssetId: "other-source-row",
          marketValueKrw: null,
        }),
        position({
          source: "other_source",
          assetId: "foreign",
          legacyAssetId: "foreign-row",
          marketValueKrw: "900",
        }),
      ],
    });

    assert.equal(model.status, "partial");
    assert.equal(model.positionCount, 2);
    assert.equal(model.valuedPositionCount, 1);
    assert.equal(model.duplicateIdentityCount, 2);
    assert.equal(model.incompatibleRowCount, 1);
    assert.equal(model.reconciliationStatus, "not_comparable");
    assert.equal(model.positionMarketValueKrw, 100);
  });

  it("requires the exact stored portfolio row before exposing positions", () => {
    const model = buildHistoryPositionDetail({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio({ source: "other_source" })],
      positionRows: [position()],
    });

    assert.equal(model.status, "unavailable");
    assert.equal(model.reason, "no_matching_portfolio_snapshot");
    assert.equal(model.positionCount, 0);
  });

  it("caps displayed evidence without claiming reconciliation", () => {
    const model = buildHistoryPositionDetail({
      account: "brokerage",
      lane: "portfolio",
      selection: requested(),
      portfolioRows: [portfolio({ totalMarketValue: 201 })],
      positionRows: Array.from({ length: 201 }, (_, index) =>
        position({
          assetId: `asset-${index}`,
          legacyAssetId: `legacy-${index}`,
          ticker: `T${index}`,
          assetName: `Asset ${index}`,
          marketValueKrw: "1",
        }),
      ),
    });

    assert.equal(HISTORY_POSITION_DETAIL_POLICY.rowLimit, 200);
    assert.equal(model.status, "partial");
    assert.equal(model.rowLimitExceeded, true);
    assert.equal(model.positionCount, 200);
    assert.equal(model.reconciliationStatus, "not_comparable");
  });

  it("keeps the route server-rendered, bounded, and free of current-asset fallback", () => {
    const querySource = readFileSync(
      new URL("../src/db/queries/history-balance.ts", import.meta.url),
      "utf8",
    );
    const pageSource = readFileSync(
      new URL("../src/app/history/page.tsx", import.meta.url),
      "utf8",
    );
    const detailSource = readFileSync(
      new URL(
        "../src/components/history/history-position-detail.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(querySource, /Promise\.all/);
    assert.match(querySource, /HISTORY_POSITION_DETAIL_QUERY_LIMIT/);
    assert.match(querySource, /dailyPositionSnapshots\.snapshotDate/);
    assert.match(querySource, /dailyPositionSnapshots\.account/);
    assert.match(querySource, /dailyPositionSnapshots\.source/);
    assert.doesNotMatch(querySource, /\.leftJoin\(assets|\.innerJoin\(assets/);
    assert.doesNotMatch(pageSource, /fetch\(|\/api\//);
    assert.doesNotMatch(detailSource, /use client|fetch\(|\/api\//);
  });
});

function requested() {
  return {
    status: "requested",
    reason: "valid_selection",
    account: "brokerage",
    snapshotDate: "2026-07-09",
    source: "varda_manual_daily_snapshot",
  };
}

function portfolio(overrides = {}) {
  return {
    snapshotDate: "2026-07-09",
    account: "brokerage",
    source: "varda_manual_daily_snapshot",
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
    snapshotDate: "2026-07-09",
    account: "brokerage",
    source: "varda_manual_daily_snapshot",
    assetId: "asset-id",
    legacyAssetId: "legacy-id",
    ticker: "069500",
    assetName: "KODEX 200",
    market: "korea",
    currency: "KRW",
    quantity: "1",
    currentPrice: "100",
    marketValueLocal: "100",
    marketValueKrw: "100",
    costKrw: "90",
    pnlKrw: "10",
    pnlPct: "11.11",
    currentWeight: "100",
    fxRate: "1",
    priceSource: "stored_close",
    priceBasis: "close",
    ...overrides,
  };
}
