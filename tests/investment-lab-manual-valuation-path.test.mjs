import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-read-loader.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";

const WRITER = "varda_manual_daily_snapshot";
const GOLD = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
const FOUNT = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;

describe("investment lab stored manual valuation path", () => {
  it("combines listed closes with provenance-safe KRX Gold observations", async () => {
    const input = goldFixture();
    let requestedInstruments = null;
    const scenario = await loadInvestmentLabAnchorBasketScenario({
      account: "brokerage",
      repository: {
        async loadAnchorPositionRows() {
          return input.positionRows;
        },
        async loadAnchorPriceRows(request) {
          requestedInstruments = request.instruments;
          return input.priceRows;
        },
      },
      model: readModel(input.actualPath),
      source: source(input),
      fxRows: [],
    });

    assert.equal(scenario.status, "ready");
    assert.deepEqual(
      requestedInstruments.map((row) => [row.key, row.valuationModel]),
      [
        ["korea:KRW:AAA", "listed_close"],
        ["manual:gold_9999_1kg", "stored_manual"],
      ],
    );
    assert.equal(scenario.summary.instrumentCount, 2);
    assert.equal(scenario.coverage.manualValuationComponentCount, 1);
    assert.equal(scenario.coverage.manualObservationRows, 2);
    assert.equal(scenario.coverage.manualCarryRows, 1);
    assert.equal(
      scenario.anchor.specialHoldingEvidence[0].historicalCoverageStatus,
      "covered",
    );
    assert.equal(
      scenario.anchor.specialHoldingEvidence[0].reason,
      "stored_manual_valuation_history_covered",
    );
    assert.equal(scenario.rows.length, 3);
    assert.equal(JSON.stringify(scenario).includes("gold-asset-id"), false);
  });

  it("keeps the basket unavailable when stored Gold rows lack manual provenance", async () => {
    const input = goldFixture();
    input.positionRows = input.positionRows.map((row) =>
      row.assetName === GOLD.assetName
        ? {
            ...row,
            priceSource: "asset_current_price",
            priceDate: null,
            referenceDate: null,
          }
        : row,
    );
    let priceReads = 0;

    const scenario = await loadInvestmentLabAnchorBasketScenario({
      account: "brokerage",
      repository: {
        async loadAnchorPositionRows() {
          return input.positionRows;
        },
        async loadAnchorPriceRows() {
          priceReads += 1;
          return input.priceRows;
        },
      },
      model: readModel(input.actualPath),
      source: source(input),
      fxRows: [],
    });

    assert.equal(priceReads, 1);
    assert.equal(scenario.status, "unavailable");
    assert.deepEqual(scenario.rows, []);
    assert.ok(
      scenario.evidenceBlockers.some(
        (row) => row.reason === "invalid_manual_valuation_provenance",
      ),
    );
  });

  it("applies the reviewed Fount exclusion to the anchor basket scope", async () => {
    const serviceDates = ["2026-01-06", "2026-01-07", "2026-01-08"];
    const snapshotRows = serviceDates.map((snapshotDate, index) => ({
      snapshotDate,
      account: "irp",
      cashValue: 0,
      totalMarketValue: 500 + index * 50,
      usdKrw: 1_400,
      source: WRITER,
      ruleVersion: "fixture_v1",
    }));
    const positionRows = serviceDates.flatMap((snapshotDate) => [
      listedPosition(snapshotDate, "irp"),
      {
        snapshotDate,
        account: FOUNT.account,
        source: WRITER,
        ticker: null,
        assetName: FOUNT.assetName,
        market: FOUNT.market,
        currency: FOUNT.currency,
        assetType: FOUNT.assetType,
        quantity: 1,
        marketValueKrw: 100,
      },
    ]);
    let requestedInstruments = null;

    const scenario = await loadInvestmentLabAnchorBasketScenario({
      account: "irp",
      fountScopeAdjustmentStatus: "applied",
      repository: {
        async loadAnchorPositionRows() {
          return positionRows;
        },
        async loadAnchorPriceRows(request) {
          requestedInstruments = request.instruments;
          return listedPrices();
        },
      },
      model: readModel(
        serviceDates.map((serviceDate, index) => ({
          serviceDate,
          totalMarketValueKrw: 400 + index * 40,
        })),
      ),
      source: {
        eventRows: [],
        snapshotRows,
        closeRows: [],
        vooCloseRows: [],
        fxRows: [],
      },
      fxRows: [],
    });

    assert.equal(scenario.status, "ready");
    assert.deepEqual(
      requestedInstruments.map((row) => row.key),
      ["korea:KRW:AAA"],
    );
    assert.equal(scenario.summary.instrumentCount, 1);
    assert.equal(scenario.anchor.coverage.sourcePositionRows, 1);
    assert.deepEqual(scenario.anchor.specialHoldingEvidence, []);
  });
});

function goldFixture() {
  const serviceDates = ["2026-01-06", "2026-01-07", "2026-01-08"];
  const snapshotRows = serviceDates.map((snapshotDate, index) => ({
    snapshotDate,
    account: "brokerage",
    cashValue: 0,
    totalMarketValue: 1_000 + index * 100,
    usdKrw: 1_400,
    source: WRITER,
    ruleVersion: "fixture_v1",
  }));
  const goldReferences = ["2026-01-06", "2026-01-06", "2026-01-08"];
  const goldPrices = [225_000, 225_000, 226_500];
  return {
    snapshotRows,
    positionRows: serviceDates.flatMap((snapshotDate, index) => [
      listedPosition(snapshotDate, "brokerage"),
      {
        snapshotDate,
        assetId: "gold-asset-id",
        legacyAssetId: "legacy-gold-id",
        account: GOLD.account,
        source: WRITER,
        ticker: null,
        assetName: GOLD.assetName,
        market: GOLD.market,
        currency: GOLD.currency,
        assetType: GOLD.assetType,
        quantity: 8,
        marketValueKrw: goldPrices[index] * 8,
        priceSource: "manual_entry",
        priceBasis: "manual_current",
        currentPrice: goldPrices[index],
        priceDate: goldReferences[index],
        referenceDate: goldReferences[index],
        capturedAt: `${snapshotDate}T22:00:00.000Z`,
      },
    ]),
    priceRows: listedPrices(),
    actualPath: serviceDates.map((serviceDate, index) => ({
      serviceDate,
      totalMarketValueKrw: 1_000 + index * 100,
    })),
  };
}

function listedPosition(snapshotDate, account) {
  return {
    snapshotDate,
    account,
    source: WRITER,
    ticker: "AAA",
    assetName: "Listed fixture ETF",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    quantity: 1,
    marketValueKrw: 500,
  };
}

function listedPrices() {
  return [
    listedPrice("2026-01-05", 10),
    listedPrice("2026-01-06", 11),
    listedPrice("2026-01-07", 12),
  ];
}

function listedPrice(priceDate, closePrice) {
  return {
    ticker: "AAA",
    market: "korea",
    currency: "KRW",
    priceDate,
    closePrice,
    source: "fixture_close",
  };
}

function readModel(actualPath) {
  return {
    status: "ready",
    observedPath: {
      status: "ready",
      rows: actualPath.map((row) => ({
        serviceDate: row.serviceDate,
        marketValueKrw: row.totalMarketValueKrw,
      })),
    },
    scenario: {},
    summary: null,
    returnEstimate: null,
    vooReadiness: null,
    vooComparison: null,
    cashComparison: null,
    fixedMixScenario: null,
    contributionExperimentScenarios: [],
    rows: actualPath.map((row) => ({
      serviceDate: row.serviceDate,
      actualMarketValueKrw: row.totalMarketValueKrw,
      scenarioMarketValueKrw: row.totalMarketValueKrw,
      differenceKrw: 0,
      valuationPriceDate: row.serviceDate,
      valuationCarryDays: 0,
      hasPendingExecution: false,
    })),
    coverage: {},
    blockers: [],
  };
}

function source(input) {
  return {
    eventRows: [],
    snapshotRows: input.snapshotRows,
    closeRows: [],
    vooCloseRows: [],
    fxRows: [],
  };
}
