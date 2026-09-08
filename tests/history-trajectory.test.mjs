import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

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

  it("stays server-rendered and renders localized accessible titles from the existing History read model", async () => {
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

    const model = buildBalanceHistoryTrajectory({
      account: "brokerage",
      rows: [balance("2026-07-01", 0, 100, 0, 0), balance("2026-07-02", 0, 120, 0, 0)],
    });
    const before = structuredClone(model);
    const [chart, provider] = await importUiWithPorts([
      "src/components/history/history-trajectory-chart.tsx",
      "src/components/i18n/locale-provider.tsx",
    ], { "next/navigation": { usePathname: () => "/history" } });
    const renderedPaths = [];
    for (const [locale, title, accessibleName] of [
      ["ko", "증권 저장 잔액 궤적", "증권 저장 잔액 궤적 차트"],
      ["en", "Brokerage recorded balance path", "Brokerage recorded balance path chart"],
    ]) {
      const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale: locale },
        React.createElement(chart.HistoryTrajectoryChart, { model }),
      ));
      assert.match(markup, new RegExp(`<title>${title}</title>`));
      assert.match(markup, new RegExp(`aria-label="${accessibleName}"`));
      assert.doesNotMatch(markup, /\[object Object\]/);
      assert.equal((markup.match(/<title>/g) ?? []).length, 3);
      assert.match(markup, /<title>2026-07-01 · ₩100 · /);
      assert.match(markup, /<title>2026-07-02 · ₩120 · /);
      assert.equal((markup.match(/<circle\b/g) ?? []).length, 2);
      assert.equal((markup.match(/<polyline\b/g) ?? []).length, 1);
      renderedPaths.push([...markup.matchAll(/<polyline\b[^>]*points="([^"]+)"/g)].map(match => match[1]));
    }
    assert.deepEqual(renderedPaths[0], renderedPaths[1], "localization must retain recorded numeric chart coordinates");
    assert.deepEqual(model, before);
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
