import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyInvestmentLabEvent,
  INVESTMENT_LAB_MEASUREMENT_BOUNDARY,
} from "../src/lib/investment-lab-event-flow.ts";
import {
  applyInvestmentLabScheduledFlow,
  INVESTMENT_LAB_EXECUTION_POLICY,
  scheduleInvestmentLabBoundaryFlows,
} from "../src/lib/investment-lab-execution-schedule.ts";
import { auditInvestmentLabEventFlowEvidence } from "../scripts/lib/investment-lab-event-flow-audit.mjs";

describe("investment lab event-flow semantics", () => {
  it("treats buy and sell as invested-position boundary flows", () => {
    assert.deepEqual(
      classifyInvestmentLabEvent({ eventType: " BUY ", amountResolved: true }),
      {
        eventType: "buy",
        category: "invested_boundary_flow",
        direction: "inflow",
        includedInV1: true,
        reason: "invested_positions_exclude_cash",
      },
    );
    assert.equal(
      classifyInvestmentLabEvent({ eventType: "sell", amountResolved: true })
        .direction,
      "outflow",
    );
  });

  it("keeps cash-ledger and position metadata events outside the v1 path", () => {
    for (const eventType of ["deposit", "withdrawal"]) {
      const result = classifyInvestmentLabEvent({
        eventType,
        amountResolved: true,
      });
      assert.equal(result.category, "cash_ledger_only");
      assert.equal(result.includedInV1, false);
    }
    for (const eventType of ["asset_added", "asset_removed"]) {
      assert.equal(
        classifyInvestmentLabEvent({ eventType, amountResolved: false }).category,
        "position_metadata",
      );
    }
  });

  it("fails closed for unresolved, corrected, or unknown trade evidence", () => {
    assert.equal(
      classifyInvestmentLabEvent({ eventType: "buy", amountResolved: false })
        .reason,
      "amount_unresolved",
    );
    assert.equal(
      classifyInvestmentLabEvent({
        eventType: "sell",
        amountResolved: true,
        isCorrection: true,
      }).reason,
      "correction_policy_required",
    );
    assert.equal(
      classifyInvestmentLabEvent({ eventType: "dividend", amountResolved: true })
        .reason,
      "event_type_unsupported",
    );
  });

  it("executes on a same-day adjusted close and maps the service date", () => {
    const result = scheduleInvestmentLabBoundaryFlows({
      events: [flow("2026-07-08", 0, "inflow", 100_000)],
      closes: [close("2026-07-08", 50_000)],
      windowEndPriceDate: "2026-07-08",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.sameDayFlowCount, 1);
    assert.deepEqual(result.scheduledFlows[0], {
      ...flow("2026-07-08", 0, "inflow", 100_000),
      sourceIndex: 0,
      executionPriceDate: "2026-07-08",
      executionServiceDate: "2026-07-09",
      adjustedClose: 50_000,
      pendingCalendarDays: 0,
    });
  });

  it("holds a weekend event pending until the first later close", () => {
    const result = scheduleInvestmentLabBoundaryFlows({
      events: [flow("2026-07-11", 0, "inflow", 100_000)],
      closes: [close("2026-07-10", 49_000), close("2026-07-13", 50_000)],
      windowEndPriceDate: "2026-07-13",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.pendingFlowCount, 1);
    assert.equal(result.scheduledFlows[0].executionPriceDate, "2026-07-13");
    assert.equal(result.scheduledFlows[0].pendingCalendarDays, 2);
  });

  it("preserves same-date event order and never nets flows", () => {
    const result = scheduleInvestmentLabBoundaryFlows({
      events: [
        flow("2026-07-11", 2, "inflow", 300),
        flow("2026-07-11", 1, "outflow", 200),
      ],
      closes: [close("2026-07-13", 100)],
      windowEndPriceDate: "2026-07-13",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.scheduledFlows.length, 2);
    assert.deepEqual(
      result.scheduledFlows.map((row) => [row.sequence, row.direction]),
      [[1, "outflow"], [2, "inflow"]],
    );
  });

  it("blocks pre-inception gaps and events without an executable close", () => {
    const tooLong = scheduleInvestmentLabBoundaryFlows({
      events: [flow("2026-06-01", 0, "inflow", 100)],
      closes: [close("2026-06-15", 100)],
      windowEndPriceDate: "2026-06-15",
    });
    const noClose = scheduleInvestmentLabBoundaryFlows({
      events: [flow("2026-07-09", 0, "outflow", 100)],
      closes: [close("2026-07-08", 100)],
      windowEndPriceDate: "2026-07-09",
    });

    assert.deepEqual(tooLong.blockers, [
      { reason: "pending_limit_exceeded", sourceIndex: 0 },
    ]);
    assert.deepEqual(noClose.blockers, [
      { reason: "unexecutable_trade_before_window_end", sourceIndex: 0 },
    ]);
  });

  it("blocks malformed events, closes, and duplicate close dates", () => {
    const result = scheduleInvestmentLabBoundaryFlows({
      events: [
        flow("bad-date", -1, "inflow", -1),
        flow("2026-07-07", 0, "sideways", 1),
      ],
      closes: [close("2026-07-08", 100), close("2026-07-08", 101)],
      windowEndPriceDate: "bad-date",
      maxPendingCalendarDays: -1,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(
      result.blockers.map((row) => row.reason),
      [
        "invalid_window_end",
        "duplicate_close_date",
        "invalid_event_date",
        "invalid_event_direction",
        "invalid_pending_limit",
      ],
    );
    assert.deepEqual(result.scheduledFlows, []);
  });

  it("applies long-only flows and blocks an insolvent sell", () => {
    const bought = applyInvestmentLabScheduledFlow(1, {
      direction: "inflow",
      amountKrw: 200,
      adjustedClose: 100,
    });
    const sold = applyInvestmentLabScheduledFlow(bought.units, {
      direction: "outflow",
      amountKrw: 150,
      adjustedClose: 100,
    });
    const insolvent = applyInvestmentLabScheduledFlow(1, {
      direction: "outflow",
      amountKrw: 101,
      adjustedClose: 100,
    });
    const invalid = applyInvestmentLabScheduledFlow(1, {
      direction: "sideways",
      amountKrw: 100,
      adjustedClose: 100,
    });

    assert.deepEqual(bought, { status: "applied", reason: null, units: 3 });
    assert.deepEqual(sold, { status: "applied", reason: null, units: 1.5 });
    assert.deepEqual(insolvent, {
      status: "blocked",
      reason: "scenario_insolvent",
      units: null,
    });
    assert.deepEqual(invalid, {
      status: "blocked",
      reason: "invalid_execution_state",
      units: null,
    });
  });

  it("projects aggregate audit counts without identifiers or financial values", () => {
    const result = auditInvestmentLabEventFlowEvidence(auditFixture());

    assert.deepEqual(result.measurementBoundary, INVESTMENT_LAB_MEASUREMENT_BOUNDARY);
    assert.deepEqual(result.executionPolicy, INVESTMENT_LAB_EXECUTION_POLICY);
    assert.deepEqual(result.events.typeDistribution, {
      asset_added: 1,
      buy: 1,
      deposit: 1,
      sell: 1,
    });
    assert.equal(result.kodex200Execution.scheduledRows, 2);
    assert.equal(result.kodex200Execution.pendingRows, 1);

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
    assert.doesNotMatch(
      serialized,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    assert.doesNotMatch(
      serialized,
      /authorization|api[_-]?key|password|secret|token|subject/i,
    );
  });

  it("keeps the production audit read-only and provider-free", () => {
    const source = [
      "scripts/audit-investment-lab-event-flow.mjs",
      "scripts/lib/investment-lab-event-flow-audit.mjs",
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
});

function flow(eventDate, sequence, direction, amountKrw) {
  return { eventDate, sequence, direction, amountKrw };
}

function close(priceDate, adjustedClose) {
  return { priceDate, adjustedClose };
}

function auditFixture() {
  return {
    eventRows: [
      eventRow("buy", "2026-07-10", 1, 100),
      eventRow("sell", "2026-07-11", 2, 50),
      eventRow("deposit", "2026-07-11", 3, 50),
      eventRow("asset_added", "2026-07-11", 4, null),
    ],
    closeRows: [
      { price_date: "2026-07-10", adjusted_close_price: "100" },
      { price_date: "2026-07-13", adjusted_close_price: "101" },
    ],
    snapshot: {
      row_count: 4,
      nonzero_cash_rows: 0,
      positive_market_value_rows: 4,
    },
  };
}

function eventRow(eventType, eventDate, sequence, amount) {
  return {
    event_type: eventType,
    event_date: eventDate,
    sequence,
    resolved_amount_krw: amount,
    amount_resolved: amount !== null,
    is_correction: false,
  };
}
