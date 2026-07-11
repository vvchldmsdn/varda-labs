import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_PATH_POLICY,
  buildInvestmentLabCounterfactualPath,
} from "../src/lib/investment-lab-counterfactual-path.ts";
import { scheduleInvestmentLabBoundaryFlows } from "../src/lib/investment-lab-execution-schedule.ts";
import { auditInvestmentLabCounterfactualPathEvidence } from "../scripts/lib/investment-lab-counterfactual-path-audit.mjs";

describe("investment lab deterministic counterfactual path", () => {
  it("replays exact KRW flows on the actual service-date axis", () => {
    const input = pathFixture();
    const result = buildInvestmentLabCounterfactualPath(input);

    assert.equal(result.status, "ready");
    assert.equal(result.policy.version, "position_flow_counterfactual_v1");
    assert.deepEqual(result.anchor, {
      serviceDate: "2026-01-02",
      actualMarketValueKrw: 1_000,
      valuationPriceDate: "2026-01-01",
      adjustedClose: 100,
      units: 10,
    });
    assert.deepEqual(
      result.rows.map((row) => ({
        date: row.serviceDate,
        value: row.investedMarketValueKrw,
        units: row.units,
        pendingBuy: row.pendingBuyCashKrw,
        pendingSell: row.pendingSellObligationKrw,
        applied: row.appliedFlowCount,
        basis: row.comparisonBasis,
      })),
      [
        {
          date: "2026-01-02",
          value: 1_000,
          units: 10,
          pendingBuy: 0,
          pendingSell: 0,
          applied: 0,
          basis: "position_value_only",
        },
        {
          date: "2026-01-05",
          value: 1_000,
          units: 10,
          pendingBuy: 220,
          pendingSell: 110,
          applied: 0,
          basis: "position_value_only_with_pending_flows",
        },
        {
          date: "2026-01-06",
          value: 1_210,
          units: 11,
          pendingBuy: 121,
          pendingSell: 0,
          applied: 2,
          basis: "position_value_only_with_pending_flows",
        },
        {
          date: "2026-01-07",
          value: 1_452,
          units: 12,
          pendingBuy: 0,
          pendingSell: 0,
          applied: 1,
          basis: "position_value_only",
        },
      ],
    );
    assert.deepEqual(
      result.appliedFlows.map((flow) => flow.amountProvenance),
      [
        "explicit_amount_krw",
        "derived_quantity_price_krw",
        "derived_quantity_price_fx",
      ],
    );
    assert.equal(result.pendingAtEnd.flowCount, 0);
  });

  it("treats anchor-date flows as already reflected in the anchor value", () => {
    const closes = [close("2026-01-01", 100), close("2026-01-02", 100)];
    const schedule = readySchedule(
      [flow("2026-01-02", 0, "inflow", 500)],
      closes,
    );
    const result = buildInvestmentLabCounterfactualPath({
      actualPath: actualPath(["2026-01-02", 1_000], ["2026-01-03", 1_000]),
      closes,
      scheduledFlows: schedule.scheduledFlows,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.ignoredFlows.throughAnchor, 1);
    assert.equal(result.appliedFlows.length, 0);
    assert.equal(result.rows.at(-1).units, 10);
  });

  it("preserves execution order and fails closed on long-only insolvency", () => {
    const closes = [close("2026-01-01", 100), close("2026-01-03", 100)];
    const actual = actualPath(["2026-01-02", 1_000], ["2026-01-04", 1_000]);
    const sellFirst = readySchedule(
      [
        flow("2026-01-03", 0, "outflow", 1_100),
        flow("2026-01-03", 1, "inflow", 200),
      ],
      closes,
    );
    const buyFirst = readySchedule(
      [
        flow("2026-01-03", 0, "inflow", 200),
        flow("2026-01-03", 1, "outflow", 1_100),
      ],
      closes,
    );

    const blocked = buildInvestmentLabCounterfactualPath({
      actualPath: actual,
      closes,
      scheduledFlows: sellFirst.scheduledFlows,
    });
    const ready = buildInvestmentLabCounterfactualPath({
      actualPath: actual,
      closes,
      scheduledFlows: buyFirst.scheduledFlows,
    });

    assert.deepEqual(blocked.blockers, [
      {
        reason: "scenario_insolvent",
        sourceIndex: 0,
        serviceDate: "2026-01-04",
      },
    ]);
    assert.deepEqual(blocked.rows, []);
    assert.equal(ready.status, "ready");
    assert.equal(ready.rows.at(-1).units, 1);
  });

  it("blocks missing or stale valuation evidence without looking ahead", () => {
    const missing = buildInvestmentLabCounterfactualPath({
      actualPath: actualPath(["2026-01-02", 1_000], ["2026-01-03", 1_000]),
      closes: [close("2026-01-03", 100)],
      scheduledFlows: [],
    });
    const stale = buildInvestmentLabCounterfactualPath({
      actualPath: actualPath(["2026-01-02", 1_000], ["2026-01-10", 1_000]),
      closes: [close("2026-01-01", 100)],
      scheduledFlows: [],
      maxValuationCarryDays: 3,
    });

    assert.equal(missing.blockers[0].reason, "missing_valuation_close");
    assert.equal(stale.blockers[0].reason, "valuation_carry_limit_exceeded");
  });

  it("rejects a tampered execution price or provenance", () => {
    const fixture = pathFixture();
    const tamperedPrice = {
      ...fixture.scheduledFlows[0],
      adjustedClose: fixture.scheduledFlows[0].adjustedClose + 1,
    };
    const tamperedProvenance = {
      ...fixture.scheduledFlows[0],
      amountProvenance: "latest_fx_fallback",
    };

    const priceResult = buildInvestmentLabCounterfactualPath({
      ...fixture,
      scheduledFlows: [tamperedPrice],
    });
    const provenanceResult = buildInvestmentLabCounterfactualPath({
      ...fixture,
      scheduledFlows: [tamperedProvenance],
    });

    assert.equal(priceResult.blockers[0].reason, "execution_close_mismatch");
    assert.equal(provenanceResult.blockers[0].reason, "invalid_scheduled_flow");
  });

  it("exposes a safe aggregate read-only production audit shape", () => {
    const result = auditInvestmentLabCounterfactualPathEvidence(auditFixture());

    assert.equal(result.status, "passed");
    assert.equal(result.path.rowCount, 4);
    assert.equal(result.path.appliedFlowRows, 3);
    assert.equal(result.path.pendingComparisonRows, 2);
    assert.deepEqual(result.input.amountProvenanceDistribution, {
      derived_quantity_price_fx: 1,
      derived_quantity_price_krw: 1,
      explicit_amount_krw: 1,
    });

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /actualMarketValueKrw|amountKrw|unitsAfter/);
    assert.doesNotMatch(serialized, /authorization|api[_-]?key|password|secret|token|subject/i);
  });

  it("keeps the path audit free of providers, writes, and product routes", () => {
    const source = [
      "scripts/audit-investment-lab-counterfactual-path.mjs",
      "scripts/lib/investment-lab-counterfactual-path-audit.mjs",
      "scripts/lib/investment-lab-event-flow-data.mjs",
      "scripts/lib/investment-lab-event-flow-sql.mjs",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /\bfetch\s*\(|\/api\/|admin\/jobs/i);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
  });

  it("keeps TWR and execution costs outside this first path fixture", () => {
    assert.equal(INVESTMENT_LAB_PATH_POLICY.cashflowAdjustedReturn, "deferred_until_cashflow_fixture");
    assert.equal(INVESTMENT_LAB_PATH_POLICY.transactionCostsKrw, 0);
    assert.equal(INVESTMENT_LAB_PATH_POLICY.fractionalUnits, true);
  });
});

function pathFixture() {
  const closes = [
    close("2026-01-01", 100),
    close("2026-01-05", 110),
    close("2026-01-06", 121),
  ];
  const schedule = readySchedule(
    [
      flow("2026-01-03", 0, "inflow", 220, "explicit_amount_krw"),
      flow(
        "2026-01-04",
        1,
        "outflow",
        110,
        "derived_quantity_price_krw",
      ),
      flow(
        "2026-01-06",
        2,
        "inflow",
        121,
        "derived_quantity_price_fx",
      ),
    ],
    closes,
  );

  return {
    actualPath: actualPath(
      ["2026-01-02", 1_000],
      ["2026-01-05", 1_050],
      ["2026-01-06", 1_100],
      ["2026-01-07", 1_150],
    ),
    closes,
    scheduledFlows: schedule.scheduledFlows,
  };
}

function auditFixture() {
  const fixture = pathFixture();
  return {
    eventRows: fixture.scheduledFlows.map((row, index) => ({
      event_type: row.direction === "inflow" ? "buy" : "sell",
      event_date: row.eventDate,
      sequence: index,
      resolved_amount_krw: row.amountKrw,
      amount_provenance: row.amountProvenance,
      amount_resolved: true,
      is_correction: false,
    })),
    closeRows: fixture.closes.map((row) => ({
      price_date: row.priceDate,
      adjusted_close_price: row.adjustedClose,
    })),
    actualPathRows: fixture.actualPath.map((row) => ({
      service_date: row.serviceDate,
      total_market_value_krw: row.totalMarketValueKrw,
    })),
  };
}

function readySchedule(events, closes) {
  const schedule = scheduleInvestmentLabBoundaryFlows({
    events,
    closes,
    windowEndPriceDate: closes.at(-1).priceDate,
  });
  assert.equal(schedule.status, "ready");
  return schedule;
}

function actualPath(...rows) {
  return rows.map(([serviceDate, totalMarketValueKrw]) => ({
    serviceDate,
    totalMarketValueKrw,
  }));
}

function flow(
  eventDate,
  sequence,
  direction,
  amountKrw,
  amountProvenance = "explicit_amount_krw",
) {
  return {
    eventDate,
    sequence,
    direction,
    amountKrw,
    amountProvenance,
  };
}

function close(priceDate, adjustedClose) {
  return { priceDate, adjustedClose };
}
