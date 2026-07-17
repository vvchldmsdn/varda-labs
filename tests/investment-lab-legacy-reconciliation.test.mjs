import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_RECONCILIATION_EVIDENCE_SQL,
  loadInvestmentLabLegacyReconciliationEvidence,
} from "../scripts/lib/investment-lab-legacy-reconciliation-data.mjs";
import {
  LEGACY_RECONCILIATION_CLASSES,
  buildInvestmentLabLegacyReconciliationReport,
} from "../scripts/lib/investment-lab-legacy-reconciliation-report.mjs";

const ESTABLISHED_ROUNDING_EVIDENCE = Object.freeze({
  status: "established",
  policyId: "synthetic_independent_whole_krw_rounding_v1",
  portfolioRoundedOnce: true,
  positionsRoundedIndividually: true,
});

describe("investment lab legacy reconciliation evidence classification", () => {
  it("keeps evidence classes mutually exclusive and count-complete", () => {
    const rows = [
      row(),
      row({ portfolio_total_krw: "1001.000000", missing_value_rows: 1, valued_position_count: 1 }),
      row({ portfolio_total_krw: "1002.000000", duplicate_identity_count: 1 }),
      row({ portfolio_total_krw: "1003.000000", num_assets: 3 }),
      row({ portfolio_total_krw: "1004.000000", tickered_non_close_rows: 1 }),
      row({ portfolio_total_krw: "1005.000000", incomplete_usd_fx_rows: 1 }),
      row({ portfolio_total_krw: "1100.000000" }),
    ];

    const report = buildInvestmentLabLegacyReconciliationReport({ rows });

    assert.equal(report.status, "classified");
    assert.equal(report.rowAssignmentComplete, true);
    assert.equal(report.provenanceResolution.status, "not_established");
    assert.equal(report.provenanceResolution.unresolvedEvidenceRows, 1);
    assert.equal(
      report.provenanceResolution.canonicalCalculationAuthority,
      "not_established",
    );
    assert.equal(report.counts.legacyRows, 7);
    assert.equal(report.counts.exactRows, 1);
    assert.equal(report.counts.classifiedNonExactRows, 6);
    assert.equal(report.classes.position_value_incomplete, 1);
    assert.equal(report.classes.duplicate_explicit_position_identity, 1);
    assert.equal(report.classes.portfolio_membership_count_conflict, 1);
    assert.equal(report.classes.tickered_non_close_basis, 1);
    assert.equal(report.classes.usd_fx_reference_incomplete, 1);
    assert.equal(report.classes.unclassified, 1);
    assert.equal(
      Object.values(report.classes).reduce((sum, count) => sum + count, 0),
      6,
    );
    assert.deepEqual(Object.keys(report.classes), LEGACY_RECONCILIATION_CLASSES);
  });

  it("accepts rounding-only only with explicit rule evidence and clean integer rows", () => {
    const candidate = row({ portfolio_total_krw: "1001.000000" });

    const unestablished = buildInvestmentLabLegacyReconciliationReport({ rows: [candidate] });
    const established = buildInvestmentLabLegacyReconciliationReport({
      rows: [candidate],
      roundingEvidence: ESTABLISHED_ROUNDING_EVIDENCE,
    });

    assert.equal(unestablished.counts.roundingOnlyRows, 0);
    assert.equal(unestablished.counts.roundingRuleUnprovenSmallDeltaRows, 1);
    assert.equal(unestablished.classes.rounding_rule_unproven_small_delta, 1);
    assert.equal(established.counts.roundingOnlyRows, 1);
    assert.equal(established.counts.classifiedNonExactRows, 0);
  });

  it("does not use a small delta to hide structural evidence", () => {
    const report = buildInvestmentLabLegacyReconciliationReport({
      rows: [row({ portfolio_total_krw: "1001.000000", num_assets: 3 })],
      roundingEvidence: ESTABLISHED_ROUNDING_EVIDENCE,
    });

    assert.equal(report.counts.roundingOnlyRows, 0);
    assert.equal(report.classes.portfolio_membership_count_conflict, 1);
  });

  it("does not coerce missing counts to zero or accept an empty audit", () => {
    const missingCount = buildInvestmentLabLegacyReconciliationReport({
      rows: [row({ portfolio_total_krw: "1100.000000", num_assets: null })],
    });
    const empty = buildInvestmentLabLegacyReconciliationReport({ rows: [] });

    assert.equal(missingCount.classes.portfolio_membership_evidence_incomplete, 1);
    assert.equal(empty.status, "unavailable");
    assert.equal(empty.rowAssignmentComplete, false);
  });

  it("keeps raw evidence and special-holding attribution out of output", () => {
    const report = buildInvestmentLabLegacyReconciliationReport({
      rows: [
        row({
          snapshot_date: "2099-12-31",
          account: "secret-account-marker",
          portfolio_total_krw: "123456.000000",
          position_total_krw: "120000.000000",
        }),
      ],
    });
    const serialized = JSON.stringify(report);

    assert.equal(serialized.includes("2099-12-31"), false);
    assert.equal(serialized.includes("secret-account-marker"), false);
    assert.equal(serialized.includes("123456.000000"), false);
    assert.equal(serialized.includes("base44_import"), false);
    assert.equal(report.sourceTransition.status, "remains_contradictory");
    assert.equal(report.sourceTransition.authorityEffect, "none");
    assert.match(report.specialHoldingBoundaries.fount, /separate/);
    assert.match(report.specialHoldingBoundaries.krxGold, /separate/);
  });

  it("loads one SELECT-only snapshot-native query without current assets or providers", async () => {
    const calls = [];
    const sql = {
      query(query, params) {
        calls.push({ query, params });
        return Promise.resolve([row()]);
      },
    };

    const evidence = await loadInvestmentLabLegacyReconciliationEvidence(sql);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].query, LEGACY_RECONCILIATION_EVIDENCE_SQL);
    assert.equal(calls[0].query.trim().toLowerCase().startsWith("with"), true);
    assert.equal(calls[0].params, undefined);
    assert.equal(/\b(insert|update|delete|merge|alter|drop|create)\b/i.test(calls[0].query), false);
    assert.equal(/\bjoin\s+assets\b/i.test(calls[0].query), false);
    assert.equal(/current_price|provider|asset_name/i.test(calls[0].query), false);
    assert.equal(evidence.rows.length, 1);
  });
});

function row(overrides = {}) {
  return {
    snapshot_date: "2026-01-01",
    account: "brokerage",
    portfolio_total_krw: "1000.000000",
    cash_value_krw: "0.000000",
    num_assets: 2,
    position_count: 2,
    valued_position_count: 2,
    position_total_krw: "1000.000000",
    missing_value_rows: 0,
    fractional_value_rows: 0,
    missing_legacy_identity_rows: 0,
    tickered_non_close_rows: 0,
    missing_tickered_reference_date_rows: 0,
    incomplete_usd_fx_rows: 0,
    duplicate_identity_count: 0,
    ...overrides,
  };
}
