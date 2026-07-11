import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assessInvestmentLabCounterfactualReadiness,
  HISTORICAL_COUNTERFACTUAL_POLICY_GATES,
  LEGACY_COUNTERFACTUAL_PARITY_REJECTIONS,
} from "../src/lib/investment-lab-counterfactual-readiness.ts";
import { auditInvestmentLabCounterfactualEvidence } from "../scripts/lib/investment-lab-counterfactual-audit.mjs";

describe("investment lab historical counterfactual readiness", () => {
  it("maps a July 8 close into the July 9 service cycle", () => {
    const result = assessInvestmentLabCounterfactualReadiness(readinessInput());

    assert.equal(result.status, "ready_for_engine_fixture");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.productionEngineReady, false);
    assert.deepEqual(
      result.unresolvedPolicyGates,
      HISTORICAL_COUNTERFACTUAL_POLICY_GATES,
    );
  });

  it("allows bounded prior-close carry without looking ahead", () => {
    const result = assessInvestmentLabCounterfactualReadiness(
      readinessInput({ prices: { endDate: "2026-07-04" } }),
    );

    assert.equal(result.status, "ready_for_engine_fixture");
    assert.deepEqual(result.blockers, []);
  });

  it("blocks insufficient, colliding, invalid, or unreconciled snapshots", () => {
    const result = assessInvestmentLabCounterfactualReadiness(
      readinessInput({
        snapshots: {
          rowCount: 1,
          distinctDates: 1,
          duplicateDateGroups: 1,
          invalidRows: 1,
          reconciliationMismatchRows: 1,
        },
      }),
    );

    assert.deepEqual(result.blockers.slice(0, 4), [
      "insufficient_actual_snapshots",
      "actual_snapshot_date_collision",
      "invalid_actual_snapshot_values",
      "actual_snapshot_reconciliation_mismatch",
    ]);
  });

  it("fails closed for unresolved trade evidence and corrections", () => {
    const result = assessInvestmentLabCounterfactualReadiness(
      readinessInput({
        trades: {
          unresolvedAmountRows: 1,
          unknownAccountRows: 1,
          correctionRows: 1,
        },
      }),
    );

    assert.deepEqual(result.blockers, [
      "unresolved_trade_amounts",
      "unknown_trade_account",
      "event_correction_policy_required",
    ]);
  });

  it("blocks invalid scenario prices and uncovered service ranges", () => {
    const result = assessInvestmentLabCounterfactualReadiness(
      readinessInput({
        prices: {
          startDate: "2026-05-20",
          duplicateDateGroups: 1,
          invalidRows: 1,
        },
      }),
    );

    assert.deepEqual(result.blockers, [
      "scenario_price_date_collision",
      "invalid_scenario_prices",
      "scenario_price_coverage_gap",
    ]);
  });

  it("requires date-specific FX only for non-KRW scenarios", () => {
    const missingFx = assessInvestmentLabCounterfactualReadiness(
      readinessInput({ currency: "USD", fx: emptyRange() }),
    );
    const invalidFx = assessInvestmentLabCounterfactualReadiness(
      readinessInput({
        currency: "USD",
        fx: { duplicateDateGroups: 1, invalidRows: 1 },
      }),
    );

    assert.deepEqual(missingFx.blockers, [
      "insufficient_fx_history",
      "fx_coverage_gap",
    ]);
    assert.deepEqual(invalidFx.blockers, [
      "fx_date_collision",
      "invalid_fx_rows",
    ]);
  });

  it("freezes the legacy behaviors that must not be ported", () => {
    assert.deepEqual(LEGACY_COUNTERFACTUAL_PARITY_REJECTIONS, [
      "current_holdings_backcast_as_historical_actual",
      "hypothetical_initial_amount_without_trade_replay",
      "synthetic_series_stitched_to_actual_continuation",
      "full_window_optimizer_presented_as_investable",
      "ticker_only_instrument_identity",
      "fixed_or_fallback_fx_rate",
      "silent_common_history_trimming",
    ]);
  });

  it("uses canonical event account fallbacks without exposing raw evidence", () => {
    const result = auditInvestmentLabCounterfactualEvidence(auditFixture());
    const brokerage = result.accounts.find((row) => row.account === "brokerage");
    const all = result.accounts.find((row) => row.account === "all");

    assert.equal(brokerage.trades.rowCount, 1);
    assert.equal(brokerage.trades.unknownAccountRows, 0);
    assert.equal(all.kodex200.status, "ready_for_engine_fixture");
    assert.deepEqual(result.evidence.allSnapshotReconciliation, {
      storedRows: 1,
      derivedRows: 2,
      overlapDates: 1,
      mismatchDates: 0,
    });

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

  it("keeps the readiness audit read-only and provider-free", () => {
    const source = [
      "scripts/audit-investment-lab-counterfactual-readiness.mjs",
      "scripts/lib/investment-lab-counterfactual-data.mjs",
      "scripts/lib/investment-lab-counterfactual-sql.mjs",
      "scripts/lib/investment-lab-counterfactual-audit.mjs",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /\bfetch\s*\(/i);
    assert.doesNotMatch(source, /\/api\/|admin\/jobs|server action/i);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
  });
});

function readinessInput({
  currency = "KRW",
  snapshots = {},
  trades = {},
  prices = {},
  fx = {},
} = {}) {
  return {
    account: "all",
    snapshots: {
      ...range({ startDate: "2026-05-20", endDate: "2026-07-09" }),
      ...snapshots,
    },
    trades: {
      rowCount: 4,
      unresolvedAmountRows: 0,
      unknownAccountRows: 0,
      correctionRows: 0,
      ...trades,
    },
    scenario: {
      instrumentKey: `${currency === "KRW" ? "korea" : "us"}:${currency}:TEST`,
      currency,
      prices: {
        ...range({ startDate: "2022-10-17", endDate: "2026-07-08" }),
        ...prices,
      },
    },
    fx: {
      ...range({ startDate: "2026-05-19", endDate: "2026-07-08" }),
      ...fx,
    },
  };
}

function range({ startDate, endDate }) {
  return {
    rowCount: 27,
    distinctDates: 27,
    startDate,
    endDate,
    duplicateDateGroups: 0,
    invalidRows: 0,
    reconciliationMismatchRows: 0,
  };
}

function emptyRange() {
  return {
    rowCount: 0,
    distinctDates: 0,
    startDate: null,
    endDate: null,
    duplicateDateGroups: 0,
    invalidRows: 0,
    reconciliationMismatchRows: 0,
  };
}

function auditFixture() {
  const snapshotRows = ["brokerage", "isa", "irp", "all"].map((account) => ({
    account,
    row_count: 2,
    distinct_dates: 2,
    start_date: "2026-05-20",
    end_date: "2026-07-09",
    duplicate_date_groups: 0,
    invalid_rows: 0,
    reconciliation_mismatch_rows: 0,
    stored_all_rows: account === "all" ? 1 : null,
    derived_all_rows: account === "all" ? 2 : null,
    overlap_dates: account === "all" ? 1 : null,
  }));

  return {
    snapshotRows,
    tradeRows: [
      {
        event_date: "2026-07-01",
        account: null,
        asset_account: "brokerage",
        amount_resolved: true,
        is_correction: false,
        before_value: null,
        after_value: null,
      },
    ],
    priceRows: [
      {
        ticker: "069500",
        market: "korea",
        currency: "KRW",
        row_count: 27,
        distinct_dates: 27,
        start_date: "2022-10-17",
        end_date: "2026-07-08",
        duplicate_date_groups: 0,
        invalid_rows: 0,
      },
    ],
    fxRows: [
      { rate_date: "2026-05-19", valid: true },
      { rate_date: "2026-07-08", valid: true },
    ],
  };
}
