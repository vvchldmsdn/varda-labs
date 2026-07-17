import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  listInvestmentLabCompleteSnapshotDates,
  resolveInvestmentLabSourceSegmentAuthority,
} from "../src/lib/investment-lab-source-segment-authority.ts";

const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const LEGACY_SOURCE = "base44_import";
const CURRENT_RULE = "varda-manual-daily-snapshot-v1";

describe("investment lab source segment authority", () => {
  it("admits only an all-current selected source axis", () => {
    const result = resolveInvestmentLabSourceSegmentAuthority([
      ...snapshotDate("2026-07-09", CURRENT_SOURCE, CURRENT_RULE),
      ...snapshotDate("2026-07-10", CURRENT_SOURCE, CURRENT_RULE),
    ]);

    assert.equal(result.status, "eligible");
    assert.equal(result.decision, "current_writer_calculation_candidate");
    assert.equal(result.coverage.completeDateCount, 2);
    assert.equal(result.coverage.currentWriterDateCount, 2);
    assert.equal(result.coverage.sourceTransitionCount, 0);
    assert.deepEqual(result.blockers, []);
  });

  it("keeps a legacy-only segment display-only", () => {
    const result = resolveInvestmentLabSourceSegmentAuthority([
      ...snapshotDate("2026-06-01", LEGACY_SOURCE, null),
      ...snapshotDate("2026-06-02", LEGACY_SOURCE, null),
    ]);

    assert.equal(result.status, "blocked");
    assert.equal(result.decision, "legacy_display_only");
    assert.deepEqual(result.blockers, ["legacy_segment_display_only"]);
  });

  it("forbids a legacy-current splice without returning raw provenance", () => {
    const result = resolveInvestmentLabSourceSegmentAuthority([
      ...snapshotDate("2026-06-30", LEGACY_SOURCE, null),
      ...snapshotDate("2026-07-01", CURRENT_SOURCE, CURRENT_RULE),
    ]);

    assert.equal(result.status, "blocked");
    assert.equal(result.coverage.sourceTransitionCount, 1);
    assert.deepEqual(result.blockers, ["source_splice_forbidden"]);

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(LEGACY_SOURCE), false);
    assert.equal(serialized.includes(CURRENT_SOURCE), false);
    assert.equal(serialized.includes("2026-06-30"), false);
  });

  it("blocks same-date conflicts, incomplete axes, and invalid writer provenance", () => {
    const conflicting = snapshotDate("2026-07-09", CURRENT_SOURCE, CURRENT_RULE);
    conflicting[2] = {
      ...conflicting[2],
      source: LEGACY_SOURCE,
      ruleVersion: null,
    };
    const incomplete = snapshotDate("2026-07-10", CURRENT_SOURCE, CURRENT_RULE)
      .slice(0, 2);
    const invalidRule = snapshotDate("2026-07-11", CURRENT_SOURCE, null);

    const result = resolveInvestmentLabSourceSegmentAuthority([
      ...conflicting,
      ...incomplete,
      ...invalidRule,
    ]);

    assert.equal(result.status, "blocked");
    assert.equal(result.coverage.conflictingSourceDateCount, 1);
    assert.equal(result.coverage.incompleteDateCount, 1);
    assert.equal(
      result.blockers.includes("current_writer_provenance_invalid"),
      true,
    );
    assert.equal(result.blockers.includes("same_date_source_conflict"), true);
    assert.equal(result.blockers.includes("source_axis_incomplete"), true);
  });

  it("lists exact named-account dates independently from calculation authority", () => {
    const duplicate = snapshotDate("2026-07-11", CURRENT_SOURCE, CURRENT_RULE);
    duplicate.push({ ...duplicate[0] });
    const dates = listInvestmentLabCompleteSnapshotDates([
      ...snapshotDate("2026-07-09", LEGACY_SOURCE, null),
      ...snapshotDate("2026-07-10", CURRENT_SOURCE, CURRENT_RULE),
      ...duplicate,
    ]);

    assert.deepEqual(dates, ["2026-07-09", "2026-07-10"]);
  });
});

function snapshotDate(snapshotDate, source, ruleVersion) {
  return ["brokerage", "isa", "irp"].map((account) => ({
    snapshotDate,
    account,
    source,
    ruleVersion,
  }));
}
