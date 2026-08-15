import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioGroupHistoryRows,
  HISTORY_PORTFOLIO_SCOPE_POLICY,
} from "../src/lib/history-portfolio-scope.ts";

const SCOPE_KEY = "portfolio:11111111-1111-4111-8111-111111111111";

describe("effective-dated portfolio group history", () => {
  it("uses inclusive starts and exclusive ends", () => {
    const result = buildPortfolioGroupHistoryRows({
      scopeKey: SCOPE_KEY,
      accountMemberships: [period("account-1", "2026-07-02", "2026-07-04")],
      assetMemberships: [],
      rows: [
        position({ snapshotDate: "2026-07-01" }),
        position({ snapshotDate: "2026-07-02" }),
        position({ snapshotDate: "2026-07-03" }),
        position({ snapshotDate: "2026-07-04" }),
      ],
    });

    assert.equal(
      HISTORY_PORTFOLIO_SCOPE_POLICY.membershipWindow,
      "valid_from_inclusive_valid_to_exclusive",
    );
    assert.deepEqual(
      result.map((row) => row.snapshotDate),
      ["2026-07-02", "2026-07-03"],
    );
  });

  it("unions account and direct-asset membership without double counting", () => {
    const result = buildPortfolioGroupHistoryRows({
      scopeKey: SCOPE_KEY,
      accountMemberships: [period("account-1", "2026-07-01")],
      assetMemberships: [period("asset-1", "2026-07-01")],
      rows: [position({ marketValueKrw: "125" })],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].totalMarketValue, "125");
    assert.deepEqual(result[0].derivedFromAccounts, ["brokerage"]);
  });

  it("keeps unmatched legacy assets through whole-account membership", () => {
    const result = buildPortfolioGroupHistoryRows({
      scopeKey: SCOPE_KEY,
      accountMemberships: [period("account-1", "2026-07-01")],
      assetMemberships: [],
      rows: [position({ assetId: null, marketValueKrw: "75" })],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].totalMarketValue, "75");
  });

  it("keeps a partial date visible and only derives return from complete inputs", () => {
    const result = buildPortfolioGroupHistoryRows({
      scopeKey: SCOPE_KEY,
      accountMemberships: [period("account-1", "2026-07-01")],
      assetMemberships: [],
      rows: [
        position({ marketValueKrw: "100", costKrw: "80", pnlKrw: "20" }),
        position({
          assetId: "asset-2",
          marketValueKrw: null,
          costKrw: "40",
          pnlKrw: null,
        }),
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].rowKind, "partial");
    assert.equal(result[0].totalMarketValue, "100");
    assert.equal(result[0].totalCost, "120");
    assert.equal(result[0].totalPnl, "20");
    assert.equal(result[0].totalReturnPct, null);
  });
});

function period(targetId, validFrom, validTo = null) {
  return { targetId, validFrom, validTo };
}

function position(overrides = {}) {
  return {
    snapshotDate: "2026-07-02",
    source: "varda_manual_daily_snapshot",
    account: "brokerage",
    accountId: "account-1",
    assetId: "asset-1",
    marketValueKrw: "100",
    costKrw: "80",
    pnlKrw: "20",
    ...overrides,
  };
}
