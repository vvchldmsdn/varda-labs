import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateProviderAdjustedHistoryReadiness } from "../src/lib/market-data/provider-adjusted-history-readiness.ts";

describe("Provider adjusted-history readiness", () => {
  it("admits writes only when every shared-history check passes", () => {
    const result = evaluateProviderAdjustedHistoryReadiness(readyInput());

    assert.equal(result.status, "admitted_for_write");
    assert.equal(result.writeAdmitted, true);
    assert.deepEqual(result.issues, []);
    assert.ok(Object.values(result.checks).every(Boolean));
  });

  it("keeps current KIS candidates blocked without license and basis proof", () => {
    const result = evaluateProviderAdjustedHistoryReadiness({
      ...readyInput(),
      provider: "kis_domestic_history_candidate",
      dataUsageEntitlement: "unproven",
      priceBasis: "unverified",
      corporateActionParity: "unproven",
    });

    assert.equal(result.status, "license_unproven");
    assert.equal(result.writeAdmitted, false);
    assert.ok(result.issues.includes("price_basis_ineligible"));
    assert.ok(result.issues.includes("corporate_action_parity_unproven"));
  });

  it("does not treat the expand index as write-ready while legacy uniqueness remains", () => {
    const result = evaluateProviderAdjustedHistoryReadiness({
      ...readyInput(),
      schema: {
        provenanceColumnsReady: true,
        exactInstrumentDateUnique: true,
        legacyTickerDateUnique: true,
      },
    });

    assert.equal(result.status, "schema_not_ready");
    assert.equal(result.checks.schemaReady, false);
    assert.ok(
      result.issues.includes(
        "legacy_ticker_date_unique_blocks_multi_market",
      ),
    );
  });

  it("requires complete date-specific FX evidence for USD history", () => {
    const result = evaluateProviderAdjustedHistoryReadiness({
      ...readyInput(),
      market: "us",
      currency: "USD",
      fxCoverage: "incomplete",
    });

    assert.equal(result.status, "fx_incomplete");
    assert.equal(result.checks.fxReady, false);
    assert.equal(result.writeAdmitted, false);
  });

  it("fails closed for malformed runtime evidence", () => {
    const result = evaluateProviderAdjustedHistoryReadiness({
      ...readyInput(),
      dataUsageEntitlement: "assumed",
    });

    assert.equal(result.status, "blocked_invalid_input");
    assert.equal(result.writeAdmitted, false);
    assert.deepEqual(result.issues, ["invalid_input"]);
  });
});

function readyInput() {
  return {
    provider: "fixture_adjusted_history",
    market: "korea",
    currency: "KRW",
    schema: {
      provenanceColumnsReady: true,
      exactInstrumentDateUnique: true,
      legacyTickerDateUnique: false,
    },
    dataUsageEntitlement: "admitted",
    instrumentBinding: "verified",
    historicalPagination: "verified",
    priceBasis: "distribution_adjusted_total_return",
    corporateActionParity: "verified",
    correctionPolicy: "verified",
    duplicatePolicy: "exact_instrument_date_fail_close",
    fxCoverage: "not_applicable",
  };
}
