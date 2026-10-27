import assert from "node:assert/strict";
import { buildCurrentHoldingMovement } from "../src/lib/current-holding-movement.ts";
import { buildDailyPositionMovement, type PortfolioMovementHoldingInput, type PortfolioMovementPositionSnapshotInput, type PortfolioMovementEventInput } from "../src/lib/portfolio-movement.ts";

const cycle = { snapshotDate: "2026-10-27", liveWindowStartAt: new Date("2026-10-26T22:00:00Z"), liveWindowEndAt: new Date("2026-10-27T22:00:00Z") };
const near = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const holding = (quantity: number, price = 100, fx = 1300): PortfolioMovementHoldingInput => ({
  id: "asset-us", legacyBase44Id: null, name: "US asset", ticker: "AAA", assetType: "stock", account: "brokerage", market: "us", currency: "USD",
  quantity, currentPrice: price, valueKrw: quantity * price * fx, priceFetchedAt: "2026-10-27T10:00:00Z", priceAsOf: "2026-10-27T10:00:00Z", priceQuoteType: "live", priceStatus: "ok",
});
const position = (quantity = 10): PortfolioMovementPositionSnapshotInput => ({
  id: "baseline", assetId: "asset-us", legacyAssetId: null, assetName: "US asset", ticker: "AAA", assetType: "stock", account: "brokerage", currency: "USD",
  quantity, unitPrice: 100, closePrice: 100, currentPrice: 100, fxRate: 1300, previousFxRate: 1300, marketValueKrw: quantity * 100 * 1300,
  capturedAt: "2026-10-26T23:00:00Z", description: "valuation_policy=execution_collection_v1",
});
const market = (quantity: number, price = 100, fx = 1300, extra: Partial<Parameters<typeof buildCurrentHoldingMovement>[0]> = {}) =>
  buildCurrentHoldingMovement({ holdings: [holding(quantity, price, fx)], positionRows: [position()], priceRows: [], baselineDate: "2026-10-26", usdKrwRate: fx, movementCycle: cycle, ...extra });

// More/fewer shares alone must never appear as investment profit or loss.
const buy = market(20), sell = market(5);
near(buy.changeKrw, 0); near(buy.returnPct, 0); near(buy.valuationChangeKrw, 1_300_000); near(buy.quantityChangeKrw, 1_300_000);
near(sell.changeKrw, 0); near(sell.returnPct, 0); near(sell.valuationChangeKrw, -650_000); near(sell.quantityChangeKrw, -650_000);
near(market(20, 110).returnPct, 10); near(market(5, 110).returnPct, 10);
near(market(20, 100, 1400).returnPct, 100 / 13);
const partial = market(10, 110, 1300, { holdings: [holding(10, 110), { ...holding(1), id: "gold", ticker: null, assetType: "gold", valueKrw: 10_000_000 }] });
assert.equal(partial.partial, true); assert.equal(partial.includedCount, 1); assert.equal(partial.excludedCount, 1); near(partial.returnPct, 10);
assert.equal(market(10, 100, 1300, { positionRows: [] }).returnPct, null);
assert.equal(market(10, 100, 1300, { positionRows: [{ ...position(), fxRate: null, previousFxRate: null }] }).returnPct, null);
assert.equal(market(10, 100, 1300, { positionRows: [position(), { ...position(), id: "duplicate" }] }).returnPct, null);
assert.equal(market(10, 100, 1300, { holdings: [{ ...holding(10), valueKrw: 1_310_000 }] }).returnPct, null);

const trade = (quantity: number, at = "2026-10-27T02:00:00Z"): PortfolioMovementEventInput => ({
  eventDate: "2026-10-27", eventType: quantity > 0 ? "buy" : "sell", account: "brokerage", assetId: "asset-us", legacyAssetId: null, ticker: "AAA", assetName: "US asset",
  amountKrw: Math.abs(quantity) * 100 * 1300, quantityDelta: quantity, price: 100, fxRate: 1300, beforeValue: {}, afterValue: {}, createdAt: at, recordedAt: at,
});
const actual = (quantity: number, event: PortfolioMovementEventInput, snapshot = position()) => buildDailyPositionMovement({
  holdings: [holding(quantity)], positionRows: [snapshot], eventRows: [event], selectedAccount: "all", baselineDate: "2026-10-26", usdKrwRate: 1300, movementCycle: cycle,
});
near(actual(20, trade(10)).changeKrw, 0); near(actual(20, trade(10)).tradeFlowKrw, 1_300_000);
near(actual(5, trade(-5)).changeKrw, 0); near(actual(5, trade(-5)).tradeFlowKrw, -650_000);
assert.equal(actual(20, { ...trade(10), amountKrw: null, fxRate: null }).reason, "missing_trade_amount");
// A trade already present at snapshot capture must not be subtracted again.
near(actual(20, trade(10, "2026-10-26T22:30:00Z"), position(20)).changeKrw, 0);


console.log('PASS: buy/sell, quantity neutral return, price/FX, evidence coverage and capture boundary.');
