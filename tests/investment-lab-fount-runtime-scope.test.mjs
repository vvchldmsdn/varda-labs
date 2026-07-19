import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyInvestmentLabFountRuntimeScope } from "../src/lib/investment-lab-fount-runtime-scope.ts";

const FOUNT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SOURCE = "varda_manual_daily_snapshot";

describe("investment lab Fount runtime scope", () => {
  it("subtracts Fount on the exact account-date axis and derives all from named accounts", () => {
    const source = fixture();
    const result = applyInvestmentLabFountRuntimeScope({
      account: "all",
      serviceDates: ["2026-07-08", "2026-07-09"],
      source,
      allEventRows: [],
      evidence: readyEvidence(),
    });

    assert.equal(result.scope.status, "applied");
    assert.equal(result.scope.adjustedDateCount, 2);
    assert.equal(result.scope.excludedAccount, "irp");
    assert.equal(result.source.snapshotRows.some((row) => row.account === "all"), false);
    assert.deepEqual(
      result.source.snapshotRows
        .filter((row) => row.account === "irp")
        .map((row) => row.totalMarketValue),
      ["250.000000", "280.000000"],
    );
    assert.equal(source.snapshotRows.length, 8);
  });

  it("does not load an unrelated named account through the exclusion path", () => {
    const source = fixture();
    const result = applyInvestmentLabFountRuntimeScope({
      account: "brokerage",
      serviceDates: ["2026-07-08", "2026-07-09"],
      source,
      allEventRows: [],
      evidence: { status: "unavailable", reason: "binding_ambiguous" },
    });

    assert.equal(result.scope.status, "not_applicable");
    assert.equal(result.source, source);
  });

  it("blocks the affected scope without returning a partially adjusted path", () => {
    const source = fixture();
    const result = applyInvestmentLabFountRuntimeScope({
      account: "irp",
      serviceDates: ["2026-07-08", "2026-07-09"],
      source,
      allEventRows: [],
      evidence: { status: "unavailable", reason: "binding_metadata_conflict" },
    });

    assert.equal(result.scope.status, "blocked");
    assert.equal(result.scope.adjustedDateCount, 0);
    assert.equal(result.source, source);
  });
});

function fixture() {
  return Object.freeze({
    snapshotRows: Object.freeze([
      ...snapshotDate("2026-07-08", 500, 300, 350),
      ...snapshotDate("2026-07-09", 550, 350, 400),
    ]),
    eventRows: Object.freeze([]),
    closeRows: Object.freeze([]),
    vooCloseRows: Object.freeze([]),
    fxRows: Object.freeze([]),
  });
}

function snapshotDate(date, brokerage, isa, irp) {
  return [
    snapshot(date, "brokerage", brokerage),
    snapshot(date, "isa", isa),
    snapshot(date, "irp", irp),
    snapshot(date, "all", brokerage + isa + irp),
  ];
}

function snapshot(snapshotDate, account, totalMarketValue) {
  return Object.freeze({
    snapshotDate,
    account,
    cashValue: "0.000000",
    totalMarketValue: `${totalMarketValue}.000000`,
    usdKrw: "1300.000000",
    source: SOURCE,
    ruleVersion: "varda-manual-daily-snapshot-v1",
  });
}

function readyEvidence() {
  return {
    status: "ready",
    binding: {
      selectorBasis: "exact_snapshot_legacy_asset_id",
      snapshotLegacyAssetId: FOUNT_ID,
      account: "irp",
    },
    positionRows: [
      position("2026-07-08", "100.000000"),
      position("2026-07-09", "120.000000"),
    ],
  };
}

function position(snapshotDate, marketValueKrw) {
  return {
    snapshotDate,
    account: "irp",
    source: SOURCE,
    snapshotLegacyAssetId: FOUNT_ID,
    marketValueKrw,
  };
}
