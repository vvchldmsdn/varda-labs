import assert from "node:assert/strict";
import { test } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { emptyAmountImport } from "../src/lib/quick-amount-import.ts";
import { QUICK_WORKSPACE_KEY, QUICK_WORKSPACE_TTL } from "../src/lib/quick-portfolio-workspace.ts";
const walk = node => node && typeof node === "object" ? Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)] : [];
const text = node => node == null ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const i18n = { useI18n: () => ({ locale: "ko", t: ko => ko }) };
function hooks() {
  const state = [], refs = [], dependencies = []; let index = 0, refIndex = 0, effectIndex = 0, effects = [];
  return { begin() { index = 0; refIndex = 0; effectIndex = 0; effects = []; }, flush() { for (const effect of effects) effect(); }, react: {
    useCallback: callback => callback,
    useState(initial) { const at = index++; if (!(at in state)) state[at] = typeof initial === "function" ? initial() : initial; return [state[at], next => state[at] = typeof next === "function" ? next(state[at]) : next]; },
    useRef(initial) { const at = refIndex++; return refs[at] ?? (refs[at] = { current: initial }); }, useEffect(effect, deps) { const at = effectIndex++; if (!dependencies[at] || !deps || deps.some((item, i) => !Object.is(item, dependencies[at][i]))) effects.push(effect); dependencies[at] = deps; },
  } };
}
test("import review requires the user's explicit confirmation and keeps draft on rejection or back", async () => {
  const h = hooks(); let draft = { ...emptyAmountImport(), method: "text", text: "종목명,평가금액,통화\nVOO,123.45,USD" }, applied = 0;
  const [ui] = await importUiWithPorts(["src/components/first-visit/quick-amount-import.tsx"], { react: h.react, "@/components/i18n/locale-provider": i18n });
  const oldFrame = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 1;
  try {
    const render = () => { h.begin(); const tree = ui.QuickAmountImportPanel({ draft, onChange: next => draft = next, onConfirm: () => { applied++; return false; } }); h.flush(); return tree; };
    const button = label => walk(render()).find(node => node.type === "button" && text(node) === label);
    button("금액 읽어오기").props.onClick();
    assert.equal(applied, 0); assert.equal(draft.rows[0].value, "123.45");
    assert.match(text(render()), /빠진 자산은 직접 추가/);
    button("입력하던 자산으로 돌아가기").props.onClick();
    assert.equal(draft.method, "manual"); assert.equal(draft.rows[0].value, "123.45");
    button("텍스트").props.onClick();
    button("1개 금액 확인하고 사용").props.onClick();
    assert.equal(applied, 1); assert.equal(draft.method, "text"); assert.equal(draft.rows.length, 1);
  } finally { globalThis.requestAnimationFrame = oldFrame; }
});
test("missing currency prevents application and exposes an inline accessible error without dropping the amount", async () => {
  const h = hooks(); let draft = { method: "photo", text: "", rows: [{ key: "p", name: "VOO", value: "123.45", currency: "" }] }, applied = 0;
  const [ui] = await importUiWithPorts(["src/components/first-visit/quick-amount-import.tsx"], { react: h.react, "@/components/i18n/locale-provider": i18n });
  const oldFrame = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 1;
  try {
    const render = () => { h.begin(); const tree = ui.QuickAmountImportPanel({ draft, onChange: next => draft = next, onConfirm: () => { applied++; return true; } }); h.flush(); return tree; };
    const button = () => walk(render()).find(node => node.type === "button" && text(node) === "1개 금액 확인하고 사용");
    button().props.onClick(); assert.equal(applied, 0);
    let select = walk(render()).find(node => node.type === "select");
    assert.equal(select.props["aria-invalid"], true); assert.ok(select.props["aria-describedby"]);
    assert.equal(draft.rows[0].value, "123.45");
    select.props.onChange({ target: { value: "USD" } }); button().props.onClick();
    assert.equal(applied, 1); assert.equal(draft.method, "manual"); assert.equal(draft.rows.length, 0);
  } finally { globalThis.requestAnimationFrame = oldFrame; }
});
test("next investment action is present only for complete composition, not missing FX", async () => {
  const [ui] = await importUiWithPorts(["src/components/first-visit/quick-results.tsx"], { react: { useState: value => [value, () => {}] }, "@/components/i18n/locale-provider": i18n, "@/components/portfolio/portfolio-allocation-ring": { PortfolioAllocationRing: () => null } });
  const action = "NEXT_INVESTMENT", base = { version: 2, source: "manual", currency: "KRW", asOf: "2026-11-04T00:00:00Z", timeZone: "Asia/Seoul", locale: "ko", rows: [{ name: "A", value: 100, inputCurrency: "KRW", instrumentId: null }] };
  assert.ok(text(ui.QuickResults({ input: base, nextAction: action })).includes(action));
  assert.equal(text(ui.QuickResults({ input: { ...base, rows: [...base.rows, { name: "B", value: 10, inputCurrency: "USD", instrumentId: null }] }, nextAction: action })).includes(action), false);
});

test("unfinished input resumes and its fixed expiry is not extended by rendering; only a new edit renews it", async () => {
  const h = hooks();
  const [ui] = await importUiWithPorts(["src/components/first-visit/quick-portfolio.tsx"], { react: h.react, "@/components/i18n/locale-provider": i18n,
    "next/link": { default: () => null }, "@/lib/first-visit-events": { trackFirstVisit() {} },
    "@/components/first-visit/quick-amount-import": { QuickAmountImportPanel: () => null },
    "@/components/first-visit/portfolio-activation": { ContinueWithPortfolio: () => null },
    "@/components/first-visit/quick-results": { QuickResults: () => null, formatQuickTimestamp: value => value },
  });
  let now = Date.now(); const expiresAt = now + 1000, values = new Map(), frames = [], timers = [];
  values.set(QUICK_WORKSPACE_KEY, JSON.stringify({ version: 1, expiresAt, baseDraftId: null, rows: [{ key: "one", name: "VOO", value: "1234.", inputCurrency: "USD", instrumentId: null }], currency: "KRW", timeZone: "Asia/Seoul", fxRate: "", fxChanged: false, dirty: true, importing: emptyAmountImport() }));
  const saved = { storage: globalThis.localStorage, frame: globalThis.requestAnimationFrame, timer: globalThis.setTimeout, cancel: globalThis.clearTimeout, now: Date.now };
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  globalThis.setTimeout = callback => { timers.push(callback); return timers.length; }; globalThis.clearTimeout = () => {}; Date.now = () => now;
  try {
    const render = () => { h.begin(); const tree = ui.QuickPortfolio({}); h.flush(); return tree; };
    render(); frames.shift()();
    let tree = render(); assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "자산 1 이름").props.value, "VOO");
    assert.equal(JSON.parse(values.get(QUICK_WORKSPACE_KEY)).rows[0].value, "1234.");
    assert.equal(JSON.parse(values.get(QUICK_WORKSPACE_KEY)).expiresAt, expiresAt);
    now = expiresAt; timers.shift()(); render(); assert.equal(values.has(QUICK_WORKSPACE_KEY), false);
    tree = render(); walk(tree).find(node => node.props?.["aria-label"] === "자산 1 이름").props.onChange({ target: { value: "VOO revised" } }); render();
    const resumed = JSON.parse(values.get(QUICK_WORKSPACE_KEY));
    assert.equal(resumed.expiresAt, now + QUICK_WORKSPACE_TTL); assert.equal(resumed.rows[0].name, "VOO revised"); assert.equal(resumed.rows[0].value, "1234.");
  } finally { globalThis.localStorage = saved.storage; globalThis.requestAnimationFrame = saved.frame; globalThis.setTimeout = saved.timer; globalThis.clearTimeout = saved.cancel; Date.now = saved.now; }
});

test("storage failure stays visible outside the hidden manual form while importing a photo", async () => {
  const h = hooks(), ImportPanel = () => null;
  const [ui] = await importUiWithPorts(["src/components/first-visit/quick-portfolio.tsx"], { react: h.react, "@/components/i18n/locale-provider": i18n,
    "next/link": { default: () => null }, "@/lib/first-visit-events": { trackFirstVisit() {} },
    "@/components/first-visit/quick-amount-import": { QuickAmountImportPanel: ImportPanel },
    "@/components/first-visit/portfolio-activation": { ContinueWithPortfolio: () => null },
    "@/components/first-visit/quick-results": { QuickResults: () => null, formatQuickTimestamp: value => value },
  });
  const previousStorage = globalThis.localStorage, previousFrame = globalThis.requestAnimationFrame, frames = [];
  globalThis.localStorage = { getItem() { throw new Error("storage unavailable"); } };
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  try {
    const render = () => { h.begin(); return ui.QuickPortfolio({}); };
    render(); h.flush(); frames.shift()();
    let tree = render(); walk(tree).find(node => node.type === ImportPanel).props.onChange({ ...emptyAmountImport(), method: "photo" }); tree = render();
    const directWarning = tree.props.children.find(node => node?.type === "p" && node.props.role === "status");
    assert.match(text(directWarning), /임시 저장이 차단/);
    const hidden = walk(tree).find(node => node.props?.hidden === true);
    assert.ok(hidden); assert.doesNotMatch(text(hidden), /임시 저장이 차단/);
  } finally { globalThis.localStorage = previousStorage; globalThis.requestAnimationFrame = previousFrame; }
});
