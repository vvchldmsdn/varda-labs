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

    const metrics = getAssetReturnMetrics(summary, asset, 1300);
    assert.equal(metrics.costBasisKrw, 780000);
    assert.equal(metrics.realizedCostBasisKrw, 400000);
    assert.equal(metrics.realizedPnlKrw, 120000);
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

    const isaSummary = summarizeRealizedReturnForAccount(summary, "isa", new Set());
    assert.equal(isaSummary.realizedPnlKrw, 25000);
    assert.equal(isaSummary.unmatchedSellEventCount, 1);
    assert.equal(isaSummary.missingCostSellEventCount, 1);
  });
});
