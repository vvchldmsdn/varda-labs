import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY,
  evaluateAdditionalContributionMa120Evidence,
  pairBaselineWithMa120Evidence,
} from "../src/lib/additional-contribution-ma120-evidence.ts";

describe("additional contribution MA120 evidence Phase 2A", () => {
  it("classifies exactly 120 adjusted-close observations", () => {
    const rows = observations(120, () => 100);
    const result = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 120,
    });

    assert.equal(result.status, "above_ma");
    assert.equal(result.availableObservationCount, 120);
    assert.equal(result.usedObservationCount, 120);
    assert.equal(result.ma120, 100);
    assertApprox(result.distanceFromMaPct, 20);
    assert.equal(result.oldestWindowPriceDate, rows[0].priceDate);
    assert.equal(result.latestWindowPriceDate, rows.at(-1).priceDate);
    assert.deepEqual(result.blockers, []);
  });

  it("keeps at-MA and below-MA evidence distinct", () => {
    const rows = observations(120, () => 100);
    const atMa = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 100,
    });
    const below = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 80,
    });

    assert.equal(atMa.status, "at_ma");
    assert.equal(below.status, "below_ma");
    assertApprox(below.distanceFromMaPct, -20);
  });

  it("treats 119 actual observations as insufficient", () => {
    const rows = observations(119, () => 100);
    const result = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 100,
    });

    assert.equal(result.status, "insufficient_history");
    assert.equal(result.availableObservationCount, 119);
    assert.equal(result.usedObservationCount, 0);
    assert.equal(result.ma120, null);
    assert.deepEqual(result.blockers, ["fewer_than_120_observations"]);
  });

  it("never fills a missing observation with calendar-day carry", () => {
    const complete = observations(120, () => 100);
    const withGap = complete.filter((_, index) => index !== 60);
    const result = evaluate({
      observations: withGap,
      asOfPriceDate: complete.at(-1).priceDate,
      comparisonPrice: 100,
    });

    assert.equal(result.status, "insufficient_history");
    assert.equal(result.availableObservationCount, 119);
    assert.equal(result.latestWindowPriceDate, null);
  });

  it("ignores future closes instead of looking ahead", () => {
    const rows = observations(120, () => 100);
    const asOfPriceDate = rows.at(-1).priceDate;
    const baseline = evaluate({
      observations: rows,
      asOfPriceDate,
      comparisonPrice: 120,
    });
    const withFuture = evaluate({
      observations: [
        ...rows,
        {
          priceDate: addUtcDays(asOfPriceDate, 1),
          adjustedClosePrice: 10_000,
        },
      ],
      asOfPriceDate,
      comparisonPrice: 120,
    });

    assert.equal(withFuture.status, baseline.status);
    assert.equal(withFuture.ma120, baseline.ma120);
    assert.equal(
      withFuture.latestWindowPriceDate,
      baseline.latestWindowPriceDate,
    );
    assert.equal(withFuture.ignoredFutureObservationCount, 1);
  });

  it("uses the latest 120 observed rows without older-window leakage", () => {
    const rows = observations(121, (index) => (index === 0 ? 10_000 : 100));
    const result = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 100,
    });

    assert.equal(result.status, "at_ma");
    assert.equal(result.availableObservationCount, 121);
    assert.equal(result.usedObservationCount, 120);
    assert.equal(result.oldestWindowPriceDate, rows[1].priceDate);
    assert.equal(result.ma120, 100);
  });

  it("fails closed for duplicate, invalid, and non-positive history", () => {
    const rows = observations(120, () => 100);
    const variants = [
      {
        observations: [...rows, { ...rows[0] }],
        blocker: "duplicate_price_date",
      },
      {
        observations: rows.map((row, index) =>
          index === 0 ? { ...row, priceDate: "2026-02-30" } : row,
        ),
        blocker: "invalid_price_date",
      },
      {
        observations: rows.map((row, index) =>
          index === 0 ? { ...row, adjustedClosePrice: 0 } : row,
        ),
        blocker: "invalid_adjusted_close",
      },
      {
        observations: rows.map((row, index) =>
          index === 0 ? { ...row, adjustedClosePrice: -1 } : row,
        ),
        blocker: "invalid_adjusted_close",
      },
      {
        observations: rows.map((row, index) =>
          index === 0 ? { ...row, adjustedClosePrice: Number.NaN } : row,
        ),
        blocker: "invalid_adjusted_close",
      },
    ];

    for (const variant of variants) {
      const result = evaluate({
        observations: variant.observations,
        asOfPriceDate: rows.at(-1).priceDate,
        comparisonPrice: 100,
      });
      assert.equal(result.status, "invalid_history");
      assert.ok(result.blockers.includes(variant.blocker));
      assert.equal(result.ma120, null);
    }
  });

  it("rejects raw-close fields instead of mixing price bases", () => {
    const rows = observations(120, () => 100);
    const mixed = rows.map((row, index) =>
      index === 0 ? { ...row, closePrice: 100 } : row,
    );
    const result = evaluate({
      observations: mixed,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 100,
    });

    assert.equal(result.status, "invalid_history");
    assert.ok(result.blockers.includes("raw_close_field_forbidden"));
    assert.equal(result.ma120, null);
  });

  it("requires a positive comparison price on the adjusted-close basis", () => {
    const rows = observations(120, () => 100);
    const invalidPrice = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 0,
    });
    const invalidBasis = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 100,
      comparisonPriceBasis: "raw_close",
    });

    assert.equal(invalidPrice.status, "invalid_history");
    assert.ok(invalidPrice.blockers.includes("invalid_comparison_price"));
    assert.equal(invalidBasis.status, "invalid_history");
    assert.ok(
      invalidBasis.blockers.includes("incompatible_comparison_price_basis"),
    );
  });

  it("pairs evidence without changing the baseline allocation", () => {
    const rows = observations(120, () => 100);
    const evidence = evaluate({
      observations: rows,
      asOfPriceDate: rows.at(-1).priceDate,
      comparisonPrice: 80,
    });
    const baseline = Object.freeze({
      totalAllocatedKrw: 100_000,
      residualCashKrw: 0,
      allocations: Object.freeze([
        Object.freeze({ instrumentKey: "korea:KRW:069500", allocationKrw: 60_000 }),
        Object.freeze({ instrumentKey: "us:USD:VOO", allocationKrw: 40_000 }),
      ]),
    });
    const before = JSON.parse(JSON.stringify(baseline));
    const result = pairBaselineWithMa120Evidence({
      baseline,
      evidence: [evidence],
    });

    assert.equal(result.mode, "evidence_only");
    assert.equal(result.allocationEffect, "none");
    assert.strictEqual(result.baseline, baseline);
    assert.deepEqual(result.baseline, before);
    assert.equal(
      result.baseline.allocations.reduce(
        (sum, row) => sum + row.allocationKrw,
        0,
      ),
      100_000,
    );
    assert.deepEqual(result.baseline.allocations, before.allocations);
  });

  it("has no legacy cache, settings, provider, DB, API, allocator, or ISA fixture dependency", () => {
    const source = readFileSync(
      "src/lib/additional-contribution-ma120-evidence.ts",
      "utf8",
    );

    assert.equal(
      ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.allocationEffect,
      "none",
    );
    assert.equal(
      ADDITIONAL_CONTRIBUTION_MA120_EVIDENCE_POLICY.rawCloseFallback,
      "forbidden",
    );
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(
      source,
      /assets?\.ma_?120|useTrendFilter|settings|drizzle|neon|@\/db|server-only|fetch\s*\(|\/api\//i,
    );
    assert.doesNotMatch(
      source,
      /allocateAdditionalContribution|target-policy-resolver|isa-v1|133690|360200|475350|489250/i,
    );
  });
});

function evaluate({
  observations,
  asOfPriceDate,
  comparisonPrice,
  comparisonPriceBasis = "adjusted_close_compatible",
}) {
  return evaluateAdditionalContributionMa120Evidence({
    instrumentKey: "korea:KRW:069500",
    asOfPriceDate,
    comparisonPrice,
    comparisonPriceBasis,
    observations,
  });
}

function observations(count, priceForIndex) {
  return Array.from({ length: count }, (_, index) => ({
    priceDate: addUtcDays("2026-01-01", index),
    adjustedClosePrice: priceForIndex(index),
  }));
}

function addUtcDays(date, days) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function assertApprox(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}
