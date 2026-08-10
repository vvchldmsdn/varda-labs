import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeSimulationOwnerReadiness } from "../src/lib/simulation-owner-readiness-audit.ts";

describe("simulation owner readiness audit", () => {
  it("summarizes every scope without exposing row identifiers or values", () => {
    const result = summarizeSimulationOwnerReadiness([
      scope("isa", "ready"),
      scope("all", "unavailable"),
      scope("irp", "ready"),
      scope("brokerage", "unavailable"),
    ]);

    assert.equal(result.scopeCount, 4);
    assert.equal(result.readyScopeCount, 2);
    assert.equal(result.historicalValidationReadyScopeCount, 2);
    assert.equal(result.parametricFactorReadyScopeCount, 2);
    assert.equal(result.modelComparisonReadyScopeCount, 2);
    assert.equal(result.modelCalibrationReadyScopeCount, 2);
    assert.equal(result.modelCalibrationPairedScopeCount, 2);
    assert.deepEqual(
      result.scopes.map((row) => row.account),
      ["all", "brokerage", "isa", "irp"],
    );
    assert.deepEqual(result.scopes[0].historicalStatusCounts, {
      provenance_ready_for_separate_review: 1,
      stored_coverage_incomplete: 1,
    });
    assert.deepEqual(result.scopes[0].admissionStatusCounts, {
      price_history_incomplete: 1,
      ready: 1,
    });
    assert.equal(result.scopes[0].modeledCoverage.currentValuePct, 93.27);
    assert.deepEqual(result.scopes[0].historicalValidation, {
      status: "unavailable",
      reason: "all_endpoints_unavailable",
      latestOutcomeEndServiceDate: "2026-08-03",
      endpointCount: 7,
      readyEndpointCount: 0,
      unavailableEndpointCount: 7,
    });
    assert.deepEqual(result.scopes[0].parametricFactor, {
      status: "unavailable",
      reason: "insufficient_factor_overlap",
      alignedObservationCount: 40,
      factorGapRowCount: 50,
      firstAlignedServiceDate: "2026-04-01",
      lastAlignedServiceDate: "2026-06-01",
    });
    assert.deepEqual(result.scopes[0].modelComparison, {
      status: "unavailable",
      reason: "factor_model_unavailable",
      agreementCode: null,
      terminalP10P90OverlapPct: null,
      factorObservationCoveragePct: null,
    });
    assert.deepEqual(result.scopes[0].modelCalibration, {
      status: "unavailable",
      reason: "no_paired_endpoints",
      endpointCount: 7,
      pairedEndpointCount: 0,
      unavailableEndpointCount: 7,
      effectiveNonOverlappingWindowCount: 0,
    });
    assert.equal(result.policy.providerCalls, "forbidden");
    assert.equal(result.policy.databaseWrites, "forbidden");

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "owner-secret-id",
      "account-secret-id",
      "069500",
      "KODEX 200",
      "26822502",
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("rejects missing, duplicate, and mismatched scopes", () => {
    assert.throws(
      () => summarizeSimulationOwnerReadiness([scope("all", "ready")]),
      /missing readiness scope/,
    );
    assert.throws(
      () =>
        summarizeSimulationOwnerReadiness([
          scope("all", "ready"),
          scope("all", "ready"),
          scope("brokerage", "ready"),
          scope("isa", "ready"),
          scope("irp", "ready"),
        ]),
      /duplicate readiness scope/,
    );
    const mismatched = scope("all", "ready");
    mismatched.inputPreflight.account = "isa";
    assert.throws(
      () =>
        summarizeSimulationOwnerReadiness([
          mismatched,
          scope("brokerage", "ready"),
          scope("isa", "ready"),
          scope("irp", "ready"),
        ]),
      /readiness scope mismatch/,
    );
  });
});

function scope(account, status) {
  return {
    account,
    inputPreflight: {
      account,
      status: "ready_full_portfolio",
      blockers: [],
      summary: {
        sourceHoldingCount: 2,
        valuationGapCount: 0,
        identityGapCount: 0,
        fountExcludedHoldingCount: 0,
      },
      instruments: [
        {
          historicalStatus: "provenance_ready_for_separate_review",
          admissionStatus: "ready",
          ownerUserId: "owner-secret-id",
          accountId: "account-secret-id",
          ticker: "069500",
          name: "KODEX 200",
          currentValueKrw: 26_822_502,
        },
        {
          historicalStatus: "stored_coverage_incomplete",
          admissionStatus: "price_history_incomplete",
        },
      ],
    },
    execution: {
      account,
      status,
      reason:
        status === "unavailable" ? "historical_evidence_not_admitted" : null,
      endSelection: {
        status: "valid",
        source: "latest_common_stored",
        endServiceDate: "2026-08-03",
      },
      coverage: {
        candidateInstrumentCount: 2,
        modeledInstrumentCount: 2,
        modeledCurrentValuePct: 93.274,
        omittedWeightBps: 673,
        manualHistoryWeightBps: 673,
      },
    },
    historicalValidation: {
      account,
      status: status === "ready" ? "ready" : "unavailable",
      reason: status === "ready" ? null : "all_endpoints_unavailable",
      latestOutcomeEndServiceDate: "2026-08-03",
      summary: {
        endpointCount: 7,
        readyEndpointCount: status === "ready" ? 7 : 0,
        unavailableEndpointCount: status === "ready" ? 0 : 7,
      },
    },
    parametricFactor: {
      account,
      status,
      reason: status === "ready" ? null : "insufficient_factor_overlap",
      source: {
        alignedObservationCount: status === "ready" ? 60 : 40,
        factorGapRowCount: status === "ready" ? 30 : 50,
        firstAlignedServiceDate: "2026-04-01",
        lastAlignedServiceDate: "2026-06-01",
      },
    },
    modelComparison: {
      account,
      status,
      reason: status === "ready" ? null : "factor_model_unavailable",
      agreement:
        status === "ready"
          ? {
              code: "direction_agrees_and_ranges_overlap",
              terminalP10P90OverlapPct: 72.345,
            }
          : null,
      pairing:
        status === "ready"
          ? { factorObservationCoveragePct: 66.667 }
          : null,
    },
    modelCalibration: {
      account,
      status,
      reason: status === "ready" ? null : "no_paired_endpoints",
      summary: {
        endpointCount: 7,
        pairedEndpointCount: status === "ready" ? 7 : 0,
        unavailableEndpointCount: status === "ready" ? 0 : 7,
        effectiveNonOverlappingWindowCount: status === "ready" ? 1 : 0,
      },
    },
  };
}
