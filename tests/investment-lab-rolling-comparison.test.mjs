import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabRollingComparison } from "../src/lib/investment-lab-rolling-comparison.ts";

const SERVICE_DATES = Object.freeze([
  "2026-06-01",
  "2026-06-02",
  "2026-06-03",
  "2026-06-04",
  "2026-06-05",
  "2026-06-08",
  "2026-06-09",
  "2026-06-10",
  "2026-06-11",
  "2026-06-12",
  "2026-06-15",
  "2026-06-16",
]);

describe("investment lab rolling same-flow comparison", () => {
  it("selects deterministic best and worst complete 10-observation windows", () => {
    const model = buildInvestmentLabRollingComparison({
      source: fixture(),
      availableServiceDates: SERVICE_DATES,
    });

    assert.equal(model.status, "ready");
    assert.equal(model.policy.observationCount, 10);
    assert.equal(model.candidateWindowCount, 3);
    assert.equal(model.completeWindowCount, 3);
    assert.equal(model.excludedWindowCount, 0);
    assert.equal(model.worstWindow.startServiceDate, "2026-06-01");
    assert.equal(model.worstWindow.endServiceDate, "2026-06-12");
    assert.equal(model.worstWindow.observationCount, 10);
    assert.ok(closeTo(model.worstWindow.actualReturn, -0.2));
    assert.equal(model.bestWindow.startServiceDate, "2026-06-02");
    assert.equal(model.bestWindow.endServiceDate, "2026-06-15");
    assert.ok(closeTo(model.bestWindow.actualReturn, 0.2));
    assert.ok(Number.isFinite(model.bestWindow.kodex200Return));
    assert.ok(Number.isFinite(model.bestWindow.vooReturn));
  });

  it("excludes an entire rolling window when its price basis is incomplete", () => {
    const source = fixture();
    const model = buildInvestmentLabRollingComparison({
      source: {
        ...source,
        closeRows: source.closeRows.map((row, index) =>
          index === 0 ? { ...row, closePrice: row.closePrice + 1 } : row,
        ),
      },
      availableServiceDates: SERVICE_DATES,
    });

    assert.equal(model.status, "ready");
    assert.equal(model.candidateWindowCount, 3);
    assert.equal(model.completeWindowCount, 2);
    assert.equal(model.excludedWindowCount, 1);
    assert.notEqual(model.worstWindow.startServiceDate, "2026-06-01");
    assert.notEqual(model.bestWindow.startServiceDate, "2026-06-01");
  });

  it("fails closed when fewer than ten complete observations exist", () => {
    const model = buildInvestmentLabRollingComparison({
      source: fixture(),
      availableServiceDates: SERVICE_DATES.slice(0, 9),
    });

    assert.equal(model.status, "unavailable");
    assert.equal(model.reason, "insufficient_observations");
    assert.equal(model.candidateWindowCount, 0);
    assert.equal(model.bestWindow, null);
    assert.equal(model.worstWindow, null);
  });

  it("reuses the server read model without a client fetch or new route", () => {
    const loader = readFileSync(
      "src/lib/investment-lab-counterfactual-read-loader.ts",
      "utf8",
    );
    const component = readFileSync(
      "src/components/investment-lab/investment-lab-rolling-comparison.tsx",
      "utf8",
    );
    const page = readFileSync("src/app/investment-lab/page.tsx", "utf8");

    assert.match(loader, /buildInvestmentLabRollingComparison/);
    assert.match(page, /InvestmentLabRollingComparisonView/);
    assert.doesNotMatch(component, /["']use client["']|\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(loader, /\bfetch\s*\(|\/api\//);
  });
});

function fixture() {
  const actualValues = [100, 100, 100, 100, 100, 100, 100, 100, 100, 80, 120, 90];
  return {
    snapshotRows: SERVICE_DATES.flatMap((date, index) =>
      snapshotDate(date, actualValues[index]),
    ),
    eventRows: [],
    closeRows: [
      price("2026-05-29", 98),
      ...SERVICE_DATES.map((date, index) => price(date, 100 + index * 2)),
    ],
    vooCloseRows: [
      price("2026-05-29", 197),
      ...SERVICE_DATES.map((date, index) => price(date, 200 + index * 3)),
    ],
    fxRows: SERVICE_DATES.map((rateDate, index) => ({
      rateDate,
      usdKrw: 1_300 + index,
      source: "fx_fixture",
      status: "ok",
    })),
  };
}

function snapshotDate(snapshotDate, total) {
  return [
    snapshotRow(snapshotDate, "brokerage", total * 0.5),
    snapshotRow(snapshotDate, "isa", total * 0.3),
    snapshotRow(snapshotDate, "irp", total * 0.2),
  ];
}

function snapshotRow(snapshotDate, account, totalMarketValue) {
  return {
    snapshotDate,
    account,
    cashValue: 0,
    totalMarketValue,
    usdKrw: 1_300,
    source: "snapshot_fixture",
    ruleVersion: "snapshot_fixture_v1",
  };
}

function price(priceDate, value) {
  return {
    priceDate,
    closePrice: value,
    adjustedClosePrice: value,
    source: "price_fixture",
  };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
