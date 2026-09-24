import assert from "node:assert/strict";
import { it } from "node:test";
import { createNativePortfolioState, applyNativeEvent } from "../src/lib/native-portfolio-ledger.ts";
import { attachNativeLedgerEvidence } from "../src/lib/native-portfolio-projection.ts";
import { resolveNativeGroupSelection } from "../src/lib/native-group-scope.ts";
import { buildTrackedCurrencyPortfolio } from "../src/lib/currency-tracked-portfolio.ts";

const start = "2026-09-01T22:00:00Z", end = "2026-09-03T22:00:00Z", middle = "2026-09-02T22:00:00Z";
const selection = { wholeAccountIds: ["cash-account"], directAssetIds: ["stock"], stableSince: start };
const holding = (id, accountId, quantity, price, currency, at) => ({ id, accountId, ownerId: "owner", name: id, kind: "holding", observation: { quantity, price, currency, at, priceObservedAt: at, source: "fixed_raw", basis: "raw" } });
function fixture() {
  const state = (accountId, cash, positions) => createNativePortfolioState({ accountId, cash, positions, at: start }).state;
  const stock = { assetId: "stock", quantity: "10", currency: "USD", costLots: null };
  const accounts = [
    { id: "cash-account", name: "Cash", state: state("cash-account", { KRW: "140000", USD: "100" }, []), assets: [] },
    { id: "stock-account", name: "Stocks", state: state("stock-account", { KRW: "0", USD: "2000" }, [stock]), assets: [{ id: "stock", name: "Stock", quantity: "10", currency: "USD", archived: false }] },
  ];
  const fx = [start, middle, end].map((at, i) => ({ base: "USD", quote: "KRW", rate: i === 2 ? "1260" : "1400", observedAt: at, fetchedAt: at, source: "dated_fixture", kind: "daily_reference" }));
  const base = { ownerId: "owner", reporting: "USD", asOf: end, current: { at: end, source: "owned", positions: [holding("stock", "stock-account", "10", "110", "USD", end)], scopeComplete: false }, history: [], trades: null, fx, maxFxAgeMs: 3 * 86400000, maxPriceAgeMs: 86400000 };
  const snapshots = accounts.map(account => ({ accountId: account.id, evidence: { version: 1, sequence: 0, fx, frame: { at: start, source: "native_ledger_snapshot", scopeComplete: true, positions: [
    ...account.state.positions.map(p => holding(p.assetId, account.id, p.quantity, "100", p.currency, start)),
    ...["KRW", "USD"].map(currency => ({ ...holding(`cash:${account.id}:${currency}`, account.id, account.state.cash[currency], "1", currency, start), kind: "cash" })),
  ] } } }));
  const ledger = { accounts, entries: [], snapshots };
  function event(accountId, data) {
    const account = accounts.find(a => a.id === accountId);
    const e = { id: `event-${ledger.entries.length}`, sequence: account.state.sequence + 1, at: middle, source: "user_native_ledger", ...data };
    const result = applyNativeEvent(account.state, e); assert.equal(result.ok, true);
    account.state = result.next;
    account.assets = account.state.positions.map(p => ({ id: p.assetId, quantity: p.quantity, currency: p.currency, archived: Number(p.quantity) === 0 }));
    ledger.entries.push({ id: e.id, accountId, operationId: e.id, data: { event: e, state: result.next, effect: result } });
    const row = base.current.positions.find(p => p.id === e.assetId);
    if (row) row.observation.quantity = account.state.positions.find(p => p.assetId === e.assetId).quantity;
  }
  const project = (pick = selection) => attachNativeLedgerEvidence(base, ledger, "portfolio_group", pick);
  return { base, ledger, event, project };
}

it("values mixed group whole-account cash plus direct holding, without importing excluded cash or duplicating overlaps", () => {
  const f = fixture(), evidence = f.project(), usd = buildTrackedCurrencyPortfolio(evidence), krw = buildTrackedCurrencyPortfolio({ ...evidence, reporting: "KRW" });
  assert.equal(usd.history[0].total, "1200"); assert.ok(Math.abs(Number(usd.current.total) - (1200 + 140000 / 1260)) < 1e-10);
  assert.equal(krw.history[0].total, "1680000"); assert.equal(krw.current.total, "1652000");
  assert.ok(usd.performanceReturn.totalReturn > 0); assert.ok(krw.performanceReturn.totalReturn < 0);
  assert.equal(usd.performanceReturn.boundary, "selected_group");
  assert.equal(evidence.current.positions.some(p => p.id.startsWith("cash:stock-account")), false);
  const both = f.project({ ...selection, wholeAccountIds: ["cash-account", "stock-account"] });
  assert.equal(both.current.positions.filter(p => p.id === "stock").length, 1);
  assert.equal(buildTrackedCurrencyPortfolio(both).history[0].total, "3200");
});

it("counts direct-holding buy/sell, linked dividend and fee at their dated group boundary", () => {
  const f = fixture();
  f.event("stock-account", { type: "buy", assetId: "stock", quantity: "2", price: "100", currency: "USD", fee: { amount: "1", currency: "USD" } });
  f.event("stock-account", { type: "sell", assetId: "stock", quantity: "1", price: "100", currency: "USD", fee: { amount: "1", currency: "USD" } });
  f.event("stock-account", { type: "dividend", assetId: "stock", amount: "5", currency: "USD" });
  f.event("stock-account", { type: "fee", assetId: "stock", amount: "2", currency: "USD" });
  f.base.fx.forEach(rate => { rate.rate = "1400"; });
  const result = buildTrackedCurrencyPortfolio(f.project());
  // Before1200, after1410. Capital:200+1-100+1-5+2=99 at midpoint.
  // Income including price/dividend/cost =1410-1200-99=111.
  assert.equal(result.current.total, "1410"); assert.equal(result.movement.attribution.assetTradeFlow, "99");
  assert.equal(result.movement.attribution.investmentChange, "111");
  assert.ok(Math.abs(result.performanceReturn.totalReturn - 111 / 1249.5) < 1e-12);
});

it("group transfers are internal only when both cash accounts belong, unrelated deposits stay outside direct holdings", () => {
  const f = fixture(); f.base.fx.forEach(rate => { rate.rate = "1400"; });
  f.event("stock-account", { type: "deposit", amount: "500", currency: "USD" });
  f.event("cash-account", { type: "transfer", direction: "out", amount: "20", currency: "USD", transferId: "transfer", peerAccountId: "stock-account" });
  f.event("stock-account", { type: "transfer", direction: "in", amount: "20", currency: "USD", transferId: "transfer", peerAccountId: "cash-account" });
  let r = buildTrackedCurrencyPortfolio(f.project()); assert.equal(r.movement.attribution.assetTradeFlow, "-20"); assert.equal(r.movement.attribution.investmentChange, "100");
  r = buildTrackedCurrencyPortfolio(f.project({ ...selection, wholeAccountIds: ["cash-account", "stock-account"] }));
  assert.equal(r.movement.attribution.assetTradeFlow, "500"); assert.equal(r.movement.attribution.investmentChange, "100");
});

it("unassigned income restricts group return only; unsupported members never normalize verified values to100%", () => {
  const f = fixture(); f.event("stock-account", { type: "dividend", amount: "5", currency: "USD" });
  let r = buildTrackedCurrencyPortfolio(f.project());
  assert.equal(r.current.complete, true); assert.equal(r.performanceReturn, null); assert.equal(r.performanceReason, "group_income_allocation_missing");
  f.base.current.positions[0].unsupportedReason = "unsupported_instrument";
  r = buildTrackedCurrencyPortfolio(f.project());
  assert.equal(r.current.total, null); assert.equal(r.current.coverage.excludedPositions, 1); assert.equal(r.current.coverage.excludedWeightPct, null);
  assert.ok(r.current.positions.every(p => p.weightPct === null));
});

it("membership window excludes older frames and future memberships, and handles same asset union only once", () => {
  const selected = resolveNativeGroupSelection({ accountMemberships: [{ targetId: "cash-account", validFrom: "2026-09-01", validTo: null }], assetMemberships: [{ targetId: "old", validFrom: "2026-09-01", validTo: "2026-09-03" }, { targetId: "stock", validFrom: "2026-09-03", validTo: null }, { targetId: "future", validFrom: "2026-10-01", validTo: null }] }, end);
  assert.deepEqual(selected.directAssetIds, ["stock"]); assert.equal(selected.stableSince, "2026-09-02T22:00:00.000Z");
  const f = fixture(), r = buildTrackedCurrencyPortfolio(f.project(selected));
  assert.equal(r.current.complete, true); assert.equal(r.history.length, 0); assert.equal(r.performanceReturn, null);
});

it("missing group members restrict realized P&L as well as valuation and performance", () => {
  const f = fixture(), result = buildTrackedCurrencyPortfolio(f.project({ ...selection, wholeAccountIds: ["cash-account", "missing"] }));
  assert.equal(result.current.total, null); assert.equal(result.performanceReturn, null);
  assert.equal(result.realizedPnl.total, null); assert.equal(result.realizedPnl.coverage.scopeComplete, false);
});
