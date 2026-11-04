import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REFRESH_OPERATION_KEY, REFRESH_OPERATION_MAX_AGE, parseRefreshOperation,
  readRefreshOperation, retainRefreshOperation, refreshTargetKey,
} from "../src/lib/market-data/quote-refresh-operation.ts";

const now = Date.parse("2026-11-05T01:00:00.000Z");
const operation = () => ({
  ownerBinding: "a".repeat(64), startedAt: new Date(now).toISOString(),
  targets: Array.from({ length: 8 }, (_, i) => ({ ticker: `Q${i}`, market: "us", currency: "USD" })), fxTicker: "Q0",
});
function storage(initial) {
  const values = new Map(initial === undefined ? [] : [[REFRESH_OPERATION_KEY, initial]]);
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

describe("manual quote continuation hints", () => {
  it("preserves all eight frozen instruments and the FX representative without retaining a mutable caller array", () => {
    const source = operation(), parsed = parseRefreshOperation(source, now);
    assert.deepEqual(parsed, source);
    source.targets[0].ticker = "MUTATED";
    assert.equal(parsed.targets[0].ticker, "Q0");
    assert.equal(parsed.fxTicker, "Q0");
    assert.equal(refreshTargetKey({ ticker: "qqq", market: "US", currency: "usd" }), refreshTargetKey({ ticker: "QQQ", market: "us", currency: "USD" }));
  });

  it("bounds continuation age and target count while allowing an empty captured scope", () => {
    const first = operation();
    assert.ok(parseRefreshOperation(first, now + REFRESH_OPERATION_MAX_AGE));
    assert.equal(parseRefreshOperation(first, now + REFRESH_OPERATION_MAX_AGE + 1), null);
    assert.equal(parseRefreshOperation({ ...first, startedAt: new Date(now + 60_001).toISOString() }, now), null);
    assert.deepEqual(parseRefreshOperation({ ...first, targets: [], fxTicker: null }, now)?.targets, []);
    const forty = Array.from({ length: 40 }, (_, i) => ({ ticker: `Q${i}`, market: "us", currency: "USD" }));
    assert.ok(parseRefreshOperation({ ...first, targets: forty }, now));
    assert.equal(parseRefreshOperation({ ...first, targets: [...forty, { ticker: "Q40", market: "us", currency: "USD" }] }, now), null);
  });

  for (const [label, change] of [
    ["raw owner identity", value => ({ ...value, ownerBinding: "owner@example.com" })],
    ["receipt or asset amount", value => ({ ...value, progress: { completed: 8 }, valueKrw: 1000000 })],
    ["holding data in a target", value => ({ ...value, targets: [{ ...value.targets[0], quantity: "0.896567" }] })],
    ["duplicate targets", value => ({ ...value, targets: [...value.targets, value.targets[0]] })],
    ["invalid ticker", value => ({ ...value, targets: [{ ...value.targets[0], ticker: "Q0?owner=other" }] })],
    ["invalid currency", value => ({ ...value, targets: [{ ...value.targets[0], currency: "usd" }] })],
    ["FX target outside captured scope", value => ({ ...value, fxTicker: "FOREIGN" })],
    ["non-USD FX representative", value => ({ ...value, targets: [{ ticker: "069500", market: "kr", currency: "KRW" }], fxTicker: "069500" })],
    ["non-ISO cutoff", value => ({ ...value, startedAt: "November 5, 2026" })],
    ["missing required FX discriminator", value => { const rest = { ...value }; delete rest.fxTicker; return rest; }],
  ]) it(`rejects ${label} before restoration`, () => assert.equal(parseRefreshOperation(change(operation()), now), null));

  it("persists only the continuation hint and removes expired or oversized values", () => {
    const browser = storage();
    retainRefreshOperation(browser, operation());
    assert.deepEqual(readRefreshOperation(browser, now), operation());
    assert.deepEqual(Object.keys(JSON.parse(browser.values.get(REFRESH_OPERATION_KEY))).sort(), ["fxTicker", "ownerBinding", "startedAt", "targets"]);
    assert.equal(readRefreshOperation(browser, now + REFRESH_OPERATION_MAX_AGE + 1), null);
    assert.equal(browser.values.has(REFRESH_OPERATION_KEY), false);
    browser.setItem(REFRESH_OPERATION_KEY, "x".repeat(8193));
    assert.equal(readRefreshOperation(browser, now), null);
    assert.equal(browser.values.has(REFRESH_OPERATION_KEY), false);
    retainRefreshOperation(browser, operation()); retainRefreshOperation(browser, null);
    assert.equal(browser.values.size, 0);
  });

  it("treats corrupt JSON and restricted browser storage as unavailable without breaking active work", () => {
    assert.equal(readRefreshOperation(storage("{"), now), null);
    const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
    assert.equal(readRefreshOperation(denied, now), null);
    assert.doesNotThrow(() => retainRefreshOperation(denied, operation()));
    assert.doesNotThrow(() => retainRefreshOperation(denied, null));
  });
});
