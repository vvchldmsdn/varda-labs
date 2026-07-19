import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";
import { resolveManualValuationPath } from "../src/lib/manual-valuation-history.ts";

const SERVICE_DATES = ["2026-01-06", "2026-01-07", "2026-01-08"];
const TARGET = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;

describe("manual valuation history path", () => {
  it("admits explicit observations and labels unchanged stored values as carry", () => {
    const result = resolveManualValuationPath({
      target: TARGET,
      serviceDates: SERVICE_DATES,
      snapshotRows: [
        manualRow("2026-01-06", "2026-01-06", 225_000),
        manualRow("2026-01-07", "2026-01-06", 225_000),
        manualRow("2026-01-08", "2026-01-08", 226_500),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.coverage, {
      requiredDateCount: 3,
      sourceRowCount: 3,
      admittedRowCount: 3,
      manualObservationRowCount: 2,
      carriedValuationRowCount: 1,
    });
    assert.deepEqual(
      result.rows.map((row) => [
        row.serviceDate,
        row.referenceDate,
        row.unitPriceKrw,
        row.provenance,
      ]),
      [
        ["2026-01-06", "2026-01-06", 225_000, "manual_observation"],
        ["2026-01-07", "2026-01-06", 225_000, "stored_manual_carry"],
        ["2026-01-08", "2026-01-08", 226_500, "manual_observation"],
      ],
    );
    assert.equal(JSON.stringify(result).includes("gold-asset-id"), false);
  });

  it("rejects mutable current-price provenance instead of backcasting it", () => {
    const result = resolveManualValuationPath({
      target: TARGET,
      serviceDates: SERVICE_DATES,
      snapshotRows: SERVICE_DATES.map((date) => ({
        ...manualRow(date, date, 225_000),
        priceSource: "asset_current_price",
      })),
    });

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(
      result.blockers.map((row) => [row.reason, row.serviceDate]),
      SERVICE_DATES.map((date) => [
        "invalid_manual_valuation_provenance",
        date,
      ]),
    );
  });

  it("rejects duplicate same-date state instead of choosing an arbitrary row", () => {
    const rows = SERVICE_DATES.map((date) => manualRow(date, date, 225_000));
    rows.push(manualRow("2026-01-07", "2026-01-07", 226_000));

    const result = resolveManualValuationPath({
      target: TARGET,
      serviceDates: SERVICE_DATES,
      snapshotRows: rows,
    });

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.rows, []);
    assert.ok(
      result.blockers.some(
        (row) =>
          row.reason === "duplicate_manual_valuation" &&
          row.serviceDate === "2026-01-07",
      ),
    );
  });

  it("rejects future-dated evidence and identity changes", () => {
    const future = resolveManualValuationPath({
      target: TARGET,
      serviceDates: SERVICE_DATES,
      snapshotRows: [
        manualRow("2026-01-06", "2026-01-07", 225_000),
        manualRow("2026-01-07", "2026-01-07", 225_000),
        manualRow("2026-01-08", "2026-01-08", 225_000),
      ],
    });
    assert.ok(
      future.blockers.some(
        (row) => row.reason === "future_dated_manual_valuation",
      ),
    );

    const identityChange = resolveManualValuationPath({
      target: TARGET,
      serviceDates: SERVICE_DATES,
      snapshotRows: SERVICE_DATES.map((date, index) => ({
        ...manualRow(date, date, 225_000),
        assetId: index === 2 ? "replacement-gold-id" : "gold-asset-id",
      })),
    });
    assert.ok(
      identityChange.blockers.some(
        (row) => row.reason === "manual_valuation_identity_mismatch",
      ),
    );
  });

  it("requires an ordered multi-date service axis", () => {
    const result = resolveManualValuationPath({
      target: TARGET,
      serviceDates: ["2026-01-07", "2026-01-06"],
      snapshotRows: [],
    });

    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.blockers, [
      { reason: "invalid_service_date_axis", serviceDate: null },
    ]);
  });
});

function manualRow(snapshotDate, referenceDate, currentPrice) {
  return {
    snapshotDate,
    assetId: "gold-asset-id",
    legacyAssetId: "legacy-gold-id",
    assetName: TARGET.assetName,
    account: TARGET.account,
    market: TARGET.market,
    currency: TARGET.currency,
    assetType: TARGET.assetType,
    source: "varda_manual_daily_snapshot",
    priceSource: "manual_entry",
    priceBasis: "manual_current",
    currentPrice,
    priceDate: referenceDate,
    referenceDate,
    capturedAt: `${snapshotDate}T22:00:00.000Z`,
  };
}
