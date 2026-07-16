import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SOURCE_TRANSITION_ALL_RECONCILIATION_SQL,
  SOURCE_TRANSITION_AXIS_SQL,
  SOURCE_TRANSITION_CHANGES_SQL,
  SOURCE_TRANSITION_POSITION_BASIS_SQL,
  SOURCE_TRANSITION_RECONCILIATION_SQL,
  SOURCE_TRANSITION_SEGMENTS_SQL,
  loadInvestmentLabSourceTransitionEvidence,
} from "../scripts/lib/investment-lab-source-transition-data.mjs";
import {
  DEFAULT_SOURCE_TRANSITION_WRITER_REVIEW,
  buildInvestmentLabSourceTransitionReport,
} from "../scripts/lib/investment-lab-source-transition-report.mjs";

const LEGACY_SOURCE = "base44_import";
const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const ACCOUNTS = ["brokerage", "isa", "irp"];
const EQUIVALENT_WRITER_REVIEW = Object.freeze({
  reviewBasis: "synthetic_equivalent_writer_review",
  scope: "observed_total_market_value_path_only",
  sharedSemantics: Object.freeze(["synthetic_same_contract"]),
  conflicts: Object.freeze([]),
});

describe("investment lab source transition equivalence audit", () => {
  it("reports equivalent_proven only when code and stored evidence both agree", () => {
    const report = buildInvestmentLabSourceTransitionReport({
      evidence: readyEvidence(),
      fountReadiness: sourceTransitionOnlyFountReadiness(),
      writerReview: EQUIVALENT_WRITER_REVIEW,
    });

    assert.equal(report.status, "equivalent_proven");
    assert.equal(report.sourceEvidence.transitionAccountCount, 3);
    assert.equal(report.sourceEvidence.transitionDateCount, 1);
    assert.equal(report.axis.invalidDateCount, 0);
    assert.equal(report.reconciliation.namedPortfolioRows, 6);
    assert.equal(report.reconciliation.roundingToleranceReconciledRows, 6);
    assert.equal(report.eventBoundary.fountBindingAndEventBoundaryResolved, true);
    assert.deepEqual(report.blockers, []);

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(LEGACY_SOURCE), false);
    assert.equal(serialized.includes(CURRENT_SOURCE), false);
    assert.equal(serialized.includes("1000.000000"), false);
  });

  it("reports equivalence_unproven when required provenance is absent", () => {
    const evidence = readyEvidence();
    evidence.segmentRows = evidence.segmentRows.filter(
      (row) => row.source !== CURRENT_SOURCE,
    );

    const report = buildInvestmentLabSourceTransitionReport({
      evidence,
      fountReadiness: sourceTransitionOnlyFountReadiness(),
      writerReview: EQUIVALENT_WRITER_REVIEW,
    });

    assert.equal(report.status, "equivalence_unproven");
    assert.equal(
      report.unproven.includes("expected_source_segment_missing"),
      true,
    );
  });

  it("reports contradictory for the reviewed production writer contracts", () => {
    const report = buildInvestmentLabSourceTransitionReport({
      evidence: readyEvidence(),
      fountReadiness: sourceTransitionOnlyFountReadiness(),
    });

    assert.equal(report.status, "contradictory");
    assert.equal(
      report.contradictions.includes("writer_contract_contradictory"),
      true,
    );
    assert.deepEqual(
      report.writerContract.conflicts,
      DEFAULT_SOURCE_TRANSITION_WRITER_REVIEW.conflicts,
    );
  });

  it("fails closed for account conflicts, duplicate identities, and bad reconciliation", () => {
    const evidence = readyEvidence();
    evidence.axisRows[1] = {
      ...evidence.axisRows[1],
      named_row_count: 4,
    };
    evidence.reconciliationRows[0] = {
      ...evidence.reconciliationRows[0],
      position_total_krw: "500.000000",
      duplicate_identity_count: 1,
    };

    const report = buildInvestmentLabSourceTransitionReport({
      evidence,
      fountReadiness: sourceTransitionOnlyFountReadiness(),
      writerReview: EQUIVALENT_WRITER_REVIEW,
    });

    assert.equal(report.status, "contradictory");
    assert.equal(report.contradictions.includes("account_axis_conflict"), true);
    assert.equal(
      report.contradictions.includes("duplicate_position_identity_conflict"),
      true,
    );
    assert.equal(
      report.contradictions.includes("position_portfolio_reconciliation_conflict"),
      true,
    );
  });

  it("requires the Fount event boundary to be source-transition-only blocked", () => {
    const fountReadiness = sourceTransitionOnlyFountReadiness();
    fountReadiness.transformer.blockers = ["excluded_holding_event_present"];

    const report = buildInvestmentLabSourceTransitionReport({
      evidence: readyEvidence(),
      fountReadiness,
      writerReview: EQUIVALENT_WRITER_REVIEW,
    });

    assert.equal(report.status, "equivalence_unproven");
    assert.equal(
      report.unproven.includes("fount_event_or_binding_boundary_unproven"),
      true,
    );
  });

  it("loads only the six SELECT-only aggregate evidence queries", async () => {
    const fixture = readyEvidence();
    const rowsByQuery = new Map([
      [SOURCE_TRANSITION_SEGMENTS_SQL, fixture.segmentRows],
      [SOURCE_TRANSITION_AXIS_SQL, fixture.axisRows],
      [SOURCE_TRANSITION_CHANGES_SQL, fixture.transitionRows],
      [SOURCE_TRANSITION_RECONCILIATION_SQL, fixture.reconciliationRows],
      [SOURCE_TRANSITION_POSITION_BASIS_SQL, fixture.basisRows],
      [SOURCE_TRANSITION_ALL_RECONCILIATION_SQL, fixture.allRows],
    ]);
    const calls = [];
    const sql = {
      query(query, params) {
        calls.push({ query, params });
        return Promise.resolve(rowsByQuery.get(query));
      },
    };

    const evidence = await loadInvestmentLabSourceTransitionEvidence(sql);

    assert.equal(calls.length, 6);
    assert.equal(evidence.segmentRows.length, 6);
    for (const call of calls) {
      assert.equal(call.query.trim().toLowerCase().startsWith("with"), true);
      assert.equal(call.params, undefined);
      assert.equal(/\b(insert|update|delete|merge|alter|drop|create)\b/i.test(call.query), false);
    }
  });
});

function readyEvidence() {
  const segmentRows = [];
  for (const account of ACCOUNTS) {
    segmentRows.push(
      segment(LEGACY_SOURCE, account, {
        imported_identity_rows: 1,
        generated_identity_rows: 0,
        rule_version_rows: 0,
        start_date: "2026-01-01",
        end_date: "2026-01-01",
      }),
      segment(CURRENT_SOURCE, account, {
        imported_identity_rows: 0,
        generated_identity_rows: 1,
        rule_version_rows: 1,
        start_date: "2026-01-02",
        end_date: "2026-01-02",
      }),
    );
  }

  return {
    segmentRows,
    axisRows: [
      axis("2026-01-01", 1),
      axis("2026-01-02", 1),
    ],
    transitionRows: ACCOUNTS.map((account) => ({
      snapshot_date: "2026-01-02",
      account,
      previous_source: LEGACY_SOURCE,
      source: CURRENT_SOURCE,
    })),
    reconciliationRows: [
      ...ACCOUNTS.map((account) => reconciliation("2026-01-01", account, LEGACY_SOURCE)),
      ...ACCOUNTS.map((account) => reconciliation("2026-01-02", account, CURRENT_SOURCE)),
    ],
    basisRows: [basis(LEGACY_SOURCE, 3), basis(CURRENT_SOURCE, 3)],
    allRows: [
      {
        snapshot_date: "2026-01-01",
        derived_total_krw: "3000.000000",
        stored_row_count: 1,
        stored_total_krw: "3000.000000",
        stored_total_max_krw: "3000.000000",
      },
      {
        snapshot_date: "2026-01-02",
        derived_total_krw: "3000.000000",
        stored_row_count: 0,
        stored_total_krw: null,
        stored_total_max_krw: null,
      },
    ],
  };
}

function segment(source, account, overrides) {
  return {
    source,
    account,
    row_count: 1,
    date_count: 1,
    ...overrides,
  };
}

function axis(snapshotDate, sourceCount) {
  return {
    snapshot_date: snapshotDate,
    named_row_count: 3,
    account_count: 3,
    source_count: sourceCount,
    unknown_source_rows: 0,
  };
}

function reconciliation(snapshotDate, account, source) {
  return {
    snapshot_date: snapshotDate,
    account,
    source,
    portfolio_total_krw: "1000.000000",
    cash_value_krw: "0.000000",
    position_count: 1,
    position_total_krw: "1000.000000",
    duplicate_identity_count: 0,
  };
}

function basis(source, rows) {
  return {
    source,
    position_rows: rows,
    tickerless_rows: 0,
    tickered_non_close_rows: 0,
    missing_reference_date_rows: 0,
    missing_tickered_reference_date_rows: 0,
    missing_tickerless_reference_date_rows: 0,
    reference_price_date_mismatch_rows: 0,
    usd_rows: 1,
    invalid_usd_fx_rows: 0,
    missing_usd_fx_reference_rows: 0,
    legacy_fallback_marker_rows: 0,
  };
}

function sourceTransitionOnlyFountReadiness() {
  return {
    status: "blocked",
    binding: { exactBindingResolved: true },
    transformer: { blockers: ["portfolio_source_transition_unproven"] },
  };
}
