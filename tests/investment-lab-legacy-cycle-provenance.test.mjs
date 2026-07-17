import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_CYCLE_PROVENANCE_CLASSES,
  buildInvestmentLabLegacyCycleProvenanceReport,
} from "../scripts/lib/investment-lab-legacy-cycle-provenance-report.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("investment lab legacy cycle provenance classification", () => {
  it("classifies an exact 07:00 KST writer cycle as consistent", () => {
    const report = buildInvestmentLabLegacyCycleProvenanceReport({
      rows: [cycleRow()],
    });

    assert.equal(report.status, "classified");
    assert.equal(report.classes.consistent, 1);
    assert.equal(report.diagnostics.exactExpectedWindowGroups, 1);
    assert.equal(report.authorityEffect.canonicalActualAuthority, "none");
  });

  it("classifies a later update near captured time as replay evidence", () => {
    const captured = "2026-01-05T22:01:00.000Z";
    const report = buildInvestmentLabLegacyCycleProvenanceReport({
      rows: [
        cycleRow({
          portfolio_captured_at: captured,
          portfolio_base44_updated_at: captured,
          position_captured_at: captured,
          position_source_created_at: captured,
          position_base44_updated_at: captured,
        }),
      ],
    });

    assert.equal(report.classes.late_or_replayed, 1);
    assert.equal(report.diagnostics.replayLifecycleEvidenceGroups, 1);
  });

  it("separates a nine-hour shift from a whole-day writer variant", () => {
    const timezoneShift = shiftWindow(cycleRow(), 9 * HOUR_MS);
    const writerVariant = shiftWindow(cycleRow(), -DAY_MS);
    const report = buildInvestmentLabLegacyCycleProvenanceReport({
      rows: [
        timezoneShift,
        {
          ...writerVariant,
          account: "isa",
          position_legacy_id: "position-isa",
          legacy_asset_id: "asset-isa",
        },
      ],
    });

    assert.equal(report.classes.timezone_normalization_conflict, 1);
    assert.equal(report.classes.writer_contract_variant, 1);
    assert.equal(report.diagnostics.shiftedNineHourWindowGroups, 1);
    assert.equal(report.diagnostics.shiftedWholeDayWindowGroups, 1);
  });

  it("keeps missing provenance and internally mixed windows distinct", () => {
    const missing = cycleRow({ portfolio_base44_updated_at: null });
    const mixed = cycleRow({
      account: "irp",
      position_legacy_id: "position-irp",
      legacy_asset_id: "asset-irp",
      position_cycle_end_at: "2026-01-04T23:00:00.000Z",
    });
    const report = buildInvestmentLabLegacyCycleProvenanceReport({
      rows: [missing, mixed],
    });

    assert.equal(report.classes.metadata_missing, 1);
    assert.equal(report.classes.contradictory, 1);
    assert.equal(report.diagnostics.missingLifecycleMetadataGroups, 1);
    assert.equal(report.diagnostics.missingBase44LifecycleGroups, 1);
    assert.equal(report.diagnostics.internallyMixedWindowGroups, 1);
  });

  it("assigns every group once and exposes no raw lifecycle values", () => {
    const report = buildInvestmentLabLegacyCycleProvenanceReport({
      rows: [cycleRow({ asset_name: "secret-marker" })],
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.counts.accountDateGroups, 1);
    assert.equal(report.counts.classifiedGroups, 1);
    assert.equal(serialized.includes("2026-01-05"), false);
    assert.equal(serialized.includes("secret-marker"), false);
    assert.deepEqual(Object.keys(report.classes), LEGACY_CYCLE_PROVENANCE_CLASSES);
  });
});

function cycleRow(overrides = {}) {
  return {
    snapshot_date: "2026-01-05",
    account: "brokerage",
    portfolio_rule_version: "cycle-v2-2026-01-05",
    portfolio_description:
      "snapshot_status=complete; valuation_basis=close_price; fx_source=FxRate(2026-01-02)",
    portfolio_captured_at: "2026-01-04T22:01:00.000Z",
    portfolio_cycle_start_at: "2026-01-03T22:00:00.000Z",
    portfolio_cycle_end_at: "2026-01-04T22:00:00.000Z",
    portfolio_base44_created_at: "2026-01-04T22:01:01.000Z",
    portfolio_base44_updated_at: "2026-01-04T22:01:02.000Z",
    position_legacy_id: "position-1",
    legacy_asset_id: "asset-1",
    position_description:
      "price_basis=close; price_source=kis@2026-01-02; fx_source=FxRate(2026-01-02)",
    position_captured_at: "2026-01-04T22:01:00.000Z",
    position_cycle_start_at: "2026-01-03T22:00:00.000Z",
    position_cycle_end_at: "2026-01-04T22:00:00.000Z",
    position_source_created_at: "2026-01-04T22:01:00.000Z",
    position_base44_created_at: "2026-01-04T22:01:01.000Z",
    position_base44_updated_at: "2026-01-04T22:01:02.000Z",
    ...overrides,
  };
}

function shiftWindow(row, offsetMs) {
  const cycleStart = shift(row.portfolio_cycle_start_at, offsetMs);
  const cycleEnd = shift(row.portfolio_cycle_end_at, offsetMs);
  const captured = shift(row.portfolio_captured_at, offsetMs);
  return {
    ...row,
    portfolio_cycle_start_at: cycleStart,
    portfolio_cycle_end_at: cycleEnd,
    portfolio_captured_at: captured,
    portfolio_base44_created_at: shift(row.portfolio_base44_created_at, offsetMs),
    portfolio_base44_updated_at: shift(row.portfolio_base44_updated_at, offsetMs),
    position_cycle_start_at: cycleStart,
    position_cycle_end_at: cycleEnd,
    position_captured_at: captured,
    position_source_created_at: captured,
    position_base44_created_at: shift(row.position_base44_created_at, offsetMs),
    position_base44_updated_at: shift(row.position_base44_updated_at, offsetMs),
  };
}

function shift(value, offsetMs) {
  return new Date(new Date(value).getTime() + offsetMs).toISOString();
}
