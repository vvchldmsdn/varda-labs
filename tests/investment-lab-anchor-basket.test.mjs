import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInvestmentLabAnchorSelection } from "../src/lib/investment-lab-anchor-basket-anchor.ts";
import { resolveInvestmentLabAnchorBasketEvidence } from "../src/lib/investment-lab-anchor-basket-evidence.ts";
import { loadInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-read-loader.ts";
import { buildInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-scenario.ts";

describe("investment lab anchor-date observed basket", () => {
  it("aggregates the same economic identity across accounts at the anchor", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "ready");
    assert.equal(anchor.selectedAnchorDate, "2026-01-06");
    assert.equal(anchor.candidateAnchorDates.length, 1);
    assert.equal(anchor.instruments.length, 2);
    assert.deepEqual(
      anchor.instruments.map((row) => [row.key, row.sourceRows, row.accountCount]),
      [
        ["korea:KRW:AAA", 2, 2],
        ["us:USD:BBB", 1, 1],
      ],
    );
    assert.equal(anchor.coverage.sourcePositionRows, 3);
    assert.equal(anchor.coverage.unresolvedPositionRows, 0);
  });

  it("builds an equal-at-anchor path and equal-splits later flows without rebalancing", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });
    const evidence = resolveInvestmentLabAnchorBasketEvidence({
      anchor,
      serviceDates: input.serviceDates,
      priceRows: input.priceRows,
      snapshotRows: input.snapshotRows,
      fxRows: input.fxRows,
      boundaryFlows: input.boundaryFlows,
    });
    const scenario = buildInvestmentLabAnchorBasketScenario({
      anchor,
      actualPath: input.actualPath,
      evidence,
      actualReturn: 0.1,
    });

    assert.equal(evidence.status, "ready");
    assert.equal(scenario.status, "ready");
    assert.equal(scenario.summary.instrumentCount, 2);
    assert.equal(scenario.summary.equalWeightPct, 50);
    assert.deepEqual(
      scenario.rows.map((row) => Math.round(row.scenarioMarketValueKrw)),
      [1000, 1100, 1300],
    );
    assert.equal(scenario.coverage.sourceFlowCount, 1);
    assert.equal(scenario.coverage.scenarioFlowLegCount, 2);
    assert.equal(scenario.returnEstimate.actualReturn, 0.1);
  });

  it("blocks the whole basket for tickerless or physical stored holdings", () => {
    const input = fixture();
    input.positionRows.push({
      snapshotDate: "2026-01-06",
      account: "brokerage",
      source: "stored",
      ticker: null,
      assetName: "stored physical holding",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
      quantity: 1,
      marketValueKrw: 100,
    });
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "unavailable");
    assert.deepEqual(anchor.instruments, []);
    assert.equal(anchor.coverage.sourcePositionRows, 4);
    assert.equal(anchor.coverage.recognizedPositionRows, 3);
    assert.equal(anchor.coverage.unresolvedPositionRows, 1);
    assert.deepEqual(anchor.blockers, [
      "physical_anchor_holding",
      "tickerless_anchor_holding",
    ]);
  });

  it("does not return a partial path when one component price is missing", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });
    const evidence = resolveInvestmentLabAnchorBasketEvidence({
      anchor,
      serviceDates: input.serviceDates,
      priceRows: input.priceRows.filter(
        (row) => !(row.ticker === "BBB" && row.priceDate === "2026-01-06"),
      ),
      snapshotRows: input.snapshotRows,
      fxRows: input.fxRows,
      boundaryFlows: input.boundaryFlows,
    });

    assert.equal(evidence.status, "unavailable");
    assert.deepEqual(evidence.components, []);
    assert.ok(
      evidence.blockers.some(
        (row) =>
          row.reason === "missing_valuation_price" &&
          row.instrumentKey === "us:USD:BBB",
      ),
    );
  });

  it("does not query broad price history when anchor evidence is incomplete", async () => {
    const input = fixture();
    input.positionRows.push({
      snapshotDate: "2026-01-06",
      account: "brokerage",
      source: "stored",
      ticker: null,
      assetName: "unresolved",
      market: "korea",
      currency: "KRW",
      assetType: null,
      quantity: 1,
      marketValueKrw: 1,
    });
    let priceReads = 0;
    const scenario = await loadInvestmentLabAnchorBasketScenario({
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
      source: {
        eventRows: [],
        snapshotRows: input.snapshotRows,
        closeRows: [],
        vooCloseRows: [],
        fxRows: input.fxRows,
      },
      fxRows: input.fxRows,
    });

    assert.equal(scenario.status, "unavailable");
    assert.equal(priceReads, 0);
    assert.deepEqual(scenario.blockers, [
      {
        reason: "anchor_selection_unavailable",
        instrumentKey: null,
        detail: null,
      },
    ]);
  });
});

function fixture() {
  const serviceDates = ["2026-01-06", "2026-01-07", "2026-01-08"];
  const snapshotRows = serviceDates.flatMap((snapshotDate, dateIndex) =>
    ["brokerage", "isa", "irp"].map((account) => ({
      snapshotDate,
      account,
      cashValue: 0,
      totalMarketValue: dateIndex === 0 ? 1000 / 3 : (1000 + dateIndex * 100) / 3,
      usdKrw: 1400,
      source: "stored",
      ruleVersion: "fixture_v1",
    })),
  );
  return {
    serviceDates,
    snapshotRows,
    positionRows: [
      position("brokerage", "AAA", "Alpha", "korea", "KRW", 500),
      position("irp", "AAA", "Alpha", "korea", "KRW", 100),
      position("isa", "BBB", "Beta", "us", "USD", 400),
    ],
    priceRows: [
      price("AAA", "korea", "KRW", "2026-01-05", 10),
      price("AAA", "korea", "KRW", "2026-01-06", 11),
      price("AAA", "korea", "KRW", "2026-01-07", 12),
      price("BBB", "us", "USD", "2026-01-05", 1),
      price("BBB", "us", "USD", "2026-01-06", 1.1),
      price("BBB", "us", "USD", "2026-01-07", 1.2),
    ],
    fxRows: [
      {
        rateDate: "2026-01-07",
        usdKrw: 1400,
        source: "fixture",
        status: "ok",
      },
    ],
    boundaryFlows: [
      {
        eventDate: "2026-01-07",
        sequence: 1,
        direction: "inflow",
        amountKrw: 100,
        amountProvenance: "explicit_amount_krw",
      },
    ],
    actualPath: [
      { serviceDate: "2026-01-06", totalMarketValueKrw: 1000 },
      { serviceDate: "2026-01-07", totalMarketValueKrw: 1100 },
      { serviceDate: "2026-01-08", totalMarketValueKrw: 1200 },
    ],
  };
}

function position(account, ticker, assetName, market, currency, marketValueKrw) {
  return {
    snapshotDate: "2026-01-06",
    account,
    source: "stored",
    ticker,
    assetName,
    market,
    currency,
    assetType: "etf",
    quantity: 1,
    marketValueKrw,
  };
}

function price(ticker, market, currency, priceDate, closePrice) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    closePrice,
    source: "fixture",
  };
}

function readModel(actualPath) {
  return {
    status: "ready",
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
