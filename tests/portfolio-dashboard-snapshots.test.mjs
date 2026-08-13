import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortfolioDashboardSnapshotTrend } from "../src/lib/portfolio-dashboard-snapshots.ts";

describe("owner-scoped portfolio dashboard snapshot trend", () => {
  it("derives all from named account rows and ignores stored all rows", () => {
    const result = buildPortfolioDashboardSnapshotTrend(
      [
        row("2026-07-09", "brokerage", 100, 80, 20, 25),
        row("2026-07-09", "isa", 50, 40, 10, 25),
        row("2026-07-09", "irp", 25, 20, 5, 25),
        row("2026-07-09", "all", 9999, 1, 9998, 999800),
      ],
    );

    assert.deepEqual(result, [
      {
        date: "2026-07-09",
        totalMarketValue: 175,
        totalPnl: 35,
        totalReturnPct: 25,
      },
    ]);
  });

  it("preserves one already-scoped account's stored return evidence", () => {
    const result = buildPortfolioDashboardSnapshotTrend(
      [row("2026-07-08", "brokerage", 100, 80, 20, 24.5)],
    );

    assert.deepEqual(result, [
      {
        date: "2026-07-08",
        totalMarketValue: 100,
        totalPnl: 20,
        totalReturnPct: 24.5,
      },
    ]);
  });

  it("uses the first ordered row per account and date without duplicating totals", () => {
    const result = buildPortfolioDashboardSnapshotTrend(
      [
        row("2026-07-09", "brokerage", 110, 90, 20, 22.22),
        row("2026-07-09", "brokerage", 100, 80, 20, 25),
      ],
    );

    assert.equal(result[0]?.totalMarketValue, 110);
  });

  it("returns partial numeric evidence instead of dropping the date", () => {
    const result = buildPortfolioDashboardSnapshotTrend(
      [row("2026-07-09", "brokerage", 100, null, null, null)],
    );

    assert.deepEqual(result, [
      {
        date: "2026-07-09",
        totalMarketValue: 100,
        totalPnl: null,
        totalReturnPct: null,
      },
    ]);
  });
});

function row(
  snapshotDate,
  account,
  totalMarketValue,
  totalCost,
  totalPnl,
  totalReturnPct,
) {
  return {
    snapshotDate,
    account,
    totalMarketValue,
    totalCost,
    totalPnl,
    totalReturnPct,
  };
}
