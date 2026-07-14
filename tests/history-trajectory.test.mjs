import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildBalanceHistoryTrajectory,
  buildPortfolioHistoryTrajectory,
  HISTORY_TRAJECTORY_POLICY,
} from "../src/lib/history-trajectory.ts";

describe("stored history amount trajectory", () => {
  it("sums the selected all balance and connects consecutive dates only", () => {
    const model = buildBalanceHistoryTrajectory({
      account: "all",
      rows: [
        balance("2026-07-01", 10, 20, 30, 40),
        balance("2026-07-02", 20, 20, 30, 40),
        balance("2026-07-04", 30, 20, 30, 40),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.policy.version, "stored_history_amount_trajectory_v1");
    assert.equal(model.pointCount, 3);
    assert.equal(model.segmentCount, 2);
    assert.equal(model.disconnectedGapCount, 1);
    assert.deepEqual(
      model.segments.map((segment) =>
        segment.points.map((point) => [point.date, point.valueKrw]),
      ),
      [
        [
          ["2026-07-01", 100],
          ["2026-07-02", 110],
        ],
        [["2026-07-04", 120]],
      ],
    );
  });

  it("keeps known points while invalid values break continuity", () => {
    const model = buildBalanceHistoryTrajectory({
      account: "brokerage",
      rows: [
        balance("2026-07-01", 0, 100, 0, 0),
        { ...balance("2026-07-02", 0, 0, 0, 0), brokerage: null },
        balance("2026-07-03", 0, 120, 0, 0),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.pointCount, 2);
    assert.equal(model.excludedPointCount, 1);
    assert.equal(model.segmentCount, 2);
    assert.equal(model.disconnectedGapCount, 1);
  });

  it("rejects duplicate same-evidence dates instead of choosing one", () => {
    const model = buildBalanceHistoryTrajectory({
      account: "isa",
      rows: [
        balance("2026-07-01", 0, 0, 100, 0),
        balance("2026-07-01", 0, 0, 200, 0),
      ],
    });

    assert.equal(model.status, "unavailable");
    assert.equal(model.pointCount, 0);
    assert.equal(model.ambiguousPointCount, 2);
    assert.equal(model.excludedPointCount, 2);
  });

  it("separates source and derived evidence even on adjacent dates", () => {
    const model = buildPortfolioHistoryTrajectory({
      account: "all",
      rows: [
        portfolio("2026-07-01", "base44_import", "stored", 100),
        portfolio("2026-07-02", "base44_import", "stored", 110),
        portfolio("2026-07-03", "varda_manual_daily_snapshot", "stored", 120),
        portfolio("2026-07-04", "varda_manual_daily_snapshot", "derived", 130),
        portfolio("2026-07-05", "varda_manual_daily_snapshot", "derived", 140),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.pointCount, 5);
    assert.equal(model.sourceCount, 2);
    assert.equal(model.evidenceGroups.length, 3);
    assert.equal(model.segmentCount, 3);
    assert.equal(model.derivedPointCount, 2);
    assert.deepEqual(
      model.segments.map((segment) => [
        segment.source,
        segment.rowKind,
        segment.points.length,
      ]),
      [
        ["base44_import", "stored", 2],
        ["varda_manual_daily_snapshot", "stored", 1],
        ["varda_manual_daily_snapshot", "derived", 2],
      ],
    );
  });

  it("does not infer a required cadence or create values for invalid dates", () => {
    const model = buildPortfolioHistoryTrajectory({
      account: "brokerage",
      rows: [
        portfolio("not-a-date", "base44_import", "stored", 100),
        portfolio("2026-07-10", "base44_import", "stored", 150),
      ],
    });

    assert.equal(HISTORY_TRAJECTORY_POLICY.interpolation, "none");
    assert.equal(HISTORY_TRAJECTORY_POLICY.flatCarry, "none");
    assert.equal(model.pointCount, 1);
    assert.equal(model.excludedPointCount, 1);
    assert.equal(model.minDate, "2026-07-10");
    assert.equal(model.maxDate, "2026-07-10");
  });

  it("stays server-rendered and reuses the existing History read model", () => {
    const modelSource = readFileSync(
      new URL("../src/lib/history-trajectory.ts", import.meta.url),
      "utf8",
    );
    const chartSource = readFileSync(
      new URL(
        "../src/components/history/history-trajectory-chart.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const viewSource = readFileSync(
      new URL("../src/components/history/history-view.tsx", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(modelSource, /drizzle|neon|server-only|fetch\s*\(|\/api\//i);
    assert.doesNotMatch(chartSource, /^"use client";/);
    assert.doesNotMatch(chartSource, /fetch\s*\(|\/api\//i);
    assert.match(chartSource, /<polyline/);
    assert.match(chartSource, /<circle/);
    assert.match(viewSource, /<HistoryTrajectoryChart/);
  });
});

function balance(balanceDate, cash, brokerage, isa, irp) {
  return {
    balanceDate,
    cash: String(cash),
    brokerage: String(brokerage),
    isa: String(isa),
    irp: String(irp),
  };
}

function portfolio(snapshotDate, source, rowKind, totalMarketValue) {
  return {
    snapshotDate,
    account: "all",
    source,
    rowKind,
    derivedFromAccounts:
      rowKind === "derived" ? ["brokerage", "isa", "irp"] : [],
    cashValue: null,
    investedAmount: null,
    totalCost: null,
    totalMarketValue,
    totalPnl: null,
    totalReturnPct: null,
  };
}
