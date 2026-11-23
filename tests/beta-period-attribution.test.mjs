import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPeriodAttribution, calendarAttributionRange, validateAttributionRange } from "../src/lib/cairn-v2/period-attribution.ts";
import { periodChartSeries } from "../src/lib/cairn-v2/period-chart-series.ts";
import { buildPeriodPerformance } from "../src/lib/cairn-v2/period-performance.ts";

const accounts = [{ id: "isa", name: "ISA" }];
const end = { start: "2026-11-01", end: "2026-11-01" };
const position = (quantity, price, fxRate, assetId = "abc") => ({ assetId, name: "Alpha", ticker: "ABC", market: "us",
  currency: "USD", quantity, price, fxRate, fixedKrw: 0, marketValueKrw: quantity * price * fxRate });
const snapshot = (date, positions, extra) => ({ date, accountId: "isa", expectedPositions: positions.length, positions, ...extra });
const trade = (quantityDelta, price, fxRate, extra) => ({ date: end.end, accountId: "isa", assetId: "abc", quantityDelta, price, fxRate, ...extra });
const calc = (before, after, trades = []) => buildPeriodAttribution(end, { accounts,
  observations: [snapshot("2026-10-31", before), snapshot(end.end, after)], trades });

test("return adjusts buys and sales on dated shares and retains losses during net investment", () => {
  const range = {start:"2026-11-01", end:"2026-11-04"};
  const frames = [[1,1,100],[2,2,90],[3,1,99],[4,1,99]].map(([d,q,p]) =>
    snapshot("2026-11-0"+d, [position(q,p,1)], {source:"manual_daily"}));
  const trades = [trade(1,90,1,{date:"2026-11-02"}),trade(-1,99,1,{date:"2026-11-03"})];
  const input={accounts:[{id:"isa",holdings:true}], observations:frames,trades,cashFlows:[]};
  const result=buildPeriodPerformance(range,input);
  assert.equal(result.basis,"invested_assets_excluding_cash");
  assert.deepEqual(result.gaps,[]);
  assert.deepEqual(result.points.map(p=>Math.round(p.returnPct)),[0,-10,-1,-1]);
  assert.deepEqual(result.points.map(p=>p.dailyReturnPct===null?null:Math.round(p.dailyReturnPct)),[null,-10,10,0]);
  assert.ok(result.points.every(p=>p.segment===range.start));
  // KRW settlement suffices even when its native unit price or FX is unknown.
  assert.deepEqual(buildPeriodPerformance(range,{...input,trades:[{...trades[0],fxRate:null,price:null,flowKrw:90},trades[1]]}),result);
  const missing=buildPeriodPerformance(range,{...input,trades:[trades[1]]});
  assert.deepEqual(missing.gaps,[{start:"2026-11-02",end:"2026-11-02",reason:"trade"}]);
  assert.equal(missing.points[0].returnPct,null);
  assert.equal(missing.points[1].segment,null);
  assert.equal(missing.points[1].returnPct,null);
  assert.equal(missing.points[1].dailyReturnPct,null);
  assert.equal(missing.points[2].segment,"2026-11-02");
  assert.ok(Math.abs(missing.points[2].dailyReturnPct-10)<1e-8);
});

test("a provisional valuation never bridges a missing preceding cutoff", () => {
  const range={start:"2026-09-13",end:"2026-09-15"};
  const observations=[snapshot(range.start,[position(1,100,1)],{source:"varda_manual_daily_snapshot"}),
    snapshot(range.end,[position(1,120,1)],{source:"current_investments",liveAsOf:"2026-09-15T10:00:00Z"})];
  const result=buildPeriodPerformance(range,{accounts:[{id:"isa",holdings:true}],observations,trades:[],cashFlows:[]});
  assert.ok(result.points.every(row=>row.returnPct===null && !row.liveAsOf));
});

test("unchanged carried manual marks support a disclosed stored-valuation estimate; scope and unexplained moves break it", () => {
  const range={start:"2026-11-01",end:"2026-11-03"};
  const obs=[100,100,150].map((p,i)=>snapshot("2026-11-0"+(i+1),[{...position(1,p,1),carriedMark:true}],{source:"manual_daily"}));
  const input={accounts:[{id:"isa",holdings:true}],observations:obs,trades:[],cashFlows:[]};
  const result=buildPeriodPerformance(range,input);
  assert.equal(result.includesCarriedMarks,true);
  assert.deepEqual(result.points.map(p=>p.returnPct),[0,0,null]);
  assert.deepEqual(result.gaps,[{start:range.end,end:range.end,reason:"valuation"}]);
  const multi=buildPeriodPerformance(range,{...input,accounts:[...input.accounts,{id:"second",holdings:false}]});
  assert.equal(multi.basis,"mixed"); assert.deepEqual(multi.gaps,[{...range,reason:"scope"}]);
  const incomplete=buildPeriodPerformance(range,{...input,accounts:[...input.accounts,{id:"second",holdings:true}]});
  assert.ok(incomplete.points.every(p=>p.returnPct===null));
});

test("an absent close stays empty; the next measured close uses all intervening flows and calendar weights", () => {
  const range = {start:"2026-11-01",end:"2026-11-04"};
  const input = { accounts:[{id:"isa",holdings:true}], trades:[trade(1,100,1,{date:"2026-11-02"})], cashFlows:[],
    observations:[[1,1,100],[3,2,110],[4,2,110]].map(([d,q,p]) =>
      snapshot("2026-11-0"+d,[position(q,p,1)],{source:"manual_daily"})) };
  const result = buildPeriodPerformance(range,input);
  assert.deepEqual(result.gaps,[{start:"2026-11-02",end:"2026-11-02",reason:"valuation"}]);
  assert.equal(result.points[1].returnPct,null); assert.equal(result.points[2].dailyReturnPct,null);
  assert.ok(Math.abs(result.points[2].returnPct-20/150*100)<1e-9);
  assert.equal(result.points[2].segment,range.start);
  assert.equal(result.points[3].dailyReturnPct,0);
  const missingFx = buildPeriodPerformance(range,{...input,trades:[{...input.trades[0],fxRate:null}]});
  assert.ok(missingFx.gaps.some(g=>g.reason==="trade" && g.end==="2026-11-03"));
  const closingFx = buildPeriodPerformance(range,{...input,trades:[{...input.trades[0],closingFx:true}]});
  assert.deepEqual(closingFx.points.map(p=>Boolean(p.estimatedFx)),[false,false,true,true]);
  assert.equal(closingFx.includesClosingFx,true);
});

test("one missing account close leaves only that date blank when the surrounding aggregate balances reconcile", () => {
  const range = { start: "2026-11-01", end: "2026-11-03" };
  const rows = [1, 2, 3].map(d => snapshot("2026-11-0"+d, [position(1, 100 + 10*(d-1), 1)], {source:"daily"}));
  const second = d => snapshot("2026-11-0"+d, [position(1,100,1)], {source:"daily", accountId:"second"});
  const input = { accounts:[{id:"isa",holdings:true},{id:"second",holdings:true}], observations:[...rows,second(1),second(3)], trades:[], cashFlows:[] };
  const result = buildPeriodPerformance(range,input);
  assert.deepEqual(result.gaps,[{start:"2026-11-02",end:"2026-11-02",reason:"valuation"}]);
  assert.equal(result.points[1].returnPct,null);
  assert.equal(result.points[2].dailyReturnPct,null);
  assert.equal(result.points[2].segment,range.start);
  assert.ok(Math.abs(result.points[2].returnPct-10)<1e-9);
  const invalid = buildPeriodPerformance(range,{...input,observations:[...input.observations,{...second(2),expectedPositions:2}]});
  assert.equal(invalid.points[2].returnPct,null);
});

test("a native account that lost all capital keeps its terminal loss when a new deposit restarts it", () => {
  const range={start:"2025-11-01",end:"2025-11-03"};
  const input={accounts:[{id:"isa",holdings:false}],trades:[],observations:[100,0,150].map((v,i)=>
    snapshot("2025-11-0"+(i+1),[position(1,v,1)],{source:"native",at:"2025-11-0"+(i+1)+"T22:00:00Z"})),
    cashFlows:[{date:"2025-11-03",accountId:"isa",at:"2025-11-03T10:00:00Z",amountKrw:100}]};
  const result=buildPeriodPerformance(range,input);
  assert.deepEqual(result.points.map(p=>p.dailyReturnPct),[null,-100,100]);
  assert.deepEqual(result.points.map(p=>p.returnPct),[0,-100,100]);
  assert.equal(result.points[1].segment,range.start); assert.equal(result.points[2].segment,"2025-11-02");
  const unknown=buildPeriodPerformance(range,{...input,cashFlows:[{...input.cashFlows[0],amountKrw:null}]});
  assert.deepEqual(unknown.gaps,[{start:range.end,end:range.end,reason:"cash_flow"}]);
});

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
  assert.deepEqual(result.days, [{ date: end.start, closingValueKrw: 62920, priceKrw: 2400, fxKrw: 520, complete: true }]);
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
  assert.deepEqual(result.days.map(d => d.closingValueKrw), [null, 110000, 111000]);
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
  assert.equal(both.days[0].closingValueKrw, 203000);
  const only = buildPeriodAttribution(end, { accounts, observations, trades: [] });
  assert.equal(only.priceKrw, 1000); assert.equal(only.holdings[0].account, "ISA");
  assert.equal(only.days[0].closingValueKrw, 101000);
});

test("closing holdings are independent from price/FX attribution, and incomplete rosters cannot yield a total", () => {
  const holding = position(1, 123, 1250);
  const date = end.end;
  const close = (...observations) => buildPeriodAttribution(end, { accounts, observations, trades: [] }).days[0];
  const savedOnly = close(snapshot(date, [{...holding, price: null, fxRate: null}]));
  assert.equal(savedOnly.closingValueKrw, 153750);
  assert.equal(savedOnly.priceKrw, null);
  assert.equal(close(snapshot(date, [])).closingValueKrw, 0);
  assert.equal(close().closingValueKrw, null);
  assert.equal(close(snapshot(date, [holding]), snapshot(date, [holding])).closingValueKrw, null);
  assert.equal(close(snapshot(date, [holding, holding])).closingValueKrw, null);
  assert.equal(close(snapshot(date, [holding], { expectedPositions: 2 })).closingValueKrw, null);
  assert.equal(close(snapshot(date, [{...holding, marketValueKrw:null}])).closingValueKrw, null);
});

test("paired period charts preserve daily valuation gaps and the actual calendar width of a clipped week", () => {
  const days = Array.from({length: 32}, (_, index) => ({
    date: new Date(Date.UTC(2026,10,1 + index)).toISOString().slice(0,10),
    closingValueKrw: index === 2 ? null : index, priceKrw: index === 3 ? null : 100,
    fxKrw: index === 3 ? null : -10, complete: index !== 3,
  }));
  const {buckets, runs, unit, low, high} = periodChartSeries(days);
  assert.equal(unit, "week");
  assert.deepEqual([low,high], [0,31]);
  assert.deepEqual(runs.map(run=>[run[0].index,run.at(-1).index]), [[0,1],[3,31]]);
  assert.deepEqual(buckets.slice(0,2), [
    { start:"2026-11-01", end:"2026-11-01", from:0, count:1, price:100, fx:-10, partial:false },
    { start:"2026-11-02", end:"2026-11-08", from:1, count:7, price:600, fx:-60, partial:true },
  ]);
  assert.equal(buckets.at(-1).from + buckets.at(-1).count, days.length);
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
