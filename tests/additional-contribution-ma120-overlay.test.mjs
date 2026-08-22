import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY,
  compareAdditionalContributionMa120Overlay,
} from "../src/lib/additional-contribution-ma120-overlay.ts";

describe("additional contribution MA120 bounded overlay", () => {
  it("keeps the strategic baseline exact when the overlay is off", () => {
    const baseline = strategicBaseline();
    const result = compareAdditionalContributionMa120Overlay({
      mode: "off",
      serviceDate: "2026-08-12",
      baseline,
      evidence: [evidence("AAA", "below_ma", -10)],
    });

    assert.equal(result.status, "disabled");
    assert.equal(result.baseline, baseline);
    assert.equal(result.overlayAllocatedKrw, 3_000);
    assert.equal(result.overlayResidualCashKrw, 0);
    assert.ok(result.rows.every((row) => row.multiplier === 1));
  });

  it("applies a linear buffer and a bounded 50 percent floor", () => {
    const result = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: strategicBaseline(),
      evidence: [
        evidence("AAA", "below_ma", -1.5),
        evidence("BBB", "below_ma", -4),
        evidence("CCC", "above_ma", 2),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.rows.map((row) => [
        row.ticker,
        row.multiplier,
        row.overlayAllocationKrw,
        row.decision,
      ]),
      [
        ["AAA", 0.75, 1_332, "below_ma_buffer"],
        ["BBB", 0.5, 613, "below_ma_floor"],
        ["CCC", 1, 0, "above_or_at_ma"],
      ],
    );
    assert.equal(result.overlayAllocatedKrw, 1_945);
    assert.equal(result.totalReductionKrw, 1_055);
    assert.equal(result.overlayResidualCashKrw, 1_055);
    assert.equal(
      result.overlayAllocatedKrw + result.overlayResidualCashKrw,
      3_000,
    );
  });

  it("does not redistribute a reduced amount to another holding", () => {
    const result = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: strategicBaseline(),
      evidence: [
        evidence("AAA", "below_ma", -3),
        evidence("BBB", "above_ma", 1),
        evidence("CCC", "above_ma", 1),
      ],
    });

    assert.equal(result.rows.find((row) => row.ticker === "BBB").overlayAllocationKrw, 1_225);
    assert.equal(result.rows.find((row) => row.ticker === "AAA").overlayAllocationKrw, 888);
    assert.equal(result.overlayResidualCashKrw, 887);
  });

  it("uses a neutral multiplier for missing, unusable, stale, or future evidence", () => {
    const cases = [
      { evidence: [], decision: "missing_evidence" },
      {
        evidence: [evidence("AAA", "insufficient_history", null)],
        decision: "unusable_evidence",
      },
      {
        evidence: [evidence("AAA", "below_ma", -5, "2026-08-04")],
        decision: "stale_evidence",
      },
      {
        evidence: [evidence("AAA", "below_ma", -5, "2026-08-13")],
        decision: "future_evidence",
      },
    ];

    for (const fixture of cases) {
      const result = compareAdditionalContributionMa120Overlay({
        mode: "enabled",
        serviceDate: "2026-08-12",
        baseline: singleHoldingBaseline(),
        evidence: fixture.evidence,
      });
      assert.equal(result.status, "partial");
      assert.equal(result.rows[0].multiplier, 1);
      assert.equal(result.rows[0].overlayAllocationKrw, 100);
      assert.equal(result.rows[0].decision, fixture.decision);
    }
  });

  it("treats the seven-calendar-day freshness boundary as inclusive", () => {
    const fresh = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: singleHoldingBaseline(),
      evidence: [evidence("AAA", "below_ma", -3, "2026-08-05")],
    });
    const stale = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: singleHoldingBaseline(),
      evidence: [evidence("AAA", "below_ma", -3, "2026-08-04")],
    });

    assert.equal(fresh.rows[0].multiplier, 0.5);
    assert.equal(stale.rows[0].multiplier, 1);
  });

  it("accepts the source evaluator's at-MA floating-point tolerance", () => {
    const result = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: singleHoldingBaseline(),
      evidence: [evidence("AAA", "at_ma", Number.EPSILON * 100)],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.rows[0].decision, "above_or_at_ma");
    assert.equal(result.rows[0].multiplier, 1);
  });

  it("rounds reductions toward the strategic allocation for tiny KRW amounts", () => {
    const result = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: {
        cashAmountKrw: 1,
        totalAllocatedKrw: 1,
        residualCashKrw: 0,
        allocations: [holding("AAA", 1)],
      },
      evidence: [evidence("AAA", "below_ma", -10)],
    });

    assert.equal(result.rows[0].overlayAllocationKrw, 1);
    assert.equal(result.rows[0].reductionKrw, 0);
  });

  it("is deterministic across baseline and evidence input order", () => {
    const baseline = strategicBaseline();
    const evidenceRows = [
      evidence("AAA", "below_ma", -1),
      evidence("BBB", "above_ma", 2),
      evidence("CCC", "at_ma", 0),
    ];
    const forward = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline,
      evidence: evidenceRows,
    });
    const reversed = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: { ...baseline, allocations: [...baseline.allocations].reverse() },
      evidence: [...evidenceRows].reverse(),
    });

    assert.deepEqual(forward.rows, reversed.rows);
    assert.equal(forward.overlayResidualCashKrw, reversed.overlayResidualCashKrw);
  });

  it("blocks malformed baseline or duplicate evidence instead of producing a plan", () => {
    const malformed = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: { ...singleHoldingBaseline(), totalAllocatedKrw: 99 },
      evidence: [],
    });
    const duplicate = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: singleHoldingBaseline(),
      evidence: [
        evidence("AAA", "above_ma", 1),
        evidence("AAA", "above_ma", 1),
      ],
    });
    const malformedEvidence = compareAdditionalContributionMa120Overlay({
      mode: "enabled",
      serviceDate: "2026-08-12",
      baseline: singleHoldingBaseline(),
      evidence: [
        {
          ...evidence("AAA", "above_ma", 1),
          instrumentKey: "invalid-key",
        },
      ],
    });

    assert.equal(malformed.status, "blocked");
    assert.ok(malformed.blockers.includes("invalid_baseline_totals"));
    assert.equal(duplicate.status, "blocked");
    assert.deepEqual(duplicate.blockers, ["duplicate_evidence_instrument"]);
    assert.equal(malformedEvidence.status, "blocked");
    assert.deepEqual(malformedEvidence.blockers, ["invalid_instrument_identity"]);
  });

  it("remains pure comparison code without runtime, recommendation, or write authority", () => {
    const source = readFileSync(
      "src/lib/additional-contribution-ma120-overlay.ts",
      "utf8",
    );

    assert.equal(
      ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.runtimeBinding,
      "additional_contribution_preview",
    );
    assert.equal(
      ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.orderAuthority,
      "forbidden",
    );
    assert.equal(ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.redistribution, "forbidden");
    assert.doesNotMatch(source, /server-only|drizzle|neon|@\/db|fetch\s*\(|\/api\//i);
    assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(/i);
  });

  it("keeps the reproducible Production audit guarded and SELECT-only", () => {
    const source = readFileSync(
      "scripts/audit-additional-contribution-ma120-overlay.ts",
      "utf8",
    );

    assert.match(source, /guardProductionDatabaseTarget\(process\.env\)/);
    assert.match(source, /getReadOnlyTenantAdditionalContributionPreview/);
    assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|fetch\s*\(/);
  });
});

function strategicBaseline() {
  return Object.freeze({
    cashAmountKrw: 3_000,
    totalAllocatedKrw: 3_000,
    residualCashKrw: 0,
    allocations: Object.freeze([
      holding("AAA", 1_775),
      holding("BBB", 1_225),
      holding("CCC", 0),
    ]),
  });
}

function singleHoldingBaseline() {
  return Object.freeze({
    cashAmountKrw: 100,
    totalAllocatedKrw: 100,
    residualCashKrw: 0,
    allocations: Object.freeze([holding("AAA", 100)]),
  });
}

function holding(ticker, allocationKrw) {
  return Object.freeze({
    market: "korea",
    currency: "KRW",
    ticker,
    allocationKrw,
  });
}

function evidence(
  ticker,
  status,
  distanceFromMaPct,
  latestWindowPriceDate = "2026-08-11",
) {
  return Object.freeze({
    instrumentKey: `korea:KRW:${ticker}`,
    status,
    latestWindowPriceDate,
    distanceFromMaPct,
  });
}
