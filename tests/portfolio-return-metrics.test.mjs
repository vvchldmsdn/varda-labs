import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReturnMetricsSummary,
  getAssetReturnMetrics,
  getSelectedRealizedRows,
  summarizeRealizedReturnForAccount,
} from "../src/lib/portfolio-return-metrics-core.ts";

const asset = {
  id: "asset-current-id",
  legacyBase44Id: "asset-legacy-id",
  account: "brokerage",
  ticker: "VOO",
  name: "Vanguard S&P 500 ETF",
  currency: "USD",
  quantity: "6",
  averageCost: "100",
  currentPrice: "120",
  fractionalAvgCost: null,
};

function tradeEvent(overrides) {
  return {
    eventDate: "2026-01-01",
    eventType: "buy",
    account: "brokerage",
    assetId: null,
    legacyAssetId: "asset-legacy-id",
    ticker: "VOO",
    assetName: "Vanguard S&P 500 ETF",
    amountKrw: null,
    quantityDelta: null,
    price: null,
    fxRate: null,
    beforeValue: null,
    afterValue: null,
    memo: null,
    recordedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("portfolio return metrics", () => {
  it("calculates realized return from chronological buy and sell ledger events", () => {
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          id: "sell-event-id",
          eventDate: "2026-02-01",
          eventType: "sell",
          amountKrw: "520000",
          quantityDelta: "-4",
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
        tradeEvent({
          eventDate: "2026-01-05",
          eventType: "buy",
          amountKrw: "1000000",
          quantityDelta: "10",
          createdAt: "2026-01-05T00:00:00.000Z",
        }),
        tradeEvent({
          eventDate: "2026-03-01",
          eventType: "buy",
          amountKrw: "130000",
          quantityDelta: "1",
          createdAt: "2026-03-01T00:00:00.000Z",
        }),
      ],
      [asset],
      1300,
      { asOfDate: "2026-02-28" },
    );

    assert.equal(summary.tradeEventCount, 2);
    assert.equal(summary.buyEventCount, 1);
    assert.equal(summary.sellEventCount, 1);
    assert.equal(summary.realizedSellEventCount, 1);
    assert.equal(summary.realizedCostBasisKrw, 400000);
    assert.equal(summary.realizedPnlKrw, 120000);
    assert.equal(summary.realizedRows[0].eventId, "sell-event-id");
    assert.equal(summary.realizedRows[0].eventDate, "2026-02-01");
    assert.equal(summary.realizedRows[0].eventType, "sell");

    const metrics = getAssetReturnMetrics(summary, asset, 1300);
    assert.equal(metrics.costBasisKrw, 780000);
    assert.equal(metrics.realizedCostBasisKrw, 400000);
    assert.equal(metrics.realizedPnlKrw, 120000);
    assert.equal(metrics.missingCost, false);
  });

  it("prefers explicit trade metrics over running ledger estimates", () => {
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventDate: "2026-01-05",
          eventType: "buy",
          amountKrw: "1000000",
          quantityDelta: "10",
          createdAt: "2026-01-05T00:00:00.000Z",
        }),
        tradeEvent({
          id: "explicit-sell-event-id",
          eventDate: "2026-02-01",
          eventType: "sell",
          amountKrw: "520000",
          quantityDelta: "-4",
          afterValue: {
            trade_metrics: {
              disposed_cost_krw: 450000,
              realized_pnl_krw: 125000,
            },
          },
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      [asset],
      1300,
    );

    assert.equal(summary.realizedCostBasisKrw, 450000);
    assert.equal(summary.realizedPnlKrw, 125000);

    const metrics = getAssetReturnMetrics(summary, asset, 1300);
    assert.equal(metrics.realizedCostBasisKrw, 450000);
    assert.equal(metrics.realizedPnlKrw, 125000);
    assert.equal(metrics.missingCost, false);
  });

  it("derives sell quantity, account, and USD KRW values from before/after fallback", () => {
    const usdAsset = {
      ...asset,
      id: "isa-us-asset-id",
      legacyBase44Id: "isa-us-legacy-id",
      account: "isa",
      quantity: "3",
      averageCost: "100",
      currentPrice: "120",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          id: "fallback-sell-event-id",
          eventDate: "2026-02-01",
          eventType: "sell",
          account: null,
          legacyAssetId: "isa-us-legacy-id",
          amountKrw: null,
          quantityDelta: null,
          price: "110",
          fxRate: "1200",
          beforeValue: JSON.stringify({
            account: "isa",
            quantity: 5,
            average_cost: 100,
          }),
          afterValue: JSON.stringify({ quantity: 3 }),
          createdAt: "2026-02-01T00:00:00.000Z",
        }),
      ],
      [usdAsset],
      1300,
    );

    assert.equal(summary.realizedCostBasisKrw, 240000);
    assert.equal(summary.realizedPnlKrw, 24000);
    assert.equal(summary.realizedRows[0].account, "isa");

    const metrics = getAssetReturnMetrics(summary, usdAsset, 1300);
    assert.equal(metrics.realizedCostBasisKrw, 240000);
    assert.equal(metrics.realizedPnlKrw, 24000);
    assert.equal(metrics.missingCost, false);
  });

  it("preserves unmatched realized rows and filters them by account", () => {
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventDate: "2026-02-01",
          eventType: "sell",
          account: "isa",
          legacyAssetId: "missing-legacy-id",
          ticker: "AIPO",
          assetName: "AIPO",
          amountKrw: "100000",
          quantityDelta: "-1",
          memo: "realized_pnl_krw=25000",
        }),
      ],
      [asset],
      1300,
    );

    assert.equal(summary.unmatchedSellEventCount, 1);
    assert.equal(summary.missingCostSellEventCount, 1);
    assert.equal(summary.realizedPnlKrw, 25000);

    assert.equal(getSelectedRealizedRows(summary, "brokerage", new Set()).length, 0);
    assert.equal(getSelectedRealizedRows(summary, "isa", new Set()).length, 1);
    assert.equal(getSelectedRealizedRows(summary, "all", new Set()).length, 1);

    const isaSummary = summarizeRealizedReturnForAccount(summary, "isa", new Set());
    assert.equal(isaSummary.realizedPnlKrw, 25000);
    assert.equal(isaSummary.unmatchedSellEventCount, 1);
    assert.equal(isaSummary.missingCostSellEventCount, 1);

    const metrics = getAssetReturnMetrics(summary, asset, 1300);
    assert.equal(metrics.realizedPnlKrw, 0);
    assert.equal(metrics.realizedCostBasisKrw, 0);
  });

  it("summarizes realized rows across account filters and legacy asset mappings", () => {
    const isaAsset = {
      ...asset,
      id: "isa-current-id",
      legacyBase44Id: "isa-legacy-id",
      account: "isa",
      ticker: "069500",
      name: "KODEX 200",
      currency: "KRW",
      quantity: "2",
      averageCost: "100000",
      currentPrice: "110000",
    };
    const irpAsset = {
      ...asset,
      id: "irp-current-id",
      legacyBase44Id: "irp-legacy-id",
      account: "irp",
      ticker: "229200",
      name: "KODEX KOFR",
      currency: "KRW",
      quantity: "3",
      averageCost: "10000",
      currentPrice: "10050",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventDate: "2026-01-01",
          eventType: "buy",
          legacyAssetId: "isa-legacy-id",
          ticker: "069500",
          assetName: "KODEX 200",
          account: "isa",
          amountKrw: "300000",
          quantityDelta: "3",
        }),
        tradeEvent({
          eventDate: "2026-02-01",
          eventType: "sell",
          legacyAssetId: "isa-legacy-id",
          ticker: "069500",
          assetName: "KODEX 200",
          account: "isa",
          amountKrw: "115000",
          quantityDelta: "-1",
        }),
        tradeEvent({
          eventDate: "2026-01-02",
          eventType: "buy",
          legacyAssetId: "irp-legacy-id",
          ticker: "229200",
          assetName: "KODEX KOFR",
          account: "irp",
          amountKrw: "40000",
          quantityDelta: "4",
        }),
        tradeEvent({
          eventDate: "2026-02-02",
          eventType: "sell",
          legacyAssetId: "irp-legacy-id",
          ticker: "229200",
          assetName: "KODEX KOFR",
          account: "irp",
          amountKrw: "11000",
          quantityDelta: "-1",
        }),
      ],
      [asset, isaAsset, irpAsset],
      1300,
    );

    const selectedKeys = new Set([
      asset.legacyBase44Id,
      isaAsset.legacyBase44Id,
      irpAsset.legacyBase44Id,
    ]);
    const all = summarizeRealizedReturnForAccount(summary, "all", selectedKeys);
    const brokerage = summarizeRealizedReturnForAccount(
      summary,
      "brokerage",
      selectedKeys,
    );
    const isa = summarizeRealizedReturnForAccount(summary, "isa", selectedKeys);
    const irp = summarizeRealizedReturnForAccount(summary, "irp", selectedKeys);

    assert.equal(all.realizedPnlKrw, 16000);
    assert.equal(all.realizedCostBasisKrw, 110000);
    assert.equal(all.realizedSellEventCount, 2);
    assert.equal(brokerage.realizedSellEventCount, 0);
    assert.equal(isa.realizedPnlKrw, 15000);
    assert.equal(isa.realizedCostBasisKrw, 100000);
    assert.equal(irp.realizedPnlKrw, 1000);
    assert.equal(irp.realizedCostBasisKrw, 10000);
  });
});
