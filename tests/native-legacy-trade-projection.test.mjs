import assert from "node:assert/strict";
import { it } from "node:test";
import { projectNativeLegacyTrade } from "../src/lib/native-legacy-trade-projection.ts";
import { buildDailyPositionMovement } from "../src/lib/portfolio-movement.ts";
import { buildReturnMetricsSummary } from "../src/lib/portfolio-return-metrics-core.ts";

const account = { id: "account-a", code: "brokerage", assets: [{ id: "sold", name: "Synthetic ETF", ticker: "SYNTH", legacyBase44Id: "legacy-sold" }] };
function entry(overrides = {}) {
  return {
    id: "effective-entry", accountId: account.id, recordedAt: "2026-07-08T03:00:00Z",
    data: {
      event: { id: "operation-a", sequence: 1, source: "user_native_ledger", at: "2026-07-08T02:00:00Z", type: "sell", assetId: "sold", currency: "KRW", quantity: "4", price: "110" },
      state: { version: 1, accountId: account.id, sequence: 1, startedAt: "2026-07-07T01:00:00Z", at: "2026-07-08T02:00:00Z", cash: { KRW: "440", USD: "0" }, positions: [{ assetId: "sold", currency: "KRW", quantity: "0", costLots: [] }] },
      effect: { realized: { disposedCostLots: null } },
    }, ...overrides,
  };
}
function movement(row) {
  const holdings = [1, 2, 3].map(index => ({
    id: `remaining-${index}`, legacyBase44Id: null, name: `Synthetic ${index}`, ticker: `SY${index}`, assetType: "etf", account: "brokerage", market: "korea", currency: "KRW",
    quantity: 10, currentPrice: 100, valueKrw: 1000, priceFetchedAt: "2026-07-08T04:00:00Z", priceAsOf: null, priceQuoteType: "live", priceStatus: "ok",
  }));
  const positionRows = holdings.map(holding => ({ id: `snapshot-${holding.id}`, account: "brokerage", assetId: holding.id, legacyAssetId: null, ticker: holding.ticker, assetName: holding.name, assetType: "etf", currency: "KRW", quantity: 10, marketValueKrw: 1000, unitPrice: 100, closePrice: null, currentPrice: null, fxRate: "1", previousFxRate: null }));
  positionRows.push({ id: "snapshot-sold", account: "brokerage", assetId: "sold", legacyAssetId: "legacy-sold", ticker: "SYNTH", assetName: "Synthetic ETF", assetType: "etf", currency: "KRW", quantity: 4, marketValueKrw: 400, unitPrice: 100, closePrice: null, currentPrice: null, fxRate: "1", previousFxRate: null });
  return buildDailyPositionMovement({ holdings, positionRows, eventRows: [row], selectedAccount: "brokerage", baselineDate: "2026-07-07", usdKrwRate: 1300, movementCycle: { snapshotDate: "2026-07-08", liveWindowStartAt: new Date("2026-07-07T22:00:00Z"), liveWindowEndAt: new Date("2026-07-08T22:00:00Z") } });
}

it("projects a full native sale without changing the original evidence or manufacturing opening cost", () => {
  const native = entry(), before = structuredClone(native);
  const row = projectNativeLegacyTrade(native, account);
  assert.equal(row.id, "effective-entry");
  assert.equal(row.eventDate, "2026-07-08");
  assert.equal(row.quantityDelta, "-4");
  assert.equal(row.amountKrw, "440");
  assert.equal(row.price, "110");
  assert.equal(row.fxRate, "1");
  assert.equal(row.beforeValue.quantity, "4");
  assert.equal(row.afterValue.quantity, "0");
  assert.equal(row.nativeCostBasisStatus, "unavailable");
  assert.equal(row.afterValue.trade_metrics.disposed_cost_krw, null);
  assert.equal(row.nativeData, native.data);
  assert.deepEqual(native, before);
  const result = movement(row);
  // 3,000 remaining + 440 sale proceeds - 3,400 baseline = +40.
  assert.equal(result.ready, true);
  assert.equal(result.changeKrw, 40);
  assert.equal(result.tradeFlowKrw, -440);
  assert.equal(result.priceChangeKrw, 40);
  assert.equal(result.fxChangeKrw, 0);
});

it("keeps a USD settlement and unknown historical FX out of the KRW amount", () => {
  const native = entry();
  native.data.event.currency = "USD";
  native.data.event.price = "12.34";
  native.data.state.positions[0].currency = "USD";
  const row = projectNativeLegacyTrade(native, account);
  assert.equal(row.amountKrw, null);
  assert.equal(row.fxRate, null);
  assert.equal(row.price, "12.34");
  assert.equal(row.nativeCostBasisStatus, "unavailable");
});

it("preserves a KRW settlement of a USD asset without deriving a dollar execution price or FX", () => {
  const native = entry();
  Object.assign(native.data.event, { currency: "USD", price: undefined, settlement: { currency: "KRW", amount: "123456" } });
  native.data.state.positions[0].currency = "USD";
  const row = projectNativeLegacyTrade(native, account);
  assert.equal(row.amountKrw, "123456");
  assert.equal(row.price, null);
  assert.equal(row.fxRate, null);
});

it("retains effective revision identity and visibility time over stale original row metadata", () => {
  const native = entry({ id: "revised-effective-entry", recordedAt: "2026-07-09T03:00:00Z" });
  const row = projectNativeLegacyTrade(native, account, { id: "superseded", createdAt: new Date("2026-07-08T02:00:00Z"), source: "native_ledger_v1" });
  assert.equal(row.id, "revised-effective-entry");
  assert.equal(row.recordedAt.toISOString(), "2026-07-09T03:00:00.000Z");
  assert.equal(row.createdAt.toISOString(), "2026-07-09T03:00:00.000Z");
  assert.equal(row.eventDate, "2026-07-08");
  assert.equal(row.source, "native_ledger_v1");
});

it("projects only owned instrument trades and requires recorded visibility evidence", () => {
  assert.equal(projectNativeLegacyTrade(entry(), { ...account, id: "other-account" }), null);
  assert.equal(projectNativeLegacyTrade(entry(), { ...account, assets: [] }), null);
  assert.equal(projectNativeLegacyTrade(entry({ recordedAt: null }), account), null);
  const native = entry();
  native.data.event = { type: "opening", at: "2026-07-08T02:00:00Z" };
  assert.equal(projectNativeLegacyTrade(native, account), null);
});

it("uses explicit KRW disposed lots and charges but never foreign cost at today's FX", () => {
  const native = entry();
  native.data.effect.realized.disposedCostLots = [{ currency: "KRW", amount: "400", at: "2026-07-07T01:00:00Z", source: "user_native_ledger", remaining: { n: "1", d: "1" } }];
  native.data.event.fee = { currency: "KRW", amount: "2" };
  native.data.event.tax = { currency: "KRW", amount: "3" };
  const row = projectNativeLegacyTrade(native, account);
  assert.equal(row.nativeCostBasisStatus, "available");
  assert.equal(row.afterValue.trade_metrics.disposed_cost_krw, "400");
  assert.equal(row.afterValue.trade_metrics.realized_pnl_krw, "35");
  native.data.effect.realized.disposedCostLots[0].currency = "USD";
  const missingFx = projectNativeLegacyTrade(native, account);
  assert.equal(missingFx.nativeCostBasisStatus, "unavailable");
  assert.equal(missingFx.afterValue.trade_metrics.disposed_cost_krw, null);
  assert.equal(missingFx.afterValue.trade_metrics.realized_pnl_krw, null);
});

it("keeps repeating settlement averages native instead of rounding an execution price", () => {
  const native = entry();
  Object.assign(native.data.event, { quantity: "3", price: undefined, settlement: { amount: "100", currency: "KRW" } });
  const row = projectNativeLegacyTrade(native, account);
  assert.equal(row.price, null);
  assert.equal(row.amountKrw, "100");
  assert.equal(row.quantityDelta, "-3");
});

it("does not fill unknown native sale cost from a preceding legacy purchase", () => {
  const sale = projectNativeLegacyTrade(entry(), account);
  const buy = { ...sale, id: "legacy-purchase", eventDate: "2026-07-07", eventType: "buy", quantityDelta: "4", amountKrw: "200", price: "50", nativeProjection: undefined, nativeCostBasisStatus: undefined, nativeData: null, beforeValue: { currency: "KRW", quantity: "0" }, afterValue: { currency: "KRW", quantity: "4" } };
  const summary = buildReturnMetricsSummary([buy, sale], [], 1500);
  assert.equal(summary.realizedRows.length, 1);
  assert.equal(summary.realizedRows[0].realizedCostBasisKrw, null);
  assert.equal(summary.realizedRows[0].realizedPnlKrw, null);
  assert.equal(summary.realizedRows[0].missingCost, true);
});

it("does not infer native realized profit when KRW cost is known but USD fee FX is missing", () => {
  const native = entry();
  native.data.effect.realized.disposedCostLots = [{ currency: "KRW", amount: "400", at: "2026-07-07T01:00:00Z", source: "user_native_ledger", remaining: { n: "1", d: "1" } }];
  native.data.event.fee = { currency: "USD", amount: "0.01" };
  const sale = projectNativeLegacyTrade(native, account);
  assert.equal(sale.nativeCostBasisStatus, "available");
  assert.equal(sale.afterValue.trade_metrics.realized_pnl_krw, null);
  const summary = buildReturnMetricsSummary([sale], [], 1500);
  assert.equal(summary.realizedRows[0].realizedCostBasisKrw, 400);
  assert.equal(summary.realizedRows[0].realizedPnlKrw, null);
});

it("uses touched native position lots after a buy instead of multiplying the stale legacy average", () => {
  const native = entry();
  native.data.event.type = "buy";
  native.data.state.positions[0].quantity = "6";
  const lots = [{ currency: "KRW", amount: "200", at: "2026-07-07T01:00:00Z", source: "user_native_ledger", remaining: { n: "1", d: "1" } },
    { currency: "KRW", amount: "440", at: native.data.event.at, source: "user_native_ledger", remaining: { n: "1", d: "1" } }];
  native.data.state.positions[0].costLots = lots;
  const current = { id: "sold", legacyBase44Id: "legacy-sold", account: "brokerage", ticker: "SYNTH", name: "Synthetic ETF", currency: "KRW", quantity: "6", averageCost: "100", currentPrice: "110", fractionalAvgCost: null };
  let row = projectNativeLegacyTrade(native, account);
  assert.equal(row.quantityDelta, "4");
  assert.equal(row.beforeValue.quantity, "2");
  assert.equal(row.nativeRemainingCostKrw, "640");
  let summary = buildReturnMetricsSummary([row], [current], 1500);
  assert.equal([...summary.metricsByAssetKey.values()][0].costBasisKrw, 640, "two original shares cost 200 plus four new shares cost 440; not stale 6x100");
  native.data.state.positions[0].costLots = null;
  row = projectNativeLegacyTrade(native, account);
  summary = buildReturnMetricsSummary([row], [current], 1500);
  assert.equal(row.nativeRemainingCostKrw, null);
  assert.equal([...summary.metricsByAssetKey.values()][0].costBasisKrw, null);
  native.data.state.positions[0].costLots = [{ ...lots[0], currency: "USD" }];
  row = projectNativeLegacyTrade(native, account);
  summary = buildReturnMetricsSummary([row], [current], 1500);
  assert.equal(row.nativeRemainingCostKrw, null);
  assert.equal([...summary.metricsByAssetKey.values()][0].costBasisKrw, null, "today's FX does not supply historical foreign cost");
});
