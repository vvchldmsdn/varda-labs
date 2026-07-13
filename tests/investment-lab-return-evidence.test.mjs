import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_RETURN_EVIDENCE_POLICY,
  validateInvestmentLabReturnEvidence,
} from "../src/lib/investment-lab-return-evidence.ts";

describe("investment lab return evidence", () => {
  it("accepts complete zero-cash position evidence", () => {
    const result = validateInvestmentLabReturnEvidence(fixture());

    assert.equal(result.status, "ready");
    assert.equal(result.cashEvidenceRows, 9);
    assert.equal(result.positionMetadataEventRows, 2);
    assert.equal(result.ambiguousPositionMetadataRows, 0);
    assert.deepEqual(result.blockers, []);
  });

  it("blocks missing, duplicate, and nonzero named-account cash evidence", () => {
    const missing = fixture();
    missing.snapshotRows.pop();
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(missing).blockers,
      ["cash_evidence_unavailable"],
    );

    const duplicate = fixture();
    duplicate.snapshotRows.push({ ...duplicate.snapshotRows[0] });
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(duplicate).blockers,
      ["cash_evidence_unavailable"],
    );

    const nonzero = fixture();
    nonzero.snapshotRows[0] = {
      ...nonzero.snapshotRows[0],
      cashValue: 1,
    };
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(nonzero).blockers,
      ["nonzero_cash_evidence"],
    );

    const unsorted = fixture();
    unsorted.serviceDates = [
      unsorted.serviceDates[1],
      unsorted.serviceDates[0],
      unsorted.serviceDates[2],
    ];
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(unsorted).blockers,
      ["cash_evidence_unavailable"],
    );
  });

  it("allows lifecycle metadata only without financial payload", () => {
    for (const field of ["amountKrw", "quantityDelta", "price", "fxRate"]) {
      const input = fixture();
      input.eventRows[1] = { ...input.eventRows[1], [field]: 1 };
      const result = validateInvestmentLabReturnEvidence(input);

      assert.equal(result.status, "blocked");
      assert.equal(result.ambiguousPositionMetadataRows, 1);
      assert.deepEqual(result.blockers, [
        "ambiguous_position_metadata_event",
      ]);
    }
  });

  it("keeps cash-ledger events outside the invested-position boundary", () => {
    const input = fixture();
    input.eventRows.push(event("2026-01-04", "deposit", 500));
    input.eventRows.push(event("2026-01-04", "withdrawal", 100));
    const result = validateInvestmentLabReturnEvidence(input);

    assert.equal(result.status, "ready");
    assert.equal(result.cashLedgerEventRows, 2);
  });

  it("blocks unmodeled economic events and corrections", () => {
    const dividend = fixture();
    dividend.eventRows.push(event("2026-01-04", "dividend", 10));
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(dividend).blockers,
      ["unmodeled_return_event"],
    );

    const correction = fixture();
    correction.eventRows[0] = {
      ...correction.eventRows[0],
      isCorrection: true,
    };
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(correction).blockers,
      ["unmodeled_return_event"],
    );

    const anchorDate = fixture();
    anchorDate.eventRows.push(event("2026-01-02", "fee", 10));
    assert.deepEqual(
      validateInvestmentLabReturnEvidence(anchorDate).blockers,
      ["unmodeled_return_event"],
    );
  });

  it("ignores evidence outside the measured return window", () => {
    const input = fixture();
    input.eventRows.push(event("2025-12-31", "dividend", 10));
    input.eventRows.push(event("2026-01-06", "fee", 10));

    assert.equal(validateInvestmentLabReturnEvidence(input).status, "ready");
  });

  it("publishes the fail-closed policy without I/O dependencies", async () => {
    assert.deepEqual(INVESTMENT_LAB_RETURN_EVIDENCE_POLICY, {
      version: "position_return_evidence_v1",
      snapshotCash: "zero_required_until_cash_semantics_versioned",
      cashLedgerEvents: "outside_invested_position_boundary",
      positionMetadata:
        "allowed_only_without_amount_quantity_price_or_fx_payload",
      unsupportedEconomicEvents: "fail_closed",
    });

    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/lib/investment-lab-return-evidence.ts", "utf8"),
    );
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
    );
  });
});

function fixture() {
  const serviceDates = ["2026-01-02", "2026-01-05", "2026-01-06"];
  return {
    serviceDates,
    snapshotRows: serviceDates.flatMap((snapshotDate) =>
      ["brokerage", "isa", "irp"].map((account) => ({
        snapshotDate,
        account,
        cashValue: 0,
      })),
    ),
    eventRows: [
      event("2026-01-03", "buy", 100),
      event("2026-01-04", "asset_added", null),
      event("2026-01-04", "asset_removed", null),
    ],
  };
}

function event(eventDate, eventType, amountKrw) {
  return {
    eventDate,
    eventType,
    amountKrw,
    quantityDelta: null,
    price: null,
    fxRate: null,
    isCorrection: false,
  };
}
