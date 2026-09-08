import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDailyPositionMovement, buildPreviousCloseMovement } from "../src/lib/portfolio-movement.ts";
import { calculateFxAwareSnapshotMovementKrw, sumComplete } from "../src/lib/portfolio-math.ts";
import { buildReturnMetricsSummary, getAssetReturnMetrics } from "../src/lib/portfolio-return-metrics-core.ts";
import { resolveCurrentUsdKrwRate, selectUsableFxRows } from "../src/lib/market-data/fx-rate-admission.ts";
import { buildPortfolioStructure } from "../src/lib/portfolio-structure.ts";
import { selectLatestPortfolioDashboardBaselineRows } from "../src/lib/portfolio-dashboard-baseline.ts";

const cycle = { snapshotDate: "2026-07-08", liveWindowStartAt: new Date("2026-07-07T22:00:00Z"), liveWindowEndAt: new Date("2026-07-08T22:00:00Z") };
const holding = (id = "a", account = "brokerage", extra = {}) => ({ id, legacyBase44Id: null, name: "KODEX 200", ticker: "069500", assetType: "etf", account, market: "korea", currency: "KRW", quantity: 10, currentPrice: 100, valueKrw: 1000, priceFetchedAt: "2026-07-08T01:00:00Z", priceAsOf: null, priceQuoteType: "live", priceStatus: "ok", ...extra });
const snapshot = (id = "a", account = "brokerage", extra = {}) => ({ id: `snap-${id}`, account, assetId: id, legacyAssetId: null, ticker: "069500", assetName: "KODEX 200", assetType: "etf", quantity: 10, marketValueKrw: 1000, unitPrice: 100, closePrice: null, currentPrice: null, fxRate: null, previousFxRate: null, ...extra });
const trade = (extra = {}) => ({ eventDate: "2026-07-08", eventType: "buy", account: "brokerage", assetId: "a", legacyAssetId: null, ticker: "069500", assetName: "KODEX 200", amountKrw: 200, quantityDelta: 2, price: 100, fxRate: 1, beforeValue: {}, afterValue: {}, ...extra });
const close = (date, price, extra = {}) => ({ market: "korea", currency: "KRW", ticker: "069500", priceDate: date, closePrice: price, adjustedClosePrice: null, closePriceKrw: null, fxRate: null, ...extra });
const daily = (holdings, positionRows, eventRows) => buildDailyPositionMovement({ holdings, positionRows, eventRows, selectedAccount: "all", baselineDate: "2026-07-07", usdKrwRate: 1400, movementCycle: cycle });
const previousClose = (holdings, priceRows, referenceDate = "2026-07-07") => buildPreviousCloseMovement({ holdings, priceRows, referenceDate, usdKrwRate: 1400, movementCycle: cycle });
const approx = (actual, expected) => assert.ok(actual !== null && Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);

describe("financial correctness regressions", () => {
  for (const sell of [false, true]) {
    it(`attributes a cross-account ${sell ? "sell" : "buy"} only to the identified holding`, () => {
      const result = daily([holding("a", "brokerage", { quantity: sell ? 8 : 12, valueKrw: sell ? 800 : 1200 }), holding("b", "isa")], [snapshot(), snapshot("b", "isa")], [trade({ eventType: sell ? "sell" : "buy", quantityDelta: sell ? -2 : 2 })]);
      assert.equal(result.ready, true);
      assert.equal(result.tradeFlowKrw, sell ? -200 : 200);
      assert.equal(result.changeKrw, 0);
      assert.equal(result.contributions.get("b").tradeFlowKrw, 0);
      assert.equal(result.priceChangeKrw, 0);
    });
  }
  it("does not reassign an explicit nonmatching asset id by its ticker", () => {
    const result = daily([holding()], [snapshot()], [trade({ assetId: "another-id" })]);
    assert.equal(result.tradeFlowKrw, 0);
    assert.equal(result.changeKrw, 0);
  });
  it("admits a uniquely identified accountless legacy event", () => {
    const result = daily([holding("a", "brokerage", { quantity: 12, valueKrw: 1200 })], [snapshot()], [trade({ assetId: null, account: null })]);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.changeKrw, 0);
  });
  it("withholds movement when an accountless ticker event has multiple candidates", () => {
    const result = daily([holding("a"), holding("b", "isa")], [snapshot(), snapshot("b", "isa")], [trade({ assetId: null, account: null })]);
    assert.equal(result.ready, false);
    assert.equal(result.changeKrw, null);
    assert.equal(result.reason, "ambiguous_trade_identity");
  });
  it("does not attach one identifier-free snapshot to two same-account holdings", () => {
    const result = daily([holding("a"), holding("b")], [snapshot("legacy", "brokerage", { assetId: null, legacyAssetId: null })], []);
    assert.equal(result.ready, false);
    assert.equal(result.changeKrw, null);
    assert.equal(result.reason, "ambiguous_baseline_identity");
  });
  it("checks an accountless trade against both current holdings and exited positions", () => {
    const result = daily([holding("b", "isa")], [snapshot("a"), snapshot("b", "isa")], [trade({ eventType: "sell", assetId: null, account: null })]);
    assert.equal(result.ready, false);
    assert.equal(result.reason, "ambiguous_trade_identity");
  });
  it("does not substitute zero when neither trade amount nor execution evidence exists", () => {
    const result = daily([holding("a", "brokerage", { quantity: 12, valueKrw: 1200 })], [snapshot()], [trade({ amountKrw: null, price: null, quantityDelta: null })]);
    assert.equal(result.ready, false);
    assert.equal(result.changeKrw, null);
    assert.equal(result.reason, "missing_trade_amount");
  });
  it("derives a missing trade amount from evidenced execution quantity, price and FX", () => {
    const result = daily([holding("a", "brokerage", { quantity: 12, valueKrw: 1200 })], [snapshot()], [trade({ amountKrw: null })]);
    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.changeKrw, 0);
  });
  it("attributes a fully sold baseline holding without charging surviving same-ticker accounts", () => {
    const result = daily([holding("b", "isa", { quantity: 100, valueKrw: 10000 }), holding("c", "irp", { quantity: 100, valueKrw: 10000 })], [snapshot(), snapshot("b", "isa", { quantity: 100, marketValueKrw: 10000 }), snapshot("c", "irp", { quantity: 100, marketValueKrw: 10000 })], [trade({ eventType: "sell", quantityDelta: -10, amountKrw: 1000 })]);
    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, -1000);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.contributions.get("b").tradeFlowKrw, 0);
  });
  it("includes a fully sold position's evidenced price gain in aggregate attribution", () => {
    const result = daily([holding("b", "isa", { quantity: 100, valueKrw: 10000 }), holding("c", "irp", { quantity: 100, valueKrw: 10000 })], [snapshot("a", "brokerage", { currency: "KRW" }), snapshot("b", "isa", { quantity: 100, marketValueKrw: 10000 }), snapshot("c", "irp", { quantity: 100, marketValueKrw: 10000 })], [trade({ eventType: "sell", quantityDelta: -10, amountKrw: 1100, price: 110 })]);
    assert.equal(result.changeKrw, 100);
    assert.equal(result.priceChangeKrw, 100);
    assert.equal(result.fxChangeKrw, 0);
  });
  it("retains offsetting price and FX effects of a fully sold USD position with zero net movement", () => {
    const remaining = { quantity: 100000, valueKrw: 10000000 };
    const priorRemaining = { quantity: 100000, marketValueKrw: 10000000 };
    const result = daily([holding("b", "isa", remaining), holding("c", "irp", remaining)], [snapshot("a", "brokerage", { currency: "USD", marketValueKrw: 1300000, fxRate: 1300 }), snapshot("b", "isa", priorRemaining), snapshot("c", "irp", priorRemaining)], [trade({ eventType: "sell", quantityDelta: -10, amountKrw: 1300000, price: 104, fxRate: 1250 })]);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.priceChangeKrw, 52000);
    assert.equal(result.fxChangeKrw, -52000);
  });
  it("does not reassign an explicit nonmatching snapshot id by its ticker", () => {
    const result = daily([holding()], [snapshot("another-id")], []);
    assert.equal(result.ready, false);
    assert.equal(result.contributionRows.length, 0);
  });
  it("matches a legacy id and before/after account when the canonical id is absent", () => {
    const result = daily([holding("a", "brokerage", { legacyBase44Id: "legacy-a", quantity: 12, valueKrw: 1200 }), holding("b", "isa")], [snapshot("a", "brokerage", { assetId: null, legacyAssetId: "legacy-a" }), snapshot("b", "isa")], [trade({ assetId: null, legacyAssetId: "legacy-a", account: null, afterValue: { account: "brokerage" } })]);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.contributions.get("b").tradeFlowKrw, 0);
  });
  it("separates original holdings from shares acquired after the price move", () => {
    const result = daily([holding("a", "brokerage", { quantity: 20, currentPrice: 110, valueKrw: 2200 })], [snapshot()], [trade({ amountKrw: 1100, quantityDelta: 10, price: 110 })]);
    assert.equal(result.changeKrw, 100);
    assert.equal(result.priceChangeKrw, 100);
    assert.equal(result.fxChangeKrw, 0);
  });
  it("reconciles USD purchases and sales at their actual execution prices and FX rates", () => {
    const trades = [{ quantityDelta: 5, price: 105, fxRate: 1250 }, { quantityDelta: -3, price: 108, fxRate: 1275 }];
    const tradeFlowKrw = 5 * 105 * 1250 - 3 * 108 * 1275;
    const result = calculateFxAwareSnapshotMovementKrw({ quantity: 12, previousQuantity: 10, previousPrice: 100, currentPrice: 110, previousFxRate: 1200, currentFxRate: 1300, previousValueKrw: 1200000, currentValueKrw: 12 * 110 * 1300, tradeFlowKrw, trades });
    approx(result.priceChangeKrw, 10 * 10 * 1200 + 5 * 5 * 1250 - 3 * 2 * 1275);
    approx(result.fxChangeKrw, 10 * 110 * 100 + 5 * 110 * 50 - 3 * 110 * 25);
    approx(result.priceChangeKrw + result.fxChangeKrw, result.changeKrw);
  });
  it("keeps total movement but withholds attribution when execution evidence is missing", () => {
    const result = daily([holding("a", "brokerage", { quantity: 20, currentPrice: 110, valueKrw: 2200 })], [snapshot()], [trade({ amountKrw: 1100, quantityDelta: null, price: null })]);
    assert.equal(result.ready, true);
    assert.equal(result.changeKrw, 100);
    assert.equal(result.priceChangeKrw, null);
    assert.equal(result.fxChangeKrw, null);
    assert.ok(result.exclusions.some((item) => item.reason === "incomplete_trade_attribution"));
  });
  it("does not claim zero attribution when net trade flow is zero but execution evidence is incomplete", () => {
    const result = daily([holding()], [snapshot()], [trade({ price: null }), trade({ eventType: "sell", quantityDelta: -2, price: null })]);
    assert.equal(result.tradeFlowKrw, 0);
    assert.equal(result.priceChangeKrw, null);
  });
  it("rejects fabricated reconciliation when a fixed KRW valuation component changed without evidence", () => {
    const result = calculateFxAwareSnapshotMovementKrw({ quantity: 10, previousPrice: 100, currentPrice: 110, previousFxRate: 1, currentFxRate: 1, previousValueKrw: 1000, currentValueKrw: 1300 });
    assert.equal(result.changeKrw, 300);
    assert.equal(result.priceChangeKrw, null);
  });
  it("does not fill a missing baseline price with the current price", () => {
    const result = daily([holding("a", "brokerage", { currentPrice: 110, valueKrw: 1100 })], [snapshot("a", "brokerage", { unitPrice: null })], []);
    assert.equal(result.ready, false);
    assert.equal(result.priceChangeKrw, null);
    assert.ok(result.exclusions.some((item) => item.reason === "missing_baseline_price"));
  });
  it("uses the normalized baseline date's own close rather than excluding it a second time", () => {
    const baseline = selectLatestPortfolioDashboardBaselineRows([{ snapshotDate: "2026-07-08" }], "2026-07-08");
    const result = previousClose([holding("a", "brokerage", { currentPrice: 110, valueKrw: 1100 })], [close("2026-07-07", 100), close("2026-07-06", 90)], baseline.baselineReferenceDate);
    assert.equal(result.ready, true);
    assert.equal(result.contributions.get("a").previousPrice, 100);
    assert.equal(result.changeKrw, 100);
  });
  it("accepts the only close on the baseline date and naturally carries a previous close across a holiday", () => {
    assert.equal(previousClose([holding()], [close("2026-07-07", 100)]).ready, true);
    assert.equal(previousClose([holding()], [close("2026-07-06", 100)]).changeKrw, 0);
  });
  it("does not fill missing historical FX with current FX", () => {
    const result = previousClose([holding("a", "brokerage", { market: "us", currency: "USD", ticker: "VOO", valueKrw: 1400000 })], [close("2026-07-07", 100, { market: "us", currency: "USD", ticker: "VOO" })]);
    assert.equal(result.ready, false);
    assert.equal(result.fxChangeKrw, null);
    assert.ok(result.exclusions.some((item) => item.reason === "missing_baseline_fx"));
  });
  it("uses a historical FX rate derived from matching local and KRW closes", () => {
    const result = previousClose([holding("a", "brokerage", { market: "us", currency: "USD", ticker: "VOO", valueKrw: 1400000 })], [close("2026-07-07", 100, { market: "us", currency: "USD", ticker: "VOO", closePriceKrw: 130000 })]);
    assert.equal(result.fxChangeKrw, 100000);
  });
  const asset = { id: "a", legacyBase44Id: null, account: "brokerage", ticker: "069500", name: "KODEX 200", currency: "KRW", quantity: 10, averageCost: null, currentPrice: 110, fractionalAvgCost: null };
  const metric = (extra = {}) => { const row = { ...asset, ...extra }; return getAssetReturnMetrics(buildReturnMetricsSummary([], [row], 1400), row, 1400); };
  it("preserves unknown current cost and marks it as missing", () => {
    assert.equal(metric().costBasisKrw, null);
    assert.equal(metric().missingCost, true);
  });
  it("distinguishes explicit zero cost from missing cost", () => {
    assert.equal(metric({ averageCost: 0 }).costBasisKrw, 0);
    assert.equal(metric({ averageCost: 0 }).missingCost, false);
  });
  it("requires cost evidence for a nonzero fractional balance", () => {
    assert.equal(metric({ averageCost: 100, fractionalKrwValue: 50 }).costBasisKrw, null);
    assert.equal(metric({ quantity: 0, fractionalKrwValue: 50, fractionalAvgCost: 40 }).costBasisKrw, 40);
  });
  it("does not publish a complete financial total when one holding has unknown cost", () => {
    assert.equal(sumComplete([100, null, 200], (value) => value), null);
    assert.equal(sumComplete([100, 0, 200], (value) => value), 300);
  });
  it("admits only nonsample positive successful FX evidence and otherwise uses a valid scoped setting", () => {
    const row = (rateDate, usdKrw, extra = {}) => ({ rateDate, usdKrw, status: "ok", isSample: false, ...extra });
    const rows = [row("2026-07-08", 1, { isSample: true }), row("2026-07-09", 2, { status: "error" }), row("2026-07-10", 0), row("2026-07-11", Infinity), row("2026-07-07", 1300)];
    assert.equal(selectUsableFxRows(rows).length, 1);
    assert.equal(resolveCurrentUsdKrwRate(rows, 1400), 1300);
    assert.equal(resolveCurrentUsdKrwRate(rows.slice(0, 4), 1400), 1400);
    assert.equal(resolveCurrentUsdKrwRate([], 0), null);
    const structure = buildPortfolioStructure({ selectedAccount: "all", usdKrwRate: resolveCurrentUsdKrwRate(rows, 1400), assets: [{ id: "us", account: "brokerage", name: "VOO", ticker: "VOO", currency: "USD", market: "us", assetType: "etf", quantity: "1", currentPrice: "100", targetWeight: "50" }, { id: "kr", account: "brokerage", name: "KODEX", ticker: "069500", currency: "KRW", market: "korea", assetType: "etf", quantity: "1", currentPrice: "130000", targetWeight: "50" }] });
    assert.equal(structure.totalValueKrw, 260000);
    assert.equal(structure.holdingRows.find((item) => item.ticker === "VOO").currentWeightPct, 50);
  });
});
