import assert from "node:assert/strict";
import { it } from "node:test";
import { projectDashboardMovementEvents } from "../src/lib/portfolio-dashboard-movement-events.ts";

const serviceDate = "2026-09-21";
const asset = { id: "asset-a", accountId: "a", currency: "USD" };
const base = { id: "trade", accountId: "a", assetId: "asset-a", account: "brokerage", eventDate: serviceDate,
  eventType: "buy", quantityDelta: "0.25", ticker: "TEST", assetName: "Test", beforeValue: {quantity: "0"},
  afterValue: {quantity: "0.25"}, amountKrw: null, fxRate: null, price: null, createdAt: new Date("2026-09-21T01:00:00Z") };
const native = { type: "buy", at: "2026-09-21T00:00:00Z", assetId: "asset-a", quantity: "0.25", currency: "USD",
  settlementStatus: "unconfirmed", executionUnitPrice: { amount: "200", currency: "USD" }, orderUnitPrice: { amount: "400", currency: "USD" } };
const project = (rows, more = {}) => projectDashboardMovementEvents({ rows, positions: [], assets: [asset], serviceDate,
  now: new Date("2026-09-22T05:00:00+09:00"), ...more });

it("projects executed units and actual KRW principal, retaining unpriced FX and fractional quantity", () => {
  const settled = { ...native, settlementStatus: undefined, settlement: { amount: "65000", currency: "KRW" }, fee: {amount: "100", currency: "KRW"} };
  const [known] = project([{ ...base, amountKrw: "63000", nativeData: { event: settled }}]);
  assert.equal(known.price, 200);
  assert.equal(known.fxRate, 1300);
  assert.equal(known.quantityDelta, "0.25");
  assert.equal(known.movementEffectiveAt, "2026-09-21T00:00:00.000Z");
  assert.equal(known.beforeValue.quantity, "0");
  assert.equal("nativeData" in known, false);
  const [unpriced] = project([{ ...base, amountKrw: "65000", nativeData: { event: native }}]);
  assert.equal(unpriced.price, 200);
  assert.equal(unpriced.fxRate, null);
  assert.equal(unpriced.amountKrw, null);
  assert.equal(unpriced.movementEvidence, undefined);
  const [budget] = project([{ ...base, nativeData: { event: { ...native, executionUnitPrice: undefined }}}]);
  assert.equal(budget.movementEvidence, "unresolved");
});

it("admits an overnight broker execution once in the 07:00 cycle using the gross and ignores order or pending values", () => {
  const broker = { ...base, amountKrw: "69000", fxRate: "1380", price: "300", source: "broker_recovery_v1", eventDate: "2026-09-22", brokerRecoveryData: {
    version: 1, tradeDate: "2026-09-22", side: "buy", quantity: "0.25", executedAt: "2026-09-22T04:30:00+09:00",
    executionGross: { amount: "50.00", currency: "USD" }, orderUnitPrice: { amount: "300", currency: "USD" } } };
  const [only, duplicate] = project([broker, broker,
    { ...broker, id: "after-now", brokerRecoveryData: { ...broker.brokerRecoveryData, executedAt: "2026-09-22T06:00:00+09:00" } },
    { ...broker, id: "next-cycle", brokerRecoveryData: { ...broker.brokerRecoveryData, executedAt: "2026-09-22T07:00:00+09:00" } },
    { ...broker, id: "previous", brokerRecoveryData: { ...broker.brokerRecoveryData, executedAt: "2026-09-21T06:59:59+09:00" } }]);
  assert.equal(duplicate, undefined);
  assert.equal(only.eventDate, serviceDate);
  assert.equal(only.price, 200);
  assert.equal(only.fxRate, null);
  assert.equal(only.amountKrw, null);
  assert.equal(only.movementEffectiveAt, "2026-09-21T19:30:00.000Z");
});

it("skips a fill already captured at the actual inclusive close, respects late entries and does not invent a date-only time", () => {
  const positions = [{ ...asset, account: base.account, assetId: asset.id, currency: "USD", description: "valuation_policy=execution_collection_v1",
    cycleEndAt: new Date("2026-09-21T00:00:00Z"), capturedAt: new Date("2026-09-21T00:05:00Z") }];
  const early = { ...base, nativeData: {event: native}, createdAt: new Date("2026-09-21T00:00:01Z") };
  const dateOnly = { ...early, id: "date", nativeData: { event: { ...native, at: "2026-09-21T10:00:00Z",
    dateEvidence: { precision: "date_only", reportedDate: serviceDate } } } };
  const rows = project([early, { ...early, id: "late", createdAt: base.createdAt }, dateOnly], { positions });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].movementEffectiveAt, "2026-09-21T00:00:00.000Z");
  assert.equal(rows[1].movementEffectiveAt, undefined);
  assert.equal(rows[1].movementEvidence, "unresolved");
});

it("isolates legacy corrections by account, retains closed holdings and marks effective splits", () => {
  const first = { ...base, legacyBase44Id: "old" };
  const other = { ...base, id: "other-trade", accountId: "b", account: "isa", legacyBase44Id: "old" };
  const [changed, separate, correction, split] = project([first, other, { ...base, id: "fix", legacyCorrectsEventId: "old" }], {
    assets: [], splits: [{ id: "split", assetId: "asset-a", account: "brokerage", accountId: "a", at: native.at }] });
  assert.equal(changed.movementEvidence, "unresolved");
  assert.equal(separate.movementEvidence, undefined);
  assert.equal(separate.account, "isa");
  assert.equal(correction.movementEvidence, "unresolved");
  assert.equal(split.eventType, "split");
  assert.equal(split.movementEvidence, "unresolved");
  assert.equal(project([{ ...base, eventType: "sell", quantityDelta: "0.25" }])[0].movementEvidence, "unresolved");
});
