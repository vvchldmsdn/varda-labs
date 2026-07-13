import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";

describe("investment lab counterfactual read model", () => {
  it("builds a minimized aggregate KODEX 200 comparison", () => {
    const result = buildInvestmentLabCounterfactualReadModel(fixture());

    assert.equal(result.status, "ready");
    assert.deepEqual(result.summary, {
      startServiceDate: "2026-01-02",
      endServiceDate: "2026-01-07",
      actualEndValueKrw: 1_150,
      scenarioEndValueKrw: 1_452,
      endDifferenceKrw: 302,
      comparisonDateCount: 4,
    });
    assert.equal(result.coverage.snapshotSourceRows, 12);
    assert.equal(result.coverage.completeComparisonDates, 4);
    assert.equal(result.coverage.eligibleFlowRows, 3);
    assert.equal(result.coverage.appliedFlowRows, 3);
    assert.equal(result.coverage.delayedExecutionRows, 2);
    assert.equal(result.coverage.pendingComparisonRows, 2);
    assert.equal(result.coverage.pendingAtEndRows, 0);
    assert.equal(result.rows[1].hasPendingExecution, true);
    assert.equal(result.rows.at(-1).scenarioMarketValueKrw, 1_452);
    assert.equal(result.returnEstimate.status, "ready");
    assert.ok(closeTo(result.returnEstimate.scenarioReturn, 0.21));
    assert.equal(result.returnEstimate.periodCount, 3);
    assert.equal(result.returnEstimate.actualFlowCount, 3);
    assert.equal(result.returnEstimate.scenarioFlowCount, 3);
  });

  it("blocks duplicate snapshot evidence without returning partial values", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: [...source.snapshotRows, source.snapshotRows[0]],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.summary, null);
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, ["snapshot_evidence_invalid"]);
  });

  it("blocks a stored all row that disagrees with the named-account sum", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: [
        ...source.snapshotRows,
        {
          snapshotDate: "2026-01-02",
          account: "all",
          totalMarketValue: 999,
        },
      ],
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.blockers, [
      "actual_path_reconciliation_mismatch",
    ]);
  });

  it("accepts a zero-valued named account inside a positive aggregate", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      snapshotRows: source.snapshotRows.map((row) =>
        row.account === "irp"
          ? { ...row, totalMarketValue: 0 }
          : row,
      ),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.completeComparisonDates, 4);
  });

  it("blocks only the return estimate when close bases diverge", () => {
    const source = fixture();
    const result = buildInvestmentLabCounterfactualReadModel({
      ...source,
      closeRows: source.closeRows.map((row, index) =>
        index === 0 ? { ...row, closePrice: 99 } : row,
      ),
    });

    assert.equal(result.status, "ready");
    assert.equal(result.rows.length, 4);
    assert.equal(result.returnEstimate.status, "blocked");
    assert.deepEqual(result.returnEstimate.blockers, [
      "price_basis_mismatch",
    ]);
    assert.equal(result.returnEstimate.basisMismatchRows, 1);
  });

  it("keeps internal identifiers and secret-shaped fields out of the model", () => {
    const serialized = JSON.stringify(
      buildInvestmentLabCounterfactualReadModel(fixture()),
    );

    assert.doesNotMatch(serialized, /legacyBase44Id|assetId|holdingId|ownerUserId|canonicalOwner/i);
    assert.doesNotMatch(serialized, /authorization|api[_-]?key|password|secret|token|cookie/i);
  });

  it("keeps the route server-rendered, read-only, and Basic Auth protected", () => {
    const query = readFileSync("src/db/queries/investment-lab.ts", "utf8");
    const page = readFileSync("src/app/investment-lab/page.tsx", "utf8");
    const proxy = readFileSync("src/proxy.ts", "utf8");

    assert.match(query, /^import "server-only";/);
    assert.doesNotMatch(query, /\.select\(\s*\)/);
    assert.doesNotMatch(query, /\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(
      query,
      /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
    );
    assert.doesNotMatch(page, /["']use client["']|\bfetch\s*\(/);
    assert.match(page, /getReadOnlyInvestmentLabCounterfactual/);
    assert.match(proxy, /"\/investment-lab"/);
  });
});

function fixture() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", 1_000),
      ...snapshotDate("2026-01-05", 1_050),
      ...snapshotDate("2026-01-06", 1_100),
      ...snapshotDate("2026-01-07", 1_150),
    ],
    eventRows: [
      event("2026-01-03", 0, "buy", 220),
      event("2026-01-04", 1, "sell", 110),
      event("2026-01-06", 2, "buy", 121),
      event("2026-01-06", 3, "asset_added", null),
    ],
    closeRows: [
      { priceDate: "2026-01-01", closePrice: 100, adjustedClosePrice: 100 },
      { priceDate: "2026-01-05", closePrice: 110, adjustedClosePrice: 110 },
      { priceDate: "2026-01-06", closePrice: 121, adjustedClosePrice: 121 },
    ],
  };
}

function snapshotDate(snapshotDate, total) {
  return [
    { snapshotDate, account: "brokerage", totalMarketValue: total * 0.5 },
    { snapshotDate, account: "isa", totalMarketValue: total * 0.3 },
    { snapshotDate, account: "irp", totalMarketValue: total * 0.2 },
  ];
}

function event(eventDate, sequence, eventType, amountKrw) {
  return {
    eventDate,
    eventType,
    sequence,
    amountKrw,
    quantityDelta: null,
    price: null,
    fxRate: null,
    assetCurrency: "KRW",
    isCorrection: false,
  };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
