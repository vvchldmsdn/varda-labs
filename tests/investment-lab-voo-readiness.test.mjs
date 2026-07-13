import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assessInvestmentLabVooReadiness,
  INVESTMENT_LAB_VOO_READINESS_POLICY,
} from "../src/lib/investment-lab-voo-readiness.ts";

describe("investment lab VOO evidence readiness", () => {
  it("accepts an exact calendar, snapshot FX, and execution FX fixture", () => {
    const result = assessInvestmentLabVooReadiness(fixture());

    assert.equal(result.status, "ready");
    assert.equal(result.serviceDateCount, 3);
    assert.equal(result.valuationPriceReadyCount, 3);
    assert.equal(result.snapshotFxReadyCount, 3);
    assert.equal(result.snapshotFxProvenanceReadyCount, 3);
    assert.equal(result.relevantFlowCount, 2);
    assert.equal(result.executionPriceReadyCount, 2);
    assert.equal(result.executionFxReadyCount, 2);
    assert.equal(result.valuationAdjustedDifferenceRows, 1);
    assert.deepEqual(result.blockers, []);
  });

  it("uses the previous US trading day for a Monday service date", () => {
    const input = fixture();
    input.priceRows = input.priceRows.filter(
      (row) => row.priceDate !== "2026-07-02",
    );
    const result = assessInvestmentLabVooReadiness(input);

    assert.equal(result.status, "unavailable");
    assert.equal(result.valuationPriceReadyCount, 2);
    assert.ok(result.blockers.includes("missing_valuation_price"));
  });

  it("blocks duplicate or invalid required valuation closes", () => {
    const duplicate = fixture();
    duplicate.priceRows.push({ ...duplicate.priceRows[1] });
    assert.ok(
      assessInvestmentLabVooReadiness(duplicate).blockers.includes(
        "duplicate_valuation_price",
      ),
    );
    assert.ok(
      assessInvestmentLabVooReadiness(duplicate).blockers.includes(
        "duplicate_execution_price",
      ),
    );

    const invalid = fixture();
    invalid.priceRows[1] = { ...invalid.priceRows[1], closePrice: 0 };
    assert.ok(
      assessInvestmentLabVooReadiness(invalid).blockers.includes(
        "invalid_valuation_price",
      ),
    );
    assert.ok(
      assessInvestmentLabVooReadiness(invalid).blockers.includes(
        "invalid_execution_price",
      ),
    );
  });

  it("requires exact named-account snapshot FX consensus", () => {
    const missing = fixture();
    missing.snapshotRows.pop();
    assert.ok(
      assessInvestmentLabVooReadiness(missing).blockers.includes(
        "missing_snapshot_fx",
      ),
    );

    const mismatch = fixture();
    mismatch.snapshotRows[0] = {
      ...mismatch.snapshotRows[0],
      usdKrw: 1_301,
    };
    assert.ok(
      assessInvestmentLabVooReadiness(mismatch).blockers.includes(
        "ambiguous_snapshot_fx",
      ),
    );
  });

  it("requires stored source provenance without inferring provider dates", () => {
    const missingSnapshotSource = fixture();
    missingSnapshotSource.snapshotRows[0] = {
      ...missingSnapshotSource.snapshotRows[0],
      source: null,
    };
    assert.ok(
      assessInvestmentLabVooReadiness(
        missingSnapshotSource,
      ).blockers.includes("missing_snapshot_fx_provenance"),
    );

    const mixedSnapshotRule = fixture();
    mixedSnapshotRule.snapshotRows[0] = {
      ...mixedSnapshotRule.snapshotRows[0],
      ruleVersion: "different-rule",
    };
    assert.ok(
      assessInvestmentLabVooReadiness(
        mixedSnapshotRule,
      ).blockers.includes("ambiguous_snapshot_fx_provenance"),
    );

    const missingPriceSource = fixture();
    missingPriceSource.priceRows[0] = {
      ...missingPriceSource.priceRows[0],
      source: null,
    };
    assert.ok(
      assessInvestmentLabVooReadiness(
        missingPriceSource,
      ).blockers.includes("missing_valuation_price_provenance"),
    );
  });

  it("requires one exact valid FX row on each execution price date", () => {
    const missing = fixture();
    missing.fxRows = missing.fxRows.filter(
      (row) => row.rateDate !== "2026-07-06",
    );
    assert.ok(
      assessInvestmentLabVooReadiness(missing).blockers.includes(
        "missing_execution_fx",
      ),
    );

    const duplicate = fixture();
    duplicate.fxRows.push({ ...duplicate.fxRows[0] });
    assert.ok(
      assessInvestmentLabVooReadiness(duplicate).blockers.includes(
        "duplicate_execution_fx",
      ),
    );

    const invalid = fixture();
    invalid.fxRows[0] = { ...invalid.fxRows[0], status: "empty" };
    assert.ok(
      assessInvestmentLabVooReadiness(invalid).blockers.includes(
        "invalid_execution_fx",
      ),
    );

    const missingSource = fixture();
    missingSource.fxRows[0] = { ...missingSource.fxRows[0], source: null };
    assert.ok(
      assessInvestmentLabVooReadiness(missingSource).blockers.includes(
        "missing_execution_fx_provenance",
      ),
    );
  });

  it("does not silently extend an execution beyond the measured window", () => {
    const input = fixture();
    input.boundaryFlows.push(flow("2026-07-07", 3, "inflow", 100));
    input.priceRows = input.priceRows.filter(
      (row) => row.priceDate !== "2026-07-07",
    );
    input.priceRows.push(price("2026-07-09", 103, 104));
    const result = assessInvestmentLabVooReadiness(input);

    assert.ok(result.blockers.includes("execution_after_window"));
  });

  it("publishes raw-close price-return semantics and no fallback", () => {
    assert.deepEqual(INVESTMENT_LAB_VOO_READINESS_POLICY, {
      version: "investment_lab_voo_evidence_v2",
      instrumentKey: "us:USD:VOO",
      valuationPriceBasis: "raw_close_price_return",
      distributionTreatment: "excluded_not_reinvested",
      valuationPriceDate:
        "previous_us_trading_day_on_or_before_service_date_minus_one",
      valuationPriceProvenance: "stored_price_source_required",
      valuationFx: "exact_service_date_snapshot_source_rule_consensus",
      valuationFxProviderDate:
        "not_inferred_from_legacy_snapshot_evidence",
      executionPrice: "first_observed_raw_close_on_or_after_event_date",
      executionPriceProvenance: "stored_price_source_required",
      executionFx: "exact_usdkrw_rate_on_execution_price_date",
      executionFxProvenance: "stored_fx_source_and_ok_status_required",
      maxExecutionDelayDays: 7,
      lookAhead: "forbidden",
      latestSpotNearestFallback: "forbidden",
      incompleteOutput: "readiness_only_no_partial_path",
    });

    const source = [
      "src/lib/investment-lab-voo-evidence.ts",
      "src/lib/investment-lab-voo-readiness.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i,
    );
  });
});

function fixture() {
  const serviceDates = ["2026-07-06", "2026-07-07", "2026-07-08"];
  return {
    serviceDates,
    priceRows: [
      price("2026-07-02", 100, 101),
      price("2026-07-06", 101, 101),
      price("2026-07-07", 102, 102),
    ],
    snapshotRows: serviceDates.flatMap((snapshotDate) =>
      ["brokerage", "isa", "irp"].map((account) => ({
        snapshotDate,
        account,
        usdKrw: 1_300,
        source: "snapshot_fixture",
        ruleVersion: "snapshot-fixture-v1",
      })),
    ),
    fxRows: [fx("2026-07-06", 1_300), fx("2026-07-07", 1_301)],
    boundaryFlows: [
      flow("2026-07-03", 1, "inflow", 100),
      flow("2026-07-07", 2, "outflow", 50),
    ],
  };
}

function price(priceDate, closePrice, adjustedClosePrice) {
  return {
    priceDate,
    closePrice,
    adjustedClosePrice,
    source: "price_fixture",
  };
}

function fx(rateDate, usdKrw, status = "ok") {
  return { rateDate, usdKrw, source: "fx_fixture", status };
}

function flow(eventDate, sequence, direction, amountKrw) {
  return {
    eventDate,
    sequence,
    direction,
    amountKrw,
    amountProvenance: "explicit_amount_krw",
  };
}
