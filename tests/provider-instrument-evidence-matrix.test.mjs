import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProviderInstrumentEvidenceMatrix } from "../src/lib/market-data/provider-instrument-evidence-matrix.ts";

describe("Provider instrument evidence matrix", () => {
  it("admits only an exact fully evidenced instrument candidate", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [candidate()],
    });

    assert.equal(result.summary.writeAdmittedCount, 1);
    assert.equal(result.candidates[0].instrumentKey, "korea|KRW|069500");
    assert.equal(result.candidates[0].provider.requestedRangeCovered, true);
    assert.equal(result.candidates[0].writeAdmitted, true);
    assert.deepEqual(result.candidates[0].blockers, []);
  });

  it("keeps fetch, store, display, and multi-user rights separate", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [
        candidate({
          entitlements: {
            fetch: "admitted",
            store: "admitted",
            display: "unproven",
            multiUser: "denied",
          },
        }),
      ],
    }).candidates[0];

    assert.equal(result.status, "license_denied");
    assert.equal(result.writeAdmitted, false);
    assert.ok(result.blockers.includes("display_entitlement_unproven"));
    assert.ok(result.blockers.includes("multi_user_entitlement_denied"));
  });

  it("rejects a provider binding that does not cover the requested range", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [
        candidate({
          provider: {
            id: "fixture_provider",
            symbol: "069500",
            exchange: "KRX",
            bindingStatus: "verified",
            effectiveFrom: "2026-07-02",
            effectiveTo: "2026-07-03",
          },
        }),
      ],
    }).candidates[0];

    assert.equal(result.status, "provider_binding_incomplete");
    assert.equal(result.provider.requestedRangeCovered, false);
    assert.ok(result.blockers.includes("provider_binding_range_mismatch"));
  });

  it("ignores FX duplicates outside the requested source-date window", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [
        usdCandidate({
          fxRows: [
            fx("2026-06-30", 1500, "source-a"),
            fx("2026-06-30", 1500, "source-b"),
            fx("2026-07-01", 1501, "source-a"),
            fx("2026-07-02", 1502, "source-a"),
          ],
        }),
      ],
    }).candidates[0];

    assert.equal(result.fxEvidence.status, "complete");
    assert.equal(result.fxEvidence.ignoredOutOfWindowRowCount, 2);
    assert.equal(result.fxEvidence.duplicateDates.length, 0);
    assert.equal(result.writeAdmitted, true);
  });

  it("does not silently canonicalize equivalent duplicates inside the window", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [
        usdCandidate({
          fxRows: [
            fx("2026-07-01", 1501, "source-a"),
            fx("2026-07-01", 1501, "source-b"),
            fx("2026-07-02", 1502, "source-a"),
          ],
        }),
      ],
    }).candidates[0];

    assert.equal(
      result.fxEvidence.status,
      "equivalent_duplicate_unresolved",
    );
    assert.equal(
      result.fxEvidence.duplicateDates[0].classification,
      "equivalent_duplicate_unresolved",
    );
    assert.equal(result.writeAdmitted, false);
    assert.ok(
      result.blockers.includes("fx_equivalent_duplicate_unresolved"),
    );
  });

  it("distinguishes conflicting duplicates and missing FX coverage", () => {
    const conflicting = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [
        usdCandidate({
          fxRows: [
            fx("2026-07-01", 1501, "source-a"),
            fx("2026-07-01", 1502, "source-b"),
          ],
        }),
      ],
    }).candidates[0];
    const missing = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [usdCandidate({ fxRows: [] })],
    }).candidates[0];

    assert.equal(conflicting.fxEvidence.status, "conflicting_duplicate");
    assert.ok(conflicting.blockers.includes("fx_conflicting_duplicate"));
    assert.equal(missing.fxEvidence.status, "incomplete");
    assert.ok(missing.blockers.includes("fx_missing_fx"));
  });

  it("blocks duplicate exact instrument candidates", () => {
    const result = buildProviderInstrumentEvidenceMatrix({
      schema: readySchema(),
      candidates: [candidate(), candidate()],
    });

    assert.deepEqual(result.summary.duplicateInstrumentKeys, [
      "korea|KRW|069500",
    ]);
    assert.equal(result.summary.writeAdmittedCount, 0);
    assert.ok(
      result.candidates.every((row) =>
        row.blockers.includes("duplicate_instrument_identity"),
      ),
    );
  });
});

function readySchema() {
  return {
    provenanceColumnsReady: true,
    exactInstrumentDateUnique: true,
    legacyTickerDateUnique: false,
  };
}

function candidate(overrides = {}) {
  return {
    instrument: { market: "korea", currency: "KRW", ticker: "069500" },
    provider: {
      id: "fixture_provider",
      symbol: "069500",
      exchange: "KRX",
      bindingStatus: "verified",
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-07-03",
    },
    entitlements: {
      fetch: "admitted",
      store: "admitted",
      display: "admitted",
      multiUser: "admitted",
    },
    endpoint: {
      id: "fixture.history",
      priceField: "adjusted_close",
      priceBasis: "distribution_adjusted_total_return",
    },
    historicalPagination: "verified",
    corporateActionParity: "verified",
    correctionPolicy: "verified",
    duplicatePolicy: "exact_instrument_date_fail_close",
    requestedSourceDateRange: {
      from: "2026-07-01",
      to: "2026-07-03",
    },
    requiredServiceDates: ["2026-07-02", "2026-07-03"],
    maxFxCarryDays: 3,
    fxRows: [],
    ...overrides,
  };
}

function usdCandidate(overrides = {}) {
  return candidate({
    instrument: { market: "us", currency: "USD", ticker: "QQQ" },
    provider: {
      id: "fixture_provider",
      symbol: "QQQ",
      exchange: "NAS",
      bindingStatus: "verified",
      effectiveFrom: "2026-07-01",
      effectiveTo: "2026-07-03",
    },
    ...overrides,
  });
}

function fx(rateDate, usdKrw, source) {
  return { rateDate, usdKrw, status: "ok", source };
}
