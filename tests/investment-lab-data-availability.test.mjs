import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyInvestmentLabFountAvailabilityScope,
  buildInvestmentLabDataAvailability,
} from "../src/lib/investment-lab-data-availability.ts";

describe("investment lab data availability", () => {
  it("separates the latest trusted actual segment from legacy display evidence", () => {
    const model = buildInvestmentLabDataAvailability({
      account: "isa",
      snapshotRows: [
        snapshot("2026-07-01", "isa", "legacy"),
        snapshot("2026-07-02", "isa", "legacy"),
        snapshot("2026-07-07", "isa", "current"),
        snapshot("2026-07-08", "isa", "current"),
        snapshot("2026-07-09", "isa", "current"),
      ],
      marketHistory: marketHistory(),
    });

    assert.equal(model.status, "partial");
    assert.equal(model.actualHistory.legacyDisplayDateCount, 2);
    assert.equal(model.actualHistory.latestCurrentWriterDateCount, 3);
    assert.equal(
      model.actualHistory.latestCurrentWriterStartServiceDate,
      "2026-07-07",
    );
    assert.equal(model.marketHistory.status, "ready");
    assert.equal(model.marketHistory.multivariateStatus, "ready");
    assert.deepEqual(
      model.scenarioRows.map((row) => [row.id, row.status]),
      [
        ["same_flow_baselines", "limited_input_ready"],
        ["fixed_quantity", "market_only_ready"],
        ["scheduled_weights", "market_only_ready"],
        ["historical_policy_weights", "blocked"],
        ["hindsight_research", "research_only"],
      ],
    );
    assert.deepEqual(
      model.repairItems.map((row) => [row.id, row.status, row.affectedCount]),
      [
        ["actual_history", "review_required", 2],
        ["market_history", "not_needed", 0],
      ],
    );
  });

  it("requires explicit manual KRX gold history without blocking same-flow baselines", () => {
    const model = buildInvestmentLabDataAvailability({
      account: "brokerage",
      snapshotRows: [
        snapshot("2026-07-08", "brokerage", "current"),
        snapshot("2026-07-09", "brokerage", "current"),
      ],
      marketHistory: marketHistory({
        selectedHoldingCount: 11,
        eligibleHoldingCount: 10,
        includedInstrumentCount: 10,
        excludedHoldings: [goldExclusion()],
      }),
    });

    assert.deepEqual(model.specialHoldings, [
      { kind: "krx_gold", account: "brokerage", name: "금현물" },
    ]);
    assert.equal(scenario(model, "same_flow_baselines").status, "limited_input_ready");
    assert.equal(scenario(model, "fixed_quantity").status, "blocked");
    assert.ok(
      scenario(model, "fixed_quantity").reasons.includes(
        "manual_valuation_history_required",
      ),
    );
    assert.deepEqual(model.repairItems.at(-1), {
      id: "krx_gold",
      status: "manual_history_required",
      affectedCount: 1,
    });
    assert.equal(model.manualValuationHistory.status, "unavailable");
    assert.equal(model.manualValuationHistory.current.status, "unavailable");
  });

  it("separates manual observations from carried valuation rows", () => {
    const model = buildInvestmentLabDataAvailability({
      account: "brokerage",
      snapshotRows: [
        snapshot("2026-07-08", "brokerage", "current"),
        snapshot("2026-07-09", "brokerage", "current"),
      ],
      manualValuationCurrentRows: [manualCurrent()],
      manualValuationSnapshotRows: [
        manualSnapshot("2026-07-08", "2026-07-08"),
        manualSnapshot("2026-07-09", "2026-07-08"),
        manualSnapshot("2026-07-09", "2026-07-10"),
        {
          ...manualSnapshot("2026-07-07", "2026-07-07"),
          source: "base44_import",
        },
        {
          ...manualSnapshot("2026-07-08", "2026-07-08"),
          priceSource: "legacy_close",
        },
      ],
      marketHistory: marketHistory({
        selectedHoldingCount: 11,
        eligibleHoldingCount: 10,
        includedInstrumentCount: 10,
        excludedHoldings: [goldExclusion()],
      }),
    });

    assert.equal(
      model.manualValuationHistory.status,
      "current_segment_covered",
    );
    assert.equal(model.manualValuationHistory.current.status, "stored_manual");
    assert.equal(model.manualValuationHistory.current.price, 225750);
    assert.equal(
      model.manualValuationHistory.current.priceAsOf,
      "2026-07-09T03:00:00.000Z",
    );
    assert.deepEqual(model.manualValuationHistory.history, {
      sourceRowCount: 5,
      trustedValuationRowCount: 2,
      distinctManualObservationCount: 1,
      carriedValuationRowCount: 1,
      nonCurrentWriterRowCount: 1,
      nonManualValuationRowCount: 1,
      invalidRowCount: 0,
      futureDatedRowCount: 1,
      requiredCurrentSegmentDateCount: 2,
      coveredCurrentSegmentDateCount: 2,
      currentSegmentCoveragePct: 100,
      availableStartServiceDate: "2026-07-08",
      availableEndServiceDate: "2026-07-09",
      latestManualReferenceDate: "2026-07-08",
    });
    assert.equal(scenario(model, "fixed_quantity").status, "blocked");
    assert.ok(
      scenario(model, "fixed_quantity").reasons.includes(
        "manual_valuation_history_required",
      ),
    );
  });

  it("treats Fount as a scope transform, not a price backfill", () => {
    const model = buildInvestmentLabDataAvailability({
      account: "irp",
      snapshotRows: [
        snapshot("2026-07-08", "irp", "current"),
        snapshot("2026-07-09", "irp", "current"),
      ],
      marketHistory: marketHistory({
        inputStatus: "insufficient_instruments",
        selectedHoldingCount: 2,
        eligibleHoldingCount: 1,
        includedInstrumentCount: 1,
        excludedHoldings: [fountExclusion()],
      }),
    });

    assert.equal(model.marketHistory.status, "ready");
    assert.equal(model.marketHistory.multivariateStatus, "unavailable");
    assert.deepEqual(model.specialHoldings, [
      { kind: "fount", account: "irp", name: "Fount 일임서비스" },
    ]);
    assert.ok(model.scenarioRows.every((row) => row.status === "blocked"));
    assert.deepEqual(model.repairItems.at(-1), {
      id: "fount",
      status: "scope_transform_required",
      affectedCount: 1,
    });

    const adjusted = applyInvestmentLabFountAvailabilityScope(
      model,
      "applied",
    );
    assert.equal(adjusted.status, "partial");
    assert.equal(
      scenario(adjusted, "same_flow_baselines").status,
      "limited_input_ready",
    );
    assert.equal(
      scenario(adjusted, "fixed_quantity").status,
      "market_only_ready",
    );
    assert.ok(
      adjusted.scenarioRows.every(
        (row) => !row.reasons.includes("fount_scope_adjustment_required"),
      ),
    );
    assert.deepEqual(adjusted.repairItems.at(-1), {
      id: "fount",
      status: "not_needed",
      affectedCount: 1,
    });
  });

  it("requires a complete named-account axis for the all-account current segment", () => {
    const rows = [
      ...snapshotDate("2026-07-07", "legacy"),
      ...snapshotDate("2026-07-08", "current"),
      ...snapshotDate("2026-07-09", "current").slice(0, 2),
    ];
    const model = buildInvestmentLabDataAvailability({
      account: "all",
      snapshotRows: rows,
      marketHistory: marketHistory({
        priceGapCount: 2,
        fxGapCount: 1,
        usableReturnObservations: 88,
        returnCoveragePct: 97.78,
      }),
    });

    assert.equal(model.actualHistory.latestCurrentWriterDateCount, 1);
    assert.equal(model.actualHistory.invalidDateCount, 1);
    assert.equal(scenario(model, "same_flow_baselines").status, "blocked");
    assert.equal(model.marketHistory.status, "partial");
    assert.deepEqual(model.repairItems[1], {
      id: "market_history",
      status: "provider_backfill_candidate",
      affectedCount: 3,
    });
  });
});

function marketHistory(overrides = {}) {
  return {
    inputStatus: "ready",
    requestedReturnObservations: 90,
    usableReturnObservations: 90,
    returnCoveragePct: 100,
    selectedHoldingCount: 4,
    eligibleHoldingCount: 4,
    includedInstrumentCount: 4,
    excludedHoldings: [],
    blockerCount: 0,
    priceGapCount: 0,
    fxGapCount: 0,
    ...overrides,
  };
}

function snapshot(snapshotDate, account, role) {
  return {
    snapshotDate,
    account,
    source:
      role === "current" ? "varda_manual_daily_snapshot" : "base44_import",
    ruleVersion:
      role === "current" ? "varda-manual-daily-snapshot-v1" : null,
  };
}

function snapshotDate(snapshotDate, role) {
  return ["brokerage", "isa", "irp"].map((account) =>
    snapshot(snapshotDate, account, role),
  );
}

function goldExclusion() {
  return {
    account: "brokerage",
    ticker: null,
    name: "금현물",
    market: "korea",
    currency: "KRW",
    assetType: "commodity",
    reason: "missing_ticker",
  };
}

function fountExclusion() {
  return {
    account: "irp",
    ticker: null,
    name: "Fount 일임서비스",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    reason: "missing_ticker",
  };
}

function manualCurrent() {
  return {
    assetId: "gold-asset",
    assetName: "금현물",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    assetType: "commodity",
    currentPrice: "225750",
    priceSource: "manual_entry",
    priceAsOf: "2026-07-09T03:00:00.000Z",
    priceQuoteType: "manual_valuation",
    priceStatus: "stored_manual",
  };
}

function manualSnapshot(snapshotDate, referenceDate) {
  return {
    snapshotDate,
    assetId: "gold-asset",
    legacyAssetId: "legacy-gold",
    assetName: "금현물",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    assetType: "commodity",
    source: "varda_manual_daily_snapshot",
    priceSource: "manual_entry",
    priceBasis: "manual_current",
    currentPrice: "225750",
    priceDate: referenceDate,
    referenceDate,
    capturedAt: `${snapshotDate}T22:00:00.000Z`,
  };
}

function scenario(model, id) {
  return model.scenarioRows.find((row) => row.id === id);
}
