import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContributionMarketContext, compareContributionFxAssumption } from "../src/lib/contribution-market-context.ts";

const now = new Date("2026-09-09T12:00:00Z");
const observation = (overrides = {}) => ({ rateDate: "2026-09-09", usdKrw: "1350", source: "fixture_actual_fx", fetchedAt: "2026-09-09T10:00:00Z", ...overrides });

describe("contribution observed market context", () => {
  it("keeps missing and stale FX explicit without inventing a neutral range", () => {
    assert.equal(buildContributionMarketContext([], now).fx.rate, null);
    const one = buildContributionMarketContext([observation()], now).fx;
    assert.equal(one.status, "ready");
    assert.equal(one.rangePositionPct, null);
    const stale = buildContributionMarketContext([observation({ rateDate: "2026-09-01" })], now).fx;
    assert.equal(stale.status, "stale");
    assert.equal(stale.rate, 1350);
  });
  it("excludes future, impossible dates, unknown source/time and invalid rates", () => {
    for (const overrides of [{ rateDate: "2026-09-10" }, { rateDate: "2026-02-30" }, { fetchedAt: "2026-09-10T00:00:00Z" }, { fetchedAt: null }, { source: "" }, { usdKrw: 0 }, { usdKrw: Infinity }]) {
      assert.equal(buildContributionMarketContext([observation(overrides)], now).fx.status, "unavailable");
    }
  });
  it("uses distinct dates from the same source and does not mix provider histories", () => {
    const rows = Array.from({length: 20}, (_, index) => observation({ rateDate: new Date(Date.UTC(2026, 8, 9 - index)).toISOString().slice(0,10), usdKrw: 1350 - index }));
    const result = buildContributionMarketContext([...rows, ...rows, observation({ source: "different", usdKrw: 100, rateDate: "2026-09-08" })], now).fx;
    assert.equal(result.observationCount, 20);
    assert.equal(result.rangeLow, 1331);
    assert.equal(result.rangeHigh, 1350);
    assert.equal(result.rangePositionPct, 100);
  });
  it("does not fabricate a range position when all observations are equal", () => {
    const rows = Array.from({length: 20}, (_, index) => observation({ rateDate: new Date(Date.UTC(2026, 8, 9 - index)).toISOString().slice(0,10) }));
    assert.equal(buildContributionMarketContext(rows, now).fx.rangePositionPct, null);
  });
  it("anchors the historical range to today even when the last quote is stale", () => {
    const rows = Array.from({length: 25}, (_, index) => observation({ rateDate: new Date(Date.UTC(2026, 4, 31 - index)).toISOString().slice(0,10), usdKrw: 1300 + index }));
    const result = buildContributionMarketContext(rows, now).fx;
    assert.equal(result.status, "stale");
    assert.equal(result.observationCount, 0);
    assert.equal(result.rangeLow, null);
  });
  it("changes only direct USD translation, preserving KRW holdings and inputs", () => {
    const rows = Object.freeze([Object.freeze({currency:"USD",currentValueKrw:100000}),Object.freeze({currency:"KRW",currentValueKrw:300000})]);
    const result = compareContributionFxAssumption(rows, -1000);
    assert.equal(result.usdListedWeightPct, 25);
    assert.equal(result.differenceKrw, -10000);
    assert.equal(result.scenarioValueKrw, 390000);
    assert.equal(rows[0].currentValueKrw, 100000);
    assert.equal(compareContributionFxAssumption(rows, 2001), null);
    assert.equal(compareContributionFxAssumption([{currency:"USD",currentValueKrw:NaN}], 0), null);
  });
});
