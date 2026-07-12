import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HISTORICAL_EVIDENCE_COMPLETENESS_POLICY,
  classifyHistoricalEvidenceForConsumer,
  summarizeHistoricalEvidenceForConsumer,
} from "../src/lib/historical-evidence-completeness.ts";
import {
  historicalEvidenceFixture,
  requirement,
} from "./fixtures/historical-evidence-completeness.mjs";

describe("historical evidence completeness and consumer eligibility v1", () => {
  it("treats observed and provider-backfilled rows as calculation evidence", () => {
    const result = summarizeHistoricalEvidenceForConsumer({
      requirements: [
        historicalEvidenceFixture.observed,
        historicalEvidenceFixture.providerBackfilled,
      ],
      consumer: "portfolio_risk",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.requiredCount, 2);
    assert.equal(result.coverage.eligibleCount, 2);
    assert.equal(result.coverage.canonicalCoveragePct, 100);
    assert.equal(result.coverage.consumerCoveragePct, 100);
    assert.equal(result.coverage.disclosureRequiredCount, 1);
  });

  it("keeps known history rows visible while reporting estimates and gaps", () => {
    const result = summarizeHistoricalEvidenceForConsumer({
      requirements: [
        historicalEvidenceFixture.missing,
        historicalEvidenceFixture.displayEstimated,
        historicalEvidenceFixture.observed,
      ],
      consumer: "history",
    });

    assert.equal(result.status, "partial");
    assert.equal(result.rows.length, 3);
    assert.equal(result.coverage.requiredCount, 3);
    assert.equal(result.coverage.eligibleCount, 2);
    assert.equal(result.coverage.canonicalCount, 1);
    assert.equal(result.coverage.displayEstimatedCount, 1);
    assert.equal(result.coverage.gapCount, 1);
    assertApprox(result.coverage.canonicalCoveragePct, 100 / 3);
    assertApprox(result.coverage.consumerCoveragePct, 200 / 3);
    assert.deepEqual(result.gapDates, ["2026-07-03"]);
    assert.deepEqual(result.estimatedDates, ["2026-07-02"]);
  });

  it("allows reconstruction for display but blocks calculations by default", () => {
    const history = classifyHistoricalEvidenceForConsumer({
      requirement: historicalEvidenceFixture.reconstructed,
      consumer: "history",
    });
    const simulation = classifyHistoricalEvidenceForConsumer({
      requirement: historicalEvidenceFixture.reconstructed,
      consumer: "simulation_validation",
    });

    assert.equal(history.eligible, true);
    assert.equal(history.usage, "derived_display");
    assert.equal(history.disclosureRequired, true);
    assert.equal(simulation.eligible, false);
    assert.equal(simulation.usage, "gap");
    assert.equal(simulation.eligibilityReason, "reconstruction_not_approved");
  });

  it("binds a reconstruction approval to an exact method and consumer call", () => {
    const approved = classifyHistoricalEvidenceForConsumer({
      requirement: historicalEvidenceFixture.reconstructed,
      consumer: "investment_lab",
      approvedReconstructionMethodVersions: [
        "portfolio_reconstruction_fixture_v1",
      ],
    });
    const wrongMethod = classifyHistoricalEvidenceForConsumer({
      requirement: historicalEvidenceFixture.reconstructed,
      consumer: "investment_lab",
      approvedReconstructionMethodVersions: ["other_method_v1"],
    });
    const otherConsumer = classifyHistoricalEvidenceForConsumer({
      requirement: historicalEvidenceFixture.reconstructed,
      consumer: "optimizer",
    });

    assert.equal(approved.eligible, true);
    assert.equal(approved.usage, "approved_reconstruction");
    assert.equal(approved.disclosureRequired, true);
    assert.equal(wrongMethod.eligible, false);
    assert.equal(otherConsumer.eligible, false);
  });

  it("never permits display estimates in calculation consumers", () => {
    const result = summarizeHistoricalEvidenceForConsumer({
      requirements: [
        historicalEvidenceFixture.observed,
        historicalEvidenceFixture.displayEstimated,
      ],
      consumer: "additional_contribution",
      approvedReconstructionMethodVersions: [
        "linear_chart_interpolation_fixture_v1",
      ],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.coverage.requiredCount, 2);
    assert.equal(result.coverage.eligibleCount, 1);
    assert.ok(
      result.reasons.includes("display_estimate_forbidden_for_calculation"),
    );
  });

  it("marks malformed lineage invalid instead of trusting the requested kind", () => {
    const malformed = classifyHistoricalEvidenceForConsumer({
      requirement: requirement({
        key: "069500:2026-07-01",
        evidenceKind: "provider_backfilled",
        asOfDate: "2026-02-30",
        source: "provider",
        sourceDates: ["not-a-date"],
        methodVersion: null,
      }),
      consumer: "history",
    });

    assert.equal(malformed.requestedEvidenceKind, "provider_backfilled");
    assert.equal(malformed.effectiveEvidenceKind, "invalid");
    assert.equal(malformed.eligible, false);
    assert.deepEqual(malformed.issues, [
      "invalid_as_of_date",
      "invalid_source_date",
      "method_version_required",
      "source_date_required",
    ]);
  });

  it("fails closed for an unknown runtime evidence kind", () => {
    const result = classifyHistoricalEvidenceForConsumer({
      requirement: requirement({
        key: "069500:2026-07-01",
        evidenceKind: "silently_interpolated",
        asOfDate: "2026-07-01",
        reason: "unsupported_kind",
      }),
      consumer: "history",
    });

    assert.equal(result.requestedEvidenceKind, "invalid");
    assert.equal(result.effectiveEvidenceKind, "invalid");
    assert.equal(result.eligible, false);
    assert.deepEqual(result.issues, ["invalid_evidence_kind"]);
  });

  it("does not deduplicate ambiguous requirement keys or shrink coverage", () => {
    const duplicate = requirement({
      ...historicalEvidenceFixture.observed,
      sourceDates: ["2026-06-30"],
    });
    const result = summarizeHistoricalEvidenceForConsumer({
      requirements: [historicalEvidenceFixture.observed, duplicate],
      consumer: "portfolio_risk",
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.rows.length, 2);
    assert.equal(result.coverage.requiredCount, 2);
    assert.equal(result.coverage.eligibleCount, 0);
    assert.ok(result.reasons.includes("duplicate_requirement_key"));
  });

  it("returns unavailable only when a display surface has no usable rows", () => {
    const result = summarizeHistoricalEvidenceForConsumer({
      requirements: [
        historicalEvidenceFixture.missing,
        historicalEvidenceFixture.ambiguous,
      ],
      consumer: "dashboard",
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.coverage.requiredCount, 2);
    assert.equal(result.coverage.eligibleCount, 0);
    assert.deepEqual(result.gapDates, ["2026-07-03", "2026-07-04"]);
  });

  it("has no value interpolation, provider, database, route, or confidence dependency", () => {
    const source = readFileSync(
      "src/lib/historical-evidence-completeness.ts",
      "utf8",
    );

    assert.equal(
      HISTORICAL_EVIDENCE_COMPLETENESS_POLICY.rawEvidenceMutation,
      "forbidden",
    );
    assert.equal(
      HISTORICAL_EVIDENCE_COMPLETENESS_POLICY.confidenceScore,
      "not_defined",
    );
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(
      source,
      /drizzle|neon|server-only|fetch\s*\(|\/api\/|interpolat(e|ion)|currentPrice|marketValue|amountKrw/i,
    );
  });
});

function assertApprox(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
