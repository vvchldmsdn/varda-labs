import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvestmentLabObservedHistory,
  unavailableInvestmentLabObservedHistory,
} from "../src/lib/investment-lab-observed-history-segments.ts";

const LEGACY_SOURCE = "base44_import";
const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const CURRENT_RULE = "varda-manual-daily-snapshot-v1";

describe("investment lab observed history segments", () => {
  it("sums named accounts and keeps a source transition disconnected", () => {
    const result = buildInvestmentLabObservedHistory([
      ...snapshotDate("2026-06-01", LEGACY_SOURCE, null, [100, 20, 10]),
      ...snapshotDate("2026-06-02", LEGACY_SOURCE, null, [105, 21, 11]),
      ...snapshotDate("2026-07-01", CURRENT_SOURCE, CURRENT_RULE, [110, 22, 12]),
      ...snapshotDate("2026-07-02", CURRENT_SOURCE, CURRENT_RULE, [115, 23, 13]),
    ]);

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.segmentCount, 2);
    assert.deepEqual(
      result.segments.map((segment) => ({
        role: segment.role,
        dates: segment.rows.map((row) => row.serviceDate),
        values: segment.rows.map((row) => row.totalMarketValueKrw),
      })),
      [
        {
          role: "legacy_display",
          dates: ["2026-06-01", "2026-06-02"],
          values: [130, 137],
        },
        {
          role: "current_writer",
          dates: ["2026-07-01", "2026-07-02"],
          values: [144, 151],
        },
      ],
    );
    assert.equal(result.policy.missingDates, "omit_without_interpolation");
    assert.equal(result.policy.calculationAuthority, "display_only");
  });

  it("scopes a named account without using other account values", () => {
    const result = buildInvestmentLabObservedHistory(
      [
        ...snapshotDate("2026-07-01", CURRENT_SOURCE, CURRENT_RULE, [110, 22, 12]),
        ...snapshotDate("2026-07-02", CURRENT_SOURCE, CURRENT_RULE, [115, 23, 13]),
      ],
      "isa",
    );

    assert.equal(result.account, "isa");
    assert.deepEqual(
      result.segments[0].rows.map((row) => row.totalMarketValueKrw),
      [22, 23],
    );
  });

  it("omits an incomplete date and does not bridge across the gap", () => {
    const incomplete = snapshotDate(
      "2026-06-02",
      LEGACY_SOURCE,
      null,
      [105, 21, 11],
    ).slice(0, 2);
    const result = buildInvestmentLabObservedHistory([
      ...snapshotDate("2026-06-01", LEGACY_SOURCE, null, [100, 20, 10]),
      ...incomplete,
      ...snapshotDate("2026-06-03", LEGACY_SOURCE, null, [110, 22, 12]),
    ]);

    assert.equal(result.status, "partial");
    assert.equal(result.coverage.skippedDateCount, 1);
    assert.equal(result.coverage.segmentCount, 2);
    assert.deepEqual(
      result.segments.map((segment) => segment.rows.map((row) => row.serviceDate)),
      [["2026-06-01"], ["2026-06-03"]],
    );
    assert.deepEqual(result.blockers, ["incomplete_account_axis"]);
  });

  it("rejects invalid current provenance and invalid values without inventing rows", () => {
    const invalidValue = snapshotDate(
      "2026-07-02",
      CURRENT_SOURCE,
      CURRENT_RULE,
      [115, 23, 13],
    );
    invalidValue[0] = { ...invalidValue[0], totalMarketValue: null };
    const result = buildInvestmentLabObservedHistory([
      ...snapshotDate("2026-07-01", CURRENT_SOURCE, null, [110, 22, 12]),
      ...invalidValue,
    ]);

    assert.equal(result.status, "unavailable");
    assert.equal(result.coverage.admittedDateCount, 0);
    assert.deepEqual(result.segments, []);
    assert.deepEqual(result.blockers, [
      "current_writer_provenance_invalid",
      "invalid_market_value",
    ]);
  });

  it("returns an explicit unavailable model when Fount exclusion is unresolved", () => {
    const result = unavailableInvestmentLabObservedHistory(
      "all",
      "fount_scope_adjustment_blocked",
    );

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.blockers, ["fount_scope_adjustment_blocked"]);
    assert.equal(result.segments.length, 0);
  });

  it("keeps exact Fount-adjusted dates visible while breaking blocked dates", () => {
    const result = buildInvestmentLabObservedHistory(
      [
        ...snapshotDate("2026-07-01", CURRENT_SOURCE, CURRENT_RULE, [110, 22, 12]),
        ...snapshotDate("2026-07-02", CURRENT_SOURCE, CURRENT_RULE, [115, 23, 13]),
        ...snapshotDate("2026-07-03", CURRENT_SOURCE, CURRENT_RULE, [120, 24, 14]),
      ],
      "irp",
      {
        forcedGapServiceDates: ["2026-07-02"],
        additionalBlockers: ["fount_scope_adjustment_blocked"],
      },
    );

    assert.equal(result.status, "partial");
    assert.equal(result.coverage.skippedDateCount, 1);
    assert.deepEqual(
      result.segments.map((segment) =>
        segment.rows.map((row) => row.serviceDate),
      ),
      [["2026-07-01"], ["2026-07-03"]],
    );
    assert.deepEqual(result.blockers, ["fount_scope_adjustment_blocked"]);
  });
});

function snapshotDate(snapshotDate, source, ruleVersion, values) {
  return ["brokerage", "isa", "irp"].map((account, index) => ({
    snapshotDate,
    account,
    totalMarketValue: values[index],
    source,
    ruleVersion,
  }));
}
