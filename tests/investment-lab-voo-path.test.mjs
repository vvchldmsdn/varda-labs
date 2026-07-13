import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { resolveInvestmentLabVooEvidence } from "../src/lib/investment-lab-voo-evidence.ts";
import {
  buildInvestmentLabVooPath,
  INVESTMENT_LAB_VOO_PATH_POLICY,
} from "../src/lib/investment-lab-voo-path.ts";
import { buildInvestmentLabVooReturnEstimate } from "../src/lib/investment-lab-voo-return-estimate.ts";

describe("investment lab VOO same-flow path", () => {
  it("uses fractional units with zero residual cash", () => {
    const source = fixture();
    const evidence = resolveInvestmentLabVooEvidence(source);
    const path = buildInvestmentLabVooPath({
      actualPath: source.actualPath,
      evidence,
    });

    assert.equal(evidence.status, "ready");
    assert.equal(path.status, "ready");
    assert.equal(path.anchor.units, 10);
    assert.equal(path.appliedFlows.length, 2);
    assert.ok(closeTo(path.rows.at(-1).units, 10 + 130_000 / 156_000 - 0.5));
    assert.equal(path.pendingAtEnd.flowCount, 0);
    assert.equal(INVESTMENT_LAB_VOO_PATH_POLICY.fractionalUnits, true);
    assert.equal(INVESTMENT_LAB_VOO_PATH_POLICY.residualCashKrw, 0);
  });

  it("fails closed instead of scaling or shorting an insolvent sell", () => {
    const source = fixture();
    source.boundaryFlows = [flow("2026-01-04", 0, "outflow", 2_000_000)];
    const path = buildInvestmentLabVooPath({
      actualPath: source.actualPath,
      evidence: resolveInvestmentLabVooEvidence(source),
    });

    assert.equal(path.status, "blocked");
    assert.deepEqual(path.blockers, [
      {
        reason: "scenario_insolvent",
        sourceIndex: 0,
        serviceDate: "2026-01-06",
      },
    ]);
    assert.deepEqual(path.rows, []);
  });

  it("returns no partial path when provenance is incomplete", () => {
    const source = fixture();
    source.snapshotRows[0] = { ...source.snapshotRows[0], source: null };
    const evidence = resolveInvestmentLabVooEvidence(source);
    const path = buildInvestmentLabVooPath({
      actualPath: source.actualPath,
      evidence,
    });

    assert.equal(evidence.status, "unavailable");
    assert.deepEqual(evidence.valuations, []);
    assert.deepEqual(evidence.executions, []);
    assert.equal(path.status, "blocked");
    assert.deepEqual(path.rows, []);
  });

  it("rejects tampered KRW unit prices and duplicate executions", () => {
    const source = fixture();
    const evidence = resolveInvestmentLabVooEvidence(source);
    assert.equal(evidence.status, "ready");

    const tampered = {
      ...evidence,
      executions: [
        { ...evidence.executions[0], unitPriceKrw: 1 },
        evidence.executions[1],
      ],
    };
    assert.equal(
      buildInvestmentLabVooPath({
        actualPath: source.actualPath,
        evidence: tampered,
      }).blockers[0].reason,
      "invalid_execution_evidence",
    );

    const duplicate = {
      ...evidence,
      executions: [...evidence.executions, evidence.executions[0]],
    };
    assert.equal(
      buildInvestmentLabVooPath({
        actualPath: source.actualPath,
        evidence: duplicate,
      }).blockers[0].reason,
      "duplicate_execution_source",
    );

    for (const patch of [
      { executionServiceDate: "2026-01-05" },
      { pendingCalendarDays: 0 },
      { amountProvenance: "unknown" },
    ]) {
      const invalidExecution = {
        ...evidence,
        executions: [
          { ...evidence.executions[0], ...patch },
          evidence.executions[1],
        ],
      };
      assert.equal(
        buildInvestmentLabVooPath({
          actualPath: source.actualPath,
          evidence: invalidExecution,
        }).blockers[0].reason,
        "invalid_execution_evidence",
      );
    }
  });

  it("calculates an independent Modified Dietz comparison", () => {
    const source = fixture();
    const evidence = resolveInvestmentLabVooEvidence(source);
    const path = buildInvestmentLabVooPath({
      actualPath: source.actualPath,
      evidence,
    });
    assert.equal(path.status, "ready");

    const estimate = buildInvestmentLabVooReturnEstimate({
      actualRows: source.actualPath,
      scenarioRows: path.rows,
      boundaryFlows: source.boundaryFlows,
      appliedFlows: path.appliedFlows,
      snapshotRows: source.returnSnapshotRows,
      eventRows: source.returnEventRows,
    });

    assert.equal(estimate.status, "ready");
    assert.equal(estimate.basis.version, "voo_raw_close_snapshot_fx_price_only_v1");
    assert.equal(estimate.scenarioFlowCount, 2);
    assert.equal(estimate.periodCount, 2);
    assert.ok(Number.isFinite(estimate.scenarioReturn));
  });

  it("keeps the path and return helpers pure", () => {
    const source = [
      "src/lib/investment-lab-voo-evidence.ts",
      "src/lib/investment-lab-voo-path.ts",
      "src/lib/investment-lab-voo-return-estimate.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
  });
});

function fixture() {
  const serviceDates = ["2026-01-02", "2026-01-05", "2026-01-06"];
  const snapshotRows = serviceDates.flatMap((snapshotDate) =>
    ["brokerage", "isa", "irp"].map((account) => ({
      snapshotDate,
      account,
      usdKrw: 1_300,
      source: "snapshot_fixture",
      ruleVersion: "snapshot-fixture-v1",
    })),
  );
  const boundaryFlows = [
    flow("2026-01-03", 0, "inflow", 130_000),
    flow("2026-01-04", 1, "outflow", 78_000),
  ];
  return {
    serviceDates,
    priceRows: [
      price("2025-12-31", 100),
      price("2026-01-02", 110),
      price("2026-01-05", 120),
    ],
    snapshotRows,
    fxRows: [fx("2026-01-05", 1_300)],
    boundaryFlows,
    actualPath: [
      { serviceDate: "2026-01-02", totalMarketValueKrw: 1_300_000 },
      { serviceDate: "2026-01-05", totalMarketValueKrw: 1_430_000 },
      { serviceDate: "2026-01-06", totalMarketValueKrw: 1_500_000 },
    ],
    returnSnapshotRows: snapshotRows.map((row) => ({
      ...row,
      cashValue: 0,
    })),
    returnEventRows: boundaryFlows.map((row) => ({
      eventDate: row.eventDate,
      eventType: row.direction === "inflow" ? "buy" : "sell",
      amountKrw: row.amountKrw,
      quantityDelta: null,
      price: null,
      fxRate: null,
      isCorrection: false,
    })),
  };
}

function price(priceDate, closePrice) {
  return {
    priceDate,
    closePrice,
    adjustedClosePrice: closePrice + 1,
    source: "price_fixture",
  };
}

function fx(rateDate, usdKrw) {
  return { rateDate, usdKrw, source: "fx_fixture", status: "ok" };
}

function flow(eventDate, sequence, direction, amountKrw) {
  return {
    eventDate,
    sequence,
    direction,
    amountKrw,
    amountProvenance: "explicit_amount_krw",
  };
}

function closeTo(actual, expected, epsilon = 1e-12) {
  return Math.abs(actual - expected) <= epsilon;
}
