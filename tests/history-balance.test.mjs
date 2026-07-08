import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioHistoryDisplayRows,
  normalizeHistoryAccount,
  normalizeHistoryLane,
} from "../src/lib/history-balance.ts";

function portfolioRow(overrides) {
  return {
    id: "row-1",
    snapshotDate: "2026-05-20",
    account: "brokerage",
    source: "base44_import",
    cashValue: "100",
    investedAmount: "1000",
    totalCost: "900",
    totalMarketValue: "1100",
    totalPnl: "200",
    totalReturnPct: "22.2222",
    ...overrides,
  };
}

describe("history balance helpers", () => {
  it("normalizes account and lane query values", () => {
    assert.equal(normalizeHistoryAccount("brokerage"), "brokerage");
    assert.equal(normalizeHistoryAccount(["isa", "brokerage"]), "isa");
    assert.equal(normalizeHistoryAccount("unknown"), "all");
    assert.equal(normalizeHistoryAccount(undefined), "all");

    assert.equal(normalizeHistoryLane("portfolio"), "portfolio");
    assert.equal(normalizeHistoryLane(["balance", "all"]), "balance");
    assert.equal(normalizeHistoryLane("source"), "all");
    assert.equal(normalizeHistoryLane(undefined), "all");
  });

  it("uses stored all portfolio rows when present", () => {
    const rows = buildPortfolioHistoryDisplayRows({
      account: "all",
      rows: [
        portfolioRow({ id: "brokerage-row", account: "brokerage" }),
        portfolioRow({
          id: "all-row",
          account: "all",
          totalMarketValue: "3300",
          totalPnl: "300",
        }),
      ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "all-row");
    assert.equal(rows[0].rowKind, "stored");
    assert.equal(rows[0].totalMarketValue, 3300);
    assert.deepEqual(rows[0].derivedFromAccounts, []);
  });

  it("derives display-only all rows when no stored all row exists", () => {
    const rows = buildPortfolioHistoryDisplayRows({
      account: "all",
      rows: [
        portfolioRow({ id: "brokerage-row", account: "brokerage" }),
        portfolioRow({
          id: "isa-row",
          account: "isa",
          cashValue: "20",
          investedAmount: "500",
          totalCost: "400",
          totalMarketValue: "700",
          totalPnl: "300",
        }),
        portfolioRow({
          id: "irp-row",
          account: "irp",
          cashValue: "30",
          investedAmount: "600",
          totalCost: "500",
          totalMarketValue: "800",
          totalPnl: "300",
        }),
      ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].rowKind, "derived");
    assert.equal(rows[0].cashValue, 150);
    assert.equal(rows[0].investedAmount, 2100);
    assert.equal(rows[0].totalCost, 1800);
    assert.equal(rows[0].totalMarketValue, 2600);
    assert.equal(rows[0].totalPnl, 800);
    assert.equal(Math.round((rows[0].totalReturnPct ?? 0) * 100) / 100, 44.44);
    assert.deepEqual(rows[0].derivedFromAccounts, [
      "brokerage",
      "irp",
      "isa",
    ]);
  });

  it("filters exact account rows for account-specific views", () => {
    const rows = buildPortfolioHistoryDisplayRows({
      account: "isa",
      rows: [
        portfolioRow({ id: "brokerage-row", account: "brokerage" }),
        portfolioRow({ id: "isa-row", account: "isa" }),
      ],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "isa-row");
    assert.equal(rows[0].account, "isa");
    assert.equal(rows[0].rowKind, "stored");
  });
});
