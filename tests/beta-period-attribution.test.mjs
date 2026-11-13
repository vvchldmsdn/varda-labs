import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPeriodAttribution, calendarAttributionRange, validateAttributionRange } from "../src/lib/cairn-v2/period-attribution.ts";

const accounts = [{ id: "isa", name: "ISA" }];
const end = { start: "2026-11-01", end: "2026-11-01" };
const position = (quantity, price, fxRate, assetId = "abc") => ({ assetId, name: "Alpha", ticker: "ABC", market: "us",
  currency: "USD", quantity, price, fxRate, fixedKrw: 0, marketValueKrw: quantity * price * fxRate });
const snapshot = (date, positions, extra) => ({ date, accountId: "isa", expectedPositions: positions.length, positions, ...extra });
const trade = (quantityDelta, price, fxRate, extra) => ({ date: end.end, accountId: "isa", assetId: "abc", quantityDelta, price, fxRate, ...extra });
const calc = (before, after, trades = []) => buildPeriodAttribution(end, { accounts,
  observations: [snapshot("2026-10-31", before), snapshot(end.end, after)], trades });

test("calendar presets and inclusive custom bounds use real dates, including leap days and year changes", () => {
  assert.deepEqual(calendarAttributionRange("lastMonth", "2024-03-01"), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(calendarAttributionRange("lastMonth", "2026-01-02"), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(calendarAttributionRange("thisMonth", end.end), end);
  for (const day of ["2026-02-29", "0000", "2026-2-10", "2026-11-31"]) assert.equal(validateAttributionRange({ start: day, end: day }, end.end), false);
  assert.equal(validateAttributionRange({ start: "2024-01-01", end: "2024-12-31" }, end.end), true);
  assert.equal(validateAttributionRange({ start: "2024-01-01", end: "2025-01-01" }, end.end), false);
  assert.equal(validateAttributionRange({ start: "2026-11-02", end: "2026-11-01" }, end.end), false);
  assert.equal(validateAttributionRange({ start: "2026-11-01", end: "2026-11-02" }, end.end), false);
});

test("a one-day interval uses the preceding valuation and real fractional quantity, including its first day", () => {
  const result = calc([position(.5, 100, 1200)], [position(.5, 104, 1210)]);
  assert.deepEqual([result.state, result.priceKrw, result.fxKrw, result.totalKrw], ["complete", 2400, 520, 2920]);
  assert.deepEqual(result.days, [{ date: end.start, priceKrw: 2400, fxKrw: 520, complete: true }]);
  assert.equal(result.holdings[0].name, "ABC");
});

test("purchases during a period enter at their execution marks; partial sales remove only executed exposure", () => {
  const purchase = calc([], [position(2, 105, 1250)], [trade(2, 103, 1220)]);
  assert.deepEqual([purchase.state, purchase.priceKrw, purchase.fxKrw], ["complete", 4880, 6300]);
  const reduction = calc([position(2, 100, 1200)], [position(1, 105, 1250)], [trade(-1, 104, 1220)]);
  assert.equal(reduction.state, "complete");
  assert.equal(reduction.totalKrw, 105 * 1250 - 2 * 100 * 1200 + 104 * 1220);
  assert.equal(reduction.priceKrw, 2 * 5 * 1200 - (105 - 104) * 1220);
});

test("a completely sold holding without a closing quote remains in the historical result at its execution marks", () => {
  const result = calc([position(2, 100, 1200)], [], [trade(-1, 103, 1210), trade(-1, 106, 1220)]);
  assert.equal(result.state, "complete");
  assert.deepEqual([result.priceKrw, result.fxKrw], [9 * 1200, 103 * 10 + 106 * 20]);
  assert.equal(result.holdings[0].totalKrw, result.totalKrw);
  assert.equal(calc([position(2, 100, 1200)], []).gaps[0].reason, "trade");
});

test("fully identified domestic share movement has exactly zero FX and keeps the Korean display name", () => {
  const local = price => ({ ...position(2, price, 1), name: "코덱스 200", ticker: "069500", market: "korea", currency: "KRW", fxRate: null });
  const result = calc([local(100)], [local(110)]);
  assert.deepEqual([result.priceKrw, result.fxKrw, result.holdings[0].name], [20, 0, "코덱스 200"]);
});

test("same-day round trips use real executed prices and rates even with no closing position", () => {
  const domestic = calc([], [], [trade(1, 40000, null, { currency: "KRW", name: "당일매매" }), trade(-1, 41000, null, {currency:"KRW"})]);
  assert.deepEqual([domestic.priceKrw, domestic.fxKrw, domestic.holdings[0].name], [1000, 0, "당일매매"]);
  const usd = calc([], [], [trade(1, 100, 1200, {currency:"USD"}), trade(.5, 100, 1500, {currency:"USD"}), trade(-1.5, 110, 1400, {currency:"USD"})]);
  assert.deepEqual([usd.state, usd.priceKrw, usd.fxKrw], ["complete", 19500, 16500]);
});

test("a re-purchase then full exit separates price and FX against the opening rate, without cash contributions", () => {
  const r = calc([position(1, 100, 1100)], [], [trade(1, 110, 1150), trade(-2, 130, 1200)]);
  assert.deepEqual([r.state, r.priceKrw, r.fxKrw, r.totalKrw], ["complete", 55000, 20500, 75500]);
});

test("known holdings survive a partial account; consecutive missing FX is grouped only for that position", () => {
  const series = [snapshot("2026-10-31", [position(1, 10, 1100), position(1, 50, 1100, "other")]),
    snapshot("2026-11-01", [{ ...position(1, 11, 1100), fxRate: null }, position(1, 51, 1100, "other")]),
    snapshot("2026-11-02", [position(1, 12, 1100), position(1, 52, 1100, "other")])];
  const result = buildPeriodAttribution({ start: end.start, end: "2026-11-02" }, { accounts, observations: series, trades: [] });
  assert.deepEqual([result.state, result.priceKrw, result.fxKrw], ["partial", 2200, 0]);
  assert.deepEqual(result.gaps, [{ start: end.start, end: "2026-11-02", account: "ISA", holding: "ABC", reason: "fx" }]);
  assert.ok(result.days.every(d => !d.complete && d.priceKrw === 1100));
});

test("an unexplained quantity change, missing price or conflicting evidence is not converted to zero", () => {
  const old = position(1, 10, 1200), next = position(2, 10, 1200);
  for (const [result, reason] of [[calc([old], [next]), "trade"], [calc([old], [{ ...old, price: null }]), "price"],
    [calc([old], [{ ...old, marketValueKrw: 999 }]), "valuation"], [calc([old], [next], [trade(1, 10, null)]), "trade"],
    [calc([old], [next], [trade(1, 10, 1200, { assetId: null })]), "trade"]]) {
    assert.equal(result.state, "unavailable"); assert.equal(result.priceKrw, null); assert.equal(result.fxKrw, null);
    assert.equal(result.gaps[0].reason, reason);
  }
});

test("a cutoff with no KRW valuation reports the missing price or exchange rate at either endpoint", () => {
  const complete = position(1, 100, 1250);
  for (const [overrides, reason] of [[{ price: null }, "price"], [{ fxRate: null }, "fx"], [{}, "valuation"]]) {
    const missing = { ...complete, ...overrides, marketValueKrw: null };
    for (const [before, after] of [[missing, complete], [complete, missing]]) {
      const result = calc([before], [after]);
      assert.equal(result.state, "unavailable");
      assert.equal(result.totalKrw, null);
      assert.equal(result.gaps[0].reason, reason);
    }
  }
});

test("an absent account day blocks both adjacent comparisons, not a later matched interval", () => {
  const observations = [snapshot("2026-10-31", [position(1, 100, 1000)]),
    snapshot("2026-11-02", [position(1, 110, 1000)]), snapshot("2026-11-03", [position(1, 111, 1000)])];
  const result = buildPeriodAttribution({ start: end.start, end: "2026-11-03" }, { accounts, observations, trades: [] });
  assert.deepEqual(result.days.map(d => d.priceKrw), [null, null, 1000]);
  assert.equal(result.gaps[0].start, end.start); assert.equal(result.gaps[0].end, "2026-11-02");
  assert.equal(result.state, "partial");
});

test("same holding IDs in separate accounts never mix and out-of-scope evidence is ignored", () => {
  const accountB = { id: "retirement", name: "연금" };
  const observations = accounts.concat(accountB).flatMap(({ id }, i) =>
    [snapshot("2026-10-31", [position(1, 100, 1000)], {accountId:id}),
      snapshot(end.start, [position(1, 100+i+1, 1000)], {accountId:id})]);
  const both = buildPeriodAttribution(end, { accounts: [...accounts, accountB], observations, trades: [] });
  assert.equal(both.holdings.length, 2); assert.equal(both.priceKrw, 3000);
  const only = buildPeriodAttribution(end, { accounts, observations, trades: [] });
  assert.equal(only.priceKrw, 1000); assert.equal(only.holdings[0].account, "ISA");
});

test("unknown or contradictory rosters cannot prove a new purchase; confirmed empty differs from missing", () => {
  const before = snapshot("2026-10-31", [], { expectedPositions: 1 }), after = snapshot(end.end, [position(1, 110, 1100)]);
  const incomplete = buildPeriodAttribution(end, {accounts, observations: [before, after], trades: [trade(1, 100, 1100)]});
  assert.equal(incomplete.state, "unavailable"); assert.ok(incomplete.gaps.some(g => g.reason === "holding_history"));
  const duplicate = buildPeriodAttribution(end, {accounts, observations: [before, before, after], trades: []});
  assert.equal(duplicate.gaps[0].reason, "account_history");
  assert.deepEqual([calc([], []).state, calc([], []).totalKrw], ["complete", 0]);
  const onlyEmpty = buildPeriodAttribution(end, { accounts: [...accounts, { id: "absent", name: "미관측" }],
    observations: [snapshot("2026-10-31", []), snapshot(end.end, [])], trades: [] });
  assert.deepEqual([onlyEmpty.state, onlyEmpty.totalKrw], ["unavailable", null]);
  const noAccounts = buildPeriodAttribution(end, {accounts: [], observations: [], trades: []});
  assert.equal(noAccounts.state, "unavailable"); assert.equal(noAccounts.totalKrw, null);
});
