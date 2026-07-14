import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-loader.ts";
import {
  resolveInvestmentLabPeriodSelection,
  sliceInvestmentLabCounterfactualInput,
} from "../src/lib/investment-lab-period-selection.ts";

describe("investment lab period selection", () => {
  it("keeps the default full-range request explicit", () => {
    const result = resolveInvestmentLabPeriodSelection({
      availableServiceDates: ["2026-01-02", "2026-01-05"],
    });

    assert.equal(result.status, "full");
    assert.equal(result.availableStartServiceDate, "2026-01-02");
    assert.equal(result.availableEndServiceDate, "2026-01-05");
    assert.equal(result.reason, null);
  });

  it("rejects ambiguous, incomplete, reversed, and unobserved requests", () => {
    const availableServiceDates = [
      "2026-01-02",
      "2026-01-05",
      "2026-01-06",
    ];
    const cases = [
      {
        request: {
          startServiceDate: ["2026-01-02", "2026-01-05"],
          endServiceDate: "2026-01-06",
        },
        reason: "ambiguous_query",
      },
      {
        request: { startServiceDate: "2026-01-02" },
        reason: "both_dates_required",
      },
      {
        request: {
          startServiceDate: "2026-01-06",
          endServiceDate: "2026-01-05",
        },
        reason: "invalid_order",
      },
      {
        request: {
          startServiceDate: "2026-01-03",
          endServiceDate: "2026-01-06",
        },
        reason: "start_not_observed",
      },
    ];

    for (const testCase of cases) {
      const result = resolveInvestmentLabPeriodSelection({
        request: testCase.request,
        availableServiceDates,
      });
      assert.equal(result.status, "invalid");
      assert.equal(result.reason, testCase.reason);
      assert.equal(result.selectedStartServiceDate, null);
      assert.equal(result.selectedEndServiceDate, null);
    }
  });

  it("slices source evidence around the selected anchor instead of trimming output rows", () => {
    const source = fixture();
    const selection = resolveInvestmentLabPeriodSelection({
      request: {
        startServiceDate: "2026-01-05",
        endServiceDate: "2026-01-07",
      },
      availableServiceDates: [
        "2026-01-02",
        "2026-01-05",
        "2026-01-06",
        "2026-01-07",
      ],
    });
    const sliced = sliceInvestmentLabCounterfactualInput(source, selection);

    assert.equal(selection.status, "selected");
    assert.deepEqual(
      [...new Set(sliced.snapshotRows.map((row) => row.snapshotDate))],
      ["2026-01-05", "2026-01-06", "2026-01-07"],
    );
    assert.deepEqual(
      sliced.eventRows.map((row) => row.eventDate),
      ["2026-01-06"],
    );
    assert.ok(
      sliced.closeRows.some((row) => row.priceDate < "2026-01-05"),
      "the selected anchor needs prior close evidence",
    );
  });

  it("re-anchors and recomputes the selected actual, KODEX 200, VOO, and return paths", async () => {
    const result = await loadInvestmentLabCounterfactualReadModel(
      repository(fixture()),
      {
        startServiceDate: "2026-01-05",
        endServiceDate: "2026-01-07",
      },
    );

    assert.equal(result.period.status, "selected");
    assert.equal(result.model.status, "ready");
    assert.equal(result.model.summary.startServiceDate, "2026-01-05");
    assert.equal(result.model.summary.endServiceDate, "2026-01-07");
    assert.equal(result.model.rows.length, 3);
    assert.equal(
      result.model.rows[0].scenarioMarketValueKrw,
      result.model.rows[0].actualMarketValueKrw,
    );
    assert.equal(result.model.coverage.appliedFlowRows, 1);
    assert.equal(result.model.returnEstimate.status, "ready");
    assert.equal(result.model.returnEstimate.actualFlowCount, 1);
    assert.equal(result.model.vooComparison.status, "ready");
    assert.equal(result.model.vooComparison.coverage.appliedFlowRows, 1);
  });

  it("hides the whole selected range when one fixed comparison lacks evidence", async () => {
    const source = fixture();
    source.fxRows = [];
    const result = await loadInvestmentLabCounterfactualReadModel(
      repository(source),
      {
        startServiceDate: "2026-01-05",
        endServiceDate: "2026-01-07",
      },
    );

    assert.equal(result.model.status, "ready");
    assert.equal(result.model.vooComparison.status, "unavailable");
    assert.equal(result.period.status, "unavailable");
    assert.equal(result.period.reason, "range_evidence_incomplete");
  });
});

function repository(source) {
  return {
    async loadEvents() {
      return source.eventRows;
    },
    async loadSnapshots() {
      return source.snapshotRows;
    },
    async loadScenarioCloses() {
      return source.closeRows;
    },
    async loadVooCloses() {
      return source.vooCloseRows;
    },
    async loadFxRows() {
      return source.fxRows;
    },
  };
}

function fixture() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", 1_000),
      ...snapshotDate("2026-01-05", 1_050),
      ...snapshotDate("2026-01-06", 1_100),
      ...snapshotDate("2026-01-07", 1_150),
    ],
    eventRows: [
      event("2026-01-03", 0, "buy", 220),
      event("2026-01-04", 1, "sell", 110),
      event("2026-01-06", 2, "buy", 121),
      event("2026-01-04", 3, "asset_added", null),
    ],
    closeRows: [
      price("2026-01-01", 100, 100),
      price("2026-01-05", 110, 110),
      price("2026-01-06", 121, 121),
    ],
    vooCloseRows: [
      price("2025-12-31", 100, 101),
      price("2026-01-02", 101, 102),
      price("2026-01-05", 102, 103),
      price("2026-01-06", 103, 104),
    ],
    fxRows: [
      {
        rateDate: "2026-01-05",
        usdKrw: 1_300,
        source: "fx_fixture",
        status: "ok",
      },
      {
        rateDate: "2026-01-06",
        usdKrw: 1_301,
        source: "fx_fixture",
        status: "ok",
      },
    ],
  };
}

function snapshotDate(snapshotDate, total) {
  return [
    snapshot(snapshotDate, "brokerage", total * 0.5),
    snapshot(snapshotDate, "isa", total * 0.3),
    snapshot(snapshotDate, "irp", total * 0.2),
  ];
}

function snapshot(snapshotDate, account, totalMarketValue) {
  return {
    snapshotDate,
    account,
    cashValue: 0,
    totalMarketValue,
    usdKrw: 1_300,
    source: "snapshot_fixture",
    ruleVersion: "snapshot-fixture-v1",
  };
}

function event(eventDate, sequence, eventType, amountKrw) {
  return {
    eventDate,
    eventType,
    sequence,
    amountKrw,
    quantityDelta: null,
    price: null,
    fxRate: null,
    assetCurrency: "KRW",
    isCorrection: false,
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
