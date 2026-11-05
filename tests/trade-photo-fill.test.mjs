import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { matchedPhotoHolding, photoFillReview, photoFillNeedsTime, photoFillDuplicate, preparePhotoFill } from "../src/lib/trade-photo-fill.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const holdings = [{ id: "voo", name: "Vanguard S&P 500", ticker: "VOO", currency: "USD" }, { id: "msft", name: "마이크로소프트", ticker: "MSFT", currency: "USD" }, { id: "kr", name: "KODEX 200", ticker: "069500", currency: "KRW" }];
const candidate = { label: "VOO", side: "sell", date: "2026-10-26", quantity: "0.010709", price: "701.263896", currency: "USD", gross: "7.51", priceSource: "reported" };
const ready = patch => ({ ...photoFillReview(candidate, holdings), verified: true, ...patch });
test("holding matching is exact and unique; ambiguous and unrelated navigation hints never fill an instrument", () => {
  assert.equal(matchedPhotoHolding("VOO · Vanguard S&P 500", holdings), "voo");
  assert.equal(matchedPhotoHolding("Vanguard", holdings), "");
  assert.equal(matchedPhotoHolding("069500", holdings), "kr");
  assert.equal(matchedPhotoHolding("VOO", [...holdings, { ...holdings[0], id: "other" }]), "");
  assert.equal(photoFillReview({ ...candidate, label: "Unknown", date: "", currency: "" }, holdings).assetId, "");
});
test("photo review preserves execution evidence and does not infer missing date, currency, side, price or settlement", () => {
  const row = photoFillReview({ ...candidate, date: "", currency: "", priceSource: "derived", price: "701.27" }, holdings);
  assert.equal(row.side, "sell"); assert.equal(row.date, ""); assert.equal(row.currency, ""); assert.equal(row.time, "");
  assert.equal(row.price, ""); assert.equal(row.mode, "execution_total"); assert.equal(row.executionTotal, "7.51"); assert.equal(row.verified, false);
});
test("applying reported price preserves fractional quantity and precision and returns editable fields only", () => {
  const result = preparePhotoFill(ready(), holdings, [], "2026-11-05T00:00:00Z"); assert.equal(result.ok, true);
  assert.deepEqual(result.value, { assetId: "voo", side: "sell", fields: { quantity: "0.010709", price: "701.263896", executionTotal: "", currency: "USD", inputMode: "execution", executionInputMode: "execution", timePrecision: "date_only", tradeDate: "2026-10-26", at: "" } });
  assert.equal("fees" in result.value.fields, false); assert.equal("settlementCurrency" in result.value.fields, false);
});
test("exact fill total stays exact instead of rounding a recurring average", () => {
  const row = photoFillReview({ ...candidate, quantity: "3", price: "", gross: "10", priceSource: "missing" }, holdings);
  const result = preparePhotoFill({ ...row, verified: true }, holdings); assert.equal(result.ok, true);
  assert.equal(result.value.fields.executionTotal, "10"); assert.equal(result.value.fields.price, ""); assert.equal(result.value.fields.inputMode, "execution_total");
});
test("missing evidence, cross-account holding and conflicting currency cannot be applied", () => {
  for (const [patch, field] of [[{ assetId: "foreign-account" }, "assetId"], [{ date: "" }, "date"], [{ date: "2026-02-30" }, "date"], [{ currency: "" }, "currency"], [{ currency: "KRW" }, "currency"], [{ quantity: "0.1234567" }, "quantity"], [{ price: "0" }, "price"], [{ verified: false }, "verified"]]) {
    const result = preparePhotoFill(ready(patch), holdings); assert.equal(result.ok, false); assert.equal(result.issue.field, field);
  }
});
test("date-only before today's midpoint asks for actual Korean execution time without inventing it", () => {
  const now = "2026-11-05T00:00:00Z";
  assert.equal(photoFillNeedsTime("2026-11-05", now), true);
  assert.equal(photoFillNeedsTime("2026-11-04", now), false);
  const row = ready({ date: "2026-11-05" });
  assert.equal(preparePhotoFill(row, holdings, [], now).issue.reason, "time");
  assert.equal(preparePhotoFill({ ...row, time: "09:01" }, holdings, [], now).issue.reason, "future");
  const result = preparePhotoFill({ ...row, time: "08:59" }, holdings, [], now); assert.equal(result.ok, true);
  assert.equal(result.value.fields.timePrecision, "exact"); assert.equal(new Date(result.value.fields.at).getTime(), Date.parse("2026-11-05T08:59:00+09:00"));
});
test("duplicate review uses exact holding, side, date, quantity and amount with normalized decimals", () => {
  const row = ready({ quantity: "1,000", price: "2" });
  const existing = [{ assetId: "voo", side: "sell", date: row.date, quantity: "1000.000000", executionTotal: "2,000.00" }];
  assert.equal(photoFillDuplicate(row, existing), true); assert.equal(preparePhotoFill(row, holdings, existing).issue.reason, "duplicate");
  for (const patch of [{ assetId: "other" }, { side: "buy" }, { date: "2026-10-27" }, { quantity: "999" }, { executionTotal: "2000.01" }, { executionTotal: "" }]) assert.equal(photoFillDuplicate(row, [{ ...existing[0], ...patch }]), false);
});

const walk = node => node && typeof node === "object" ? Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)] : [];
const text = node => node == null ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const line = (text, x, y, w = 130) => ({ text, confidence: 95, bbox: { x0: x, y0: y, x1: x + w, y1: y + 25 } });
const detail = () => [line("매수 소수점", 50, 200), line("마이크로소프트", 50, 270, 300), line("주문일시", 50, 500), line("2026.10.26 12:47", 580, 500, 300), line("체결가격", 50, 700), line("527.92USD", 700, 700), line("체결수량", 50, 800), line("0.633088주", 700, 800), line("체결금액", 50, 900), line("334.22USD", 700, 900)];
function hooks() {
  const state = [], refs = [], dependencies = [], cleanups = []; let index = 0, refIndex = 0, effectIndex = 0, effects = [];
  return { begin() { index = 0; refIndex = 0; effectIndex = 0; effects = []; }, flush() { for (const [at, effect] of effects) { cleanups[at]?.(); cleanups[at] = effect(); } }, unmount() { for (const cleanup of cleanups) cleanup?.(); }, react: {
    useId: () => "photo-fill",
    useState(initial) { const at = index++; if (!(at in state)) state[at] = typeof initial === "function" ? initial() : initial; return [state[at], next => state[at] = typeof next === "function" ? next(state[at]) : next]; },
    useRef(initial) { const at = refIndex++; return refs[at] ?? (refs[at] = { current: initial }); },
    useEffect(effect, deps) { const at = effectIndex++; if (!dependencies[at] || !deps || deps.some((item, i) => !Object.is(item, dependencies[at][i]))) effects.push([at, effect]); dependencies[at] = deps; },
  } };
}
let harnessCount = 0;
async function harness(reader, extra = {}) {
  const h = hooks(), calls = [], opens = [], revoked = [], key = `__tradePhotoReader${++harnessCount}`;
  globalThis[key] = reader;
  const io = registerHooks({ resolve(name, context, next) { return name === "@/lib/balance-photo-reader" ? { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(`export const readBrokeragePhotoText=globalThis.${key};`) } : next(name, context); } });
  const [ui] = await importUiWithPorts(["src/components/trade-import/trade-photo-fill.tsx"], { react: h.react, "next/image": { default: () => null } });
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, frame: globalThis.requestAnimationFrame };
  URL.createObjectURL = () => "blob:local-photo"; URL.revokeObjectURL = url => revoked.push(url); globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  const props = { accountId: "account", holdings, selectedAssetId: "voo", side: "sell", serverNow: "2026-11-05T00:00:00Z", onApply: value => calls.push(value), onOpenChange: value => opens.push(value), ...extra };
  const render = () => { h.begin(); const tree = ui.TradePhotoFill(props); h.flush(); return tree; };
  return { calls, opens, revoked, render, button(label) { return walk(render()).find(node => node.type === "button" && text(node) === label); },
    async selectPhoto() { const control = walk(render()).find(node => node.type === "input" && node.props.type === "file"); control.props.onChange({ target: { files: [{ name: "fill.png" }], value: "fill.png" } }); await new Promise(resolve => setImmediate(resolve)); },
    cleanup() { h.unmount(); io.deregister(); delete globalThis[key]; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; globalThis.requestAnimationFrame = original.frame; },
  };
}
test("local photo reading keeps the manual draft untouched until explicit review; all actions avoid nested submission", async () => {
  const app = await harness(async (_file, _signal, progress, options) => { assert.equal(options.tradeNumbers, true); progress(42); return { lines: detail(), width: 1000, height: 2000 }; });
  try {
    await app.selectPhoto(); assert.deepEqual(app.opens, [true]); assert.equal(app.calls.length, 0);
    const tree = app.render(); assert.equal(walk(tree).some(node => node.type === "form"), false);
    assert.ok(walk(tree).filter(node => node.type === "button").every(node => node.props.type === "button"));
    assert.match(text(tree), /사진의 종목으로 바뀌어요/); assert.match(text(tree), /매수·매도 종류도 달라요/);
    app.button("입력칸에 채우기").props.onClick(); assert.equal(app.calls.length, 0); assert.match(text(app.render()), /기존 잔고 포함 여부/);
    walk(app.render()).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
    app.button("입력칸에 채우기").props.onClick(); assert.equal(app.calls.length, 1); assert.equal(app.calls[0].assetId, "msft"); assert.equal(app.calls[0].side, "buy"); assert.equal(app.calls[0].fields.quantity, "0.633088"); assert.deepEqual(app.opens, [true, false]); assert.deepEqual(app.revoked, ["blob:local-photo"]);
    assert.match(text(app.render()), /확인 후 기록/);
  } finally { app.cleanup(); }
});
test("cancelling local recognition aborts it, restores trigger focus and ignores a late result", async () => {
  let resolveRead, signal, focused = 0;
  const app = await harness((_file, inputSignal) => { signal = inputSignal; return new Promise(resolve => { resolveRead = resolve; }); });
  try {
    app.button("사진에서 입력").props.ref.current = { focus() { focused++; } };
    await app.selectPhoto(); assert.equal(signal.aborted, false);
    app.button("취소하고 직접 입력").props.onClick(); assert.equal(signal.aborted, true); assert.equal(focused, 1);
    resolveRead({ lines: detail(), width: 1000, height: 2000 }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.calls.length, 0); assert.deepEqual(app.opens, [true, false]); assert.doesNotMatch(text(app.render()), /체결 내역을 확인/); assert.deepEqual(app.revoked, []);
  } finally { app.cleanup(); }
});
test("a photo with multiple fills requires choosing one and Escape cancels review without dismissing its parent", async () => {
  const lines = [...detail(), ...detail().map(row => ({ ...row, bbox: { ...row.bbox, y0: row.bbox.y0 + 1500, y1: row.bbox.y1 + 1500 } }))];
  const app = await harness(async () => ({ lines, width: 1000, height: 4000 }));
  try {
    await app.selectPhoto(); assert.equal(app.button("입력칸에 채우기"), undefined);
    const select = walk(app.render()).find(node => node.type === "select"); assert.equal(select.props.value, ""); select.props.onChange({ target: { value: "1" } });
    assert.ok(app.button("입력칸에 채우기")); assert.equal(app.calls.length, 0);
    let prevented = false, stopped = false;
    walk(app.render()).find(node => node.props?.onKeyDown).props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(app.calls.length, 0); assert.deepEqual(app.revoked, ["blob:local-photo"]);
  } finally { app.cleanup(); }
});
test("today's photo requests execution time and validates it against the current observed server clock at application", async () => {
  let now = "2026-11-05T00:00:00Z";
  const lines = detail().map(row => row.text === "2026.10.26 12:47" ? { ...row, text: "2026.11.05 08:47" } : row);
  const app = await harness(async () => ({ lines, width: 1000, height: 2000 }), { readServerNow: () => now });
  try {
    await app.selectPhoto(); let time = walk(app.render()).find(node => node.type === "input" && node.props.type === "time");
    assert.equal(time.props.value, ""); assert.match(text(app.render()), /실제 체결 시각/);
    time.props.onChange({ target: { value: "09:30" } });
    walk(app.render()).find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: true } });
    const apply = app.button("입력칸에 채우기"); assert.match(text(app.render()), /지나지 않은 시각/);
    now = "2026-11-05T01:00:00Z"; apply.props.onClick();
    assert.equal(app.calls.length, 1); assert.equal(app.calls[0].fields.timePrecision, "exact");
    assert.equal(Date.parse(app.calls[0].fields.at), Date.parse("2026-11-05T09:30:00+09:00"));
  } finally { app.cleanup(); }
});
