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
  it("never reconstructs a past sale from costs entered or corrected on the current holding", () => {
    const sale = tradeEvent({ eventType: "sell", amountKrw: "143000", quantityDelta: "-1", price: "110", fxRate: "1300" });
    for (const averageCost of [null, "100", "101"]) {
      const current = { ...asset, averageCost };
      const result = buildReturnMetricsSummary([sale], [current], 1400);
      assert.equal(result.realizedRows[0].realizedCostBasisKrw, null);
      assert.equal(result.realizedRows[0].realizedPnlKrw, null);
      assert.equal(result.realizedRows[0].missingCost, true);
      assert.equal(result.realizedPnlKrw, null);
      assert.equal(result.metricsByAssetKey.get(asset.legacyBase44Id).costBasisKrw, averageCost === null ? null : Number(averageCost) * 6 * 1400);
    }
  });

  it("uses recorded pre-sale cost and FX independently of today's cost and FX", () => {
    const sale = tradeEvent({ eventType: "sell", quantityDelta: "-1", price: "110", fxRate: "1300", beforeValue: { average_cost: 100 } });
    for (const averageCost of [null, "101", "999"]) {
      for (const currentFx of [1200, 1400]) {
        const result = buildReturnMetricsSummary([sale], [{ ...asset, averageCost }], currentFx);
        assert.equal(result.realizedCostBasisKrw, 130000);
        assert.equal(result.realizedPnlKrw, 13000);
      }
    }
  });

  it("withholds historic foreign-currency cost or proceeds when event FX is missing", () => {
    const sale = tradeEvent({ eventType: "sell", quantityDelta: "-1", price: "110", beforeValue: { average_cost: 100 } });
    for (const currentFx of [1300, 1400]) {
      for (const amountKrw of [null, "143000"]) {
        const result = buildReturnMetricsSummary([{ ...sale, amountKrw }], [asset], currentFx);
        assert.equal(result.realizedCostBasisKrw, null);
        assert.equal(result.realizedPnlKrw, null);
      }
      const knownCost = buildReturnMetricsSummary([{ ...sale, afterValue: { trade_metrics: { disposed_cost_krw: 130000 } } }], [asset], currentFx);
      assert.equal(knownCost.realizedCostBasisKrw, 130000);
      assert.equal(knownCost.realizedPnlKrw, null, "a recorded cost alone does not prove missing sale proceeds");
    }
    const krw = buildReturnMetricsSummary([sale], [{ ...asset, currency: "KRW" }], 1400);
    assert.equal(krw.realizedPnlKrw, 10, "KRW trades need no foreign-currency conversion");
  });

  it("keeps explicit zero realized PnL while withholding a missing cost denominator", () => {
    for (const evidence of [{ memo: "realized_pnl_krw=0" }, { afterValue: { trade_metrics: { realized_pnl_krw: 0 } } }]) {
      const result = buildReturnMetricsSummary([tradeEvent({ eventType: "sell", quantityDelta: "-1", ...evidence })], [asset], 1400);
      assert.equal(result.realizedPnlKrw, 0);
      assert.equal(result.realizedCostBasisKrw, null);
      assert.equal(result.missingCostSellEventCount, 1);
    }
  });

  it("does not treat a partial purchase ledger as the complete cost of a later sale", () => {
    const buy = tradeEvent({ quantityDelta: "1", amountKrw: "100000" });
    for (const events of [
      [buy, tradeEvent({ eventDate: "2026-01-02", eventType: "sell", quantityDelta: "-2", amountKrw: "220000" })],
      [buy, tradeEvent({ eventDate: "2026-01-02", quantityDelta: "1", price: "100", fxRate: null }), tradeEvent({ eventDate: "2026-01-03", eventType: "sell", quantityDelta: "-1", amountKrw: "110000" })],
      [tradeEvent({ eventType: "sell", amountKrw: "110000", quantityDelta: "-1" }), { ...buy, eventDate: "2026-01-02" }, tradeEvent({ eventDate: "2026-01-03", eventType: "sell", quantityDelta: "-1", amountKrw: "110000" })],
    ]) {
      const result = buildReturnMetricsSummary(events, [asset], 1400);
      assert.equal(result.realizedCostBasisKrw, null);
      assert.equal(result.realizedPnlKrw, null);
      assert.equal(result.realizedRows.at(-1).realizedCostBasisKrw, null);
    }
  });

  it("propagates one unknown sale through asset, account and overall totals", () => {
    const sales = [
      tradeEvent({ eventDate: "2026-01-02", eventType: "sell", amountKrw: "110000", quantityDelta: "-1", afterValue: { trade_metrics: { disposed_cost_krw: 100000, realized_pnl_krw: 10000 } } }),
      tradeEvent({ eventDate: "2026-01-03", eventType: "sell", amountKrw: "110000", quantityDelta: "-1" }),
    ];
    const result = buildReturnMetricsSummary(sales, [asset], 1400);
    for (const summary of [result, result.metricsByAssetKey.get(asset.legacyBase44Id), summarizeRealizedReturnForAccount(result, "brokerage", new Set([asset.legacyBase44Id]))]) {
      assert.equal(summary.realizedPnlKrw, null);
      assert.equal(summary.realizedCostBasisKrw, null);
    }
    assert.equal(result.realizedRows[0].realizedPnlKrw, 10000);
    assert.equal(result.realizedRows[1].realizedPnlKrw, null);
  });

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

  it("matches an accountless event to one uniquely identified generated-account asset", () => {
    const generatedAsset = {
      ...asset,
      id: "generated-account-asset",
      legacyBase44Id: null,
      account: "acct_11111111111141118111111111111111",
      ticker: "DYNAMIC",
      name: "Dynamic holding",
      currency: "KRW",
      averageCost: "1000",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventType: "sell",
          account: null,
          assetId: null,
          legacyAssetId: "missing-legacy-id",
          ticker: "DYNAMIC",
          assetName: "Dynamic holding",
          amountKrw: "1100",
          quantityDelta: "-1",
        }),
      ],
      [generatedAsset],
      1300,
    );

    assert.equal(summary.realizedRows[0].assetKey, generatedAsset.id);
    assert.equal(summary.realizedRows[0].account, generatedAsset.account);
    assert.equal(
      getSelectedRealizedRows(
        summary,
        generatedAsset.account,
        new Set([generatedAsset.id]),
      ).length,
      1,
    );
  });

  it("keeps an accountless duplicate ticker unmatched instead of assigning it", () => {
    const first = {
      ...asset,
      id: "duplicate-one",
      legacyBase44Id: null,
      account: "brokerage",
      ticker: "DUP",
      name: "Duplicate holding",
    };
    const second = {
      ...first,
      id: "duplicate-two",
      account: "acct_22222222222242228222222222222222",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventType: "sell",
          account: null,
          assetId: null,
          legacyAssetId: "missing-legacy-id",
          ticker: "DUP",
          assetName: "Duplicate holding",
          amountKrw: "1100",
          quantityDelta: "-1",
          memo: "realized_pnl_krw=100",
        }),
      ],
      [first, second],
      1300,
    );

    assert.equal(summary.realizedRows[0].assetKey, null);
    assert.equal(summary.realizedRows[0].account, null);
    assert.equal(getSelectedRealizedRows(summary, "brokerage", new Set()).length, 0);
    assert.equal(getSelectedRealizedRows(summary, second.account, new Set()).length, 0);
    assert.equal(getSelectedRealizedRows(summary, "all", new Set()).length, 1);
  });

  it("uses ticker and name together to disambiguate an accountless event", () => {
    const first = {
      ...asset,
      id: "same-ticker-first",
      legacyBase44Id: null,
      account: "brokerage",
      ticker: "SHARED",
      name: "First holding",
    };
    const second = {
      ...first,
      id: "same-ticker-second",
      account: "acct_22222222222242228222222222222222",
      name: "Second holding",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventType: "sell",
          account: null,
          assetId: null,
          legacyAssetId: "missing-legacy-id",
          ticker: "SHARED",
          assetName: "Second holding",
          amountKrw: "1100",
          quantityDelta: "-1",
        }),
      ],
      [first, second],
      1300,
    );

    assert.equal(summary.realizedRows[0].assetKey, second.id);
    assert.equal(summary.realizedRows[0].account, second.account);
  });

  it("keeps conflicting accountless ticker and name evidence unmatched", () => {
    const first = {
      ...asset,
      id: "conflicting-ticker",
      legacyBase44Id: null,
      ticker: "TICKER-A",
      name: "First holding",
    };
    const second = {
      ...first,
      id: "conflicting-name",
      account: "acct_22222222222242228222222222222222",
      ticker: "TICKER-B",
      name: "Second holding",
    };
    const summary = buildReturnMetricsSummary(
      [
        tradeEvent({
          eventType: "sell",
          account: null,
          assetId: null,
          legacyAssetId: "missing-legacy-id",
          ticker: "TICKER-A",
          assetName: "Second holding",
          amountKrw: "1100",
          quantityDelta: "-1",
          memo: "realized_pnl_krw=100",
        }),
      ],
      [first, second],
      1300,
    );

    assert.equal(summary.realizedRows[0].assetKey, null);
    assert.equal(summary.realizedRows[0].account, null);
  });
});
