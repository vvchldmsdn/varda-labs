import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";
import {
  LEGACY_RECONSTRUCTION_CANDIDATE_SQL,
  loadInvestmentLabLegacyReconstructionCandidateEvidence,
} from "../scripts/lib/investment-lab-legacy-reconstruction-candidate-data.mjs";
import {
  LEGACY_RECONSTRUCTION_BLOCKERS,
  buildInvestmentLabLegacyReconstructionCandidateReport,
} from "../scripts/lib/investment-lab-legacy-reconstruction-candidate-report.mjs";

describe("investment lab legacy reconstructed-observed candidate", () => {
  it("accepts exact stored close and same-axis formula evidence without granting authority", () => {
    const report = buildInvestmentLabLegacyReconstructionCandidateReport({
      rows: [positionRow()],
    });

    assert.equal(report.status, "candidate_evidence_available");
    assert.equal(report.counts.candidateGroups, 1);
    assert.equal(report.byAccount.brokerage.candidateGroups, 1);
    assert.equal(report.evidence.exactPriceEvidenceRows, 1);
    assert.equal(report.authority.canonicalActualAuthority, "not_established");
    assert.equal(report.authority.runtimeTrustStatus, "not_established");
    assert.equal(report.authority.sameFlowCalculationAuthority, "blocked_event_timing_not_evaluated");
  });

  it("accepts prior-dated USD FX only with one exact stored ok row", () => {
    const report = buildInvestmentLabLegacyReconstructionCandidateReport({
      rows: [
        positionRow({
          market: "us",
          currency: "USD",
          effective_ticker: "QQQ",
          quantity: "1",
          close_price: "10",
          fx_rate: "1400",
          market_value_krw: "14000",
          portfolio_total_krw: "14000",
          position_description: "price_basis=close; price_source=kis@2026-01-02; fx_source=FxRate(2026-01-02)",
          described_fx_date: "2026-01-02",
          fx_reference_date: "2026-01-05",
          fx_date_match_count: 1,
          fx_value_match_count: 1,
          fx_usable_match_count: 1,
        }),
      ],
    });

    assert.equal(report.counts.candidateGroups, 1);
    assert.equal(report.evidence.priorDatedFxRows, 1);
    assert.equal(report.evidence.legacyFxReferenceFieldMismatchRows, 1);
    assert.equal(report.blockerGroups.usd_fx_source_not_durable, 0);
  });

  it("excludes Fount on the same axis without treating it as missing capital", () => {
    const fount = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
    const rows = [
      positionRow({
        account: fount.account,
        portfolio_total_krw: "2000",
        num_assets: 2,
      }),
      positionRow({
        portfolio_total_krw: "2000",
        num_assets: 2,
        position_legacy_id: "fount-position",
        legacy_asset_id: "fount-asset",
        effective_ticker: null,
        asset_name: fount.assetName,
        account: fount.account,
        market: fount.market,
        currency: fount.currency,
        asset_type: fount.assetType,
        quantity: null,
        close_price: null,
        fractional_krw_value: null,
        fx_rate: null,
        market_value_krw: "1000",
        reference_date: null,
        price_date: null,
        price_identity_match_count: 0,
        price_value_match_count: 0,
        price_source_match_count: 0,
      }),
    ];
    const report = buildInvestmentLabLegacyReconstructionCandidateReport({ rows });

    assert.equal(report.counts.candidateGroups, 1);
    assert.equal(report.evidence.fountExcludedRows, 1);
    assert.equal(report.blockerGroups.position_numeric_incomplete, 0);
    assert.equal(report.blockerGroups.portfolio_reconstruction_mismatch, 0);
  });

  it("keeps Gold and fallback prices as explicit blockers", () => {
    const gold = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
    const rows = [
      positionRow({
        portfolio_total_krw: "2000",
        num_assets: 2,
        price_basis: "fallback_current",
        price_source: "asset_current_price",
        position_description: "price_basis=fallback_current; fx_source=default",
      }),
      positionRow({
        portfolio_total_krw: "2000",
        num_assets: 2,
        position_legacy_id: "gold-position",
        legacy_asset_id: "gold-asset",
        effective_ticker: null,
        asset_name: gold.assetName,
        account: gold.account,
        market: gold.market,
        currency: gold.currency,
        asset_type: gold.assetType,
      }),
    ];
    const report = buildInvestmentLabLegacyReconstructionCandidateReport({ rows });

    assert.equal(report.status, "blocked");
    assert.equal(report.blockerGroups.fallback_price_marker, 1);
    assert.equal(report.blockerGroups.krx_gold_official_close_missing, 1);
  });

  it("does not expose raw dates, values, names, or identities", () => {
    const report = buildInvestmentLabLegacyReconstructionCandidateReport({
      rows: [
        positionRow({
          snapshot_date: "2099-12-31",
          asset_name: "secret-holding-marker",
          legacy_asset_id: "secret-identity-marker",
          portfolio_total_krw: "987654321",
          market_value_krw: "987654321",
        }),
      ],
    });
    const serialized = JSON.stringify(report);

    assert.equal(serialized.includes("2099-12-31"), false);
    assert.equal(serialized.includes("secret-holding-marker"), false);
    assert.equal(serialized.includes("secret-identity-marker"), false);
    assert.equal(serialized.includes("987654321"), false);
    assert.deepEqual(Object.keys(report.blockerGroups), LEGACY_RECONSTRUCTION_BLOCKERS);
  });

  it("loads one SELECT-only query without current assets, providers, or writes", async () => {
    const calls = [];
    const sql = {
      query(query, params) {
        calls.push({ query, params });
        return Promise.resolve([positionRow()]);
      },
    };

    const evidence = await loadInvestmentLabLegacyReconstructionCandidateEvidence(sql);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].query, LEGACY_RECONSTRUCTION_CANDIDATE_SQL);
    assert.equal(calls[0].query.trim().toLowerCase().startsWith("with"), true);
    assert.equal(calls[0].params, undefined);
    assert.equal(/\b(insert|update|delete|merge|alter|drop|create)\b/i.test(calls[0].query), false);
    assert.equal(/\bjoin\s+assets\b|current_price|live_price_quotes|provider/i.test(calls[0].query), false);
    assert.match(calls[0].query, /asset_price_snapshots/);
    assert.match(calls[0].query, /fx_rates/);
    assert.equal(evidence.rows.length, 1);
  });
});

function positionRow(overrides = {}) {
  return {
    snapshot_date: "2026-01-05",
    account: "brokerage",
    portfolio_source: "base44_import",
    portfolio_total_krw: "1000",
    cash_value_krw: "0",
    num_assets: 1,
    portfolio_captured_at: "2026-01-04T22:01:00.000Z",
    portfolio_cycle_start_at: "2026-01-03T22:00:00.000Z",
    portfolio_cycle_end_at: "2026-01-04T22:00:00.000Z",
    position_legacy_id: "position-1",
    legacy_asset_id: "asset-1",
    effective_ticker: "069500",
    identity_ticker_count: 1,
    asset_name: "KODEX 200",
    market: "korea",
    currency: "KRW",
    asset_type: "etf",
    price_source: "kis",
    price_basis: "close",
    position_description: "price_basis=close; price_source=kis@2026-01-02; fx_source=FxRate(2026-01-02)",
    quantity: "10",
    close_price: "100",
    fractional_krw_value: "0",
    fx_rate: "1",
    market_value_krw: "1000",
    price_date: "2026-01-02",
    reference_date: "2026-01-02",
    fx_reference_date: "2026-01-05",
    described_fx_date: "2026-01-02",
    position_captured_at: "2026-01-04T22:01:00.000Z",
    position_cycle_start_at: "2026-01-03T22:00:00.000Z",
    position_cycle_end_at: "2026-01-04T22:00:00.000Z",
    price_identity_match_count: 1,
    price_value_match_count: 1,
    price_source_match_count: 1,
    fx_date_match_count: 1,
    fx_value_match_count: 1,
    fx_usable_match_count: 1,
    ...overrides,
  };
}
