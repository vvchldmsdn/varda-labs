import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("history redesign boundaries", () => {
  it("keeps tenant reads in the server page and loads independent evidence in parallel", () => {
    const page = read("src/app/history/page.tsx");

    assert.match(page, /resolveCurrentTenantContext\(\)/);
    assert.match(page, /getReadOnlyTenantHistoryBalance/);
    assert.match(page, /getReadOnlyTenantEvents/);
    assert.match(page, /const \[history, events\] = await Promise\.all/);
    assert.match(page, /generatedAt=\{new Date\(\)\.toISOString\(\)\}/);
    assert.doesNotMatch(page, /^"use client";/);
  });

  it("uses the shared navigation and analysis scopes without discarding legacy evidence views", () => {
    const view = read("src/components/history/history-view.tsx");

    assert.match(view, /<PortfolioPrimaryNavigation/);
    assert.match(view, /<PortfolioAnalysisScopeTabs/);
    assert.match(view, /buildHistoryOverview/);
    assert.match(view, /<HistoryTimeExplorer/);
    assert.match(view, /scopeLabel=\{history\.selectedScope\.label\}/);
    assert.match(view, /<HistoryActivityStream/);
    assert.match(view, /<HistoryTrajectoryChart/);
    assert.match(view, /<PortfolioHistoryTable/);
    assert.match(view, /원시 기록과 검증 근거 보기/);
  });

  it("isolates interaction in a serializable client component with no browser-side data fetch", () => {
    const explorer = read(
      "src/components/history/history-time-explorer.tsx",
    );

    assert.match(explorer, /^"use client";/);
    assert.match(explorer, /useMemo/);
    assert.match(explorer, /useState/);
    assert.match(explorer, /<HistoryPerformanceChart/);
    assert.match(explorer, /<HistorySnapshotRail/);
    assert.match(explorer, /평가액/);
    assert.match(explorer, /수익률/);
    assert.match(explorer, /30일/);
    assert.match(explorer, /90일/);
    assert.match(explorer, /1년/);
    assert.match(explorer, /전체/);
    assert.doesNotMatch(explorer, /fetch\s*\(|\/api\/|drizzle|neon/i);

    const chart = read(
      "src/components/history/history-performance-chart.tsx",
    );
    assert.match(chart, /buildMonotoneCurvePath/);
    assert.doesNotMatch(chart, /fetch\s*\(|\/api\/|drizzle|neon/i);
  });

  it("reads optional stored risk evidence without recomputing risk in the query layer", () => {
    const query = read("src/db/queries/tenant-history-snapshots.ts");

    for (const column of [
      "avg_correlation",
      "enb",
      "portfolio_volatility",
      "regime_label",
      "regime_score",
    ]) {
      assert.match(query, new RegExp(column));
    }
    assert.doesNotMatch(query, /corr\s*\(|covar|stddev|variance/i);
  });
});
