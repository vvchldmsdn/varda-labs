import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "../src/lib/market-data/tenant-live-price-sync-policy.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { MANUAL_REFRESH_MAX_CHECKS } from "../src/lib/market-data/quote-refresh-progress.ts";
import { quoteRefreshPollDelay } from "../src/lib/market-data/quote-refresh-polling-policy.ts";
import { REFRESH_OPERATION_KEY } from "../src/lib/market-data/quote-refresh-operation.ts";

const WINDOW_MS = TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds;

describe("Today navigation refresh wiring", () => {
  it("exposes manual quote refresh on direct Today entry and labels view time honestly", async () => {
    const RefreshButton = () => null;
    const icons = Object.fromEntries(["ArrowUpRight", "ChartNoAxesCombined", "ChartPie", "ChevronLeft", "ChevronRight", "FlaskConical", "History", "House", "Menu", "Plus", "Settings2", "TrendingUp", "UserRound", "X"].map(name => [name, () => null]));
    let locale = "en", pathname = "/today", params = new URLSearchParams("scope=all");
    const [component] = await importUiWithPorts(["src/components/app-navigation.tsx"], {
      react: { useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, _snapshot, serverSnapshot) => serverSnapshot() },
      "next/image": { default: () => null },
      "next/link": { default: () => null, useLinkStatus: () => ({ pending: false }) },
      "next/navigation": { usePathname: () => pathname, useSearchParams: () => params },
      "lucide-react": icons,
      "@/components/i18n/locale-provider": { useI18n: () => ({ locale, t: (ko, en) => locale === "en" ? en ?? ko : ko }) },
      "@/components/i18n/language-switch": { LanguageSwitch: () => null },
      "@/components/reporting-currency-switch": { ReportingCurrencySwitch: () => null, REPORTING_ROUTES: ["/", "/today", "/history", "/simulation"] },
      "@/components/home/portfolio-refresh-button": { PortfolioRefreshButton: RefreshButton },
    });
    const elements = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
    const render = props => elements(component.AppNavigation({ generatedAt: "2026-09-10T03:37:00Z", ...props }));
    const today = render({});
    for(const activePath of ['/today','/history','/simulation','/']) {
      const button=render({activePath}).find(element=>element.type===RefreshButton);
      assert.ok(button); assert.equal(Object.hasOwn(button.props,'autoSync'),false);
    }
    assert.match(today.find(element => element.props?.className === "varda-updated-at").props.children, /^View refreshed /);
    locale = "ko";
    assert.match(render({}).find(element => element.props?.className === "varda-updated-at").props.children, /^화면 갱신 /);
    assert.equal(render({ generatedAt: undefined }).some(element => element.type === RefreshButton), false);
    pathname = "/portfolio/risk"; params = new URLSearchParams("scope=all&currency=USD");
    const risk = render({ activePath: "/portfolio/structure" });
    assert.ok(risk.some(element => element.props?.className === "varda-reporting-control" && JSON.stringify(element.props.children).includes("KRW")));
    assert.ok(risk.some(element => element.props?.href === "/plans?scope=all&currency=USD"));
  });
  it("connects native/KRW and USD surfaces using their actual read time while keeping fixtures and missing evidence inert",async()=>{
    const Navigation=()=>null;
    let params=new URLSearchParams();
    const [component]=await importUiWithPorts(["src/components/currency-portfolio-surface-client.tsx"],{
      "next/link":{default:()=>null},
      "next/navigation":{useSearchParams:()=>params},
      "@/components/app-navigation":{AppNavigation:Navigation},
      "@/components/recovered-return-chart":{RecoveredReturnChart:()=>null},
      "@/components/portfolio-analysis-scope-tabs":{PortfolioAnalysisScopeTabs:()=>null},
      "@/components/currency-tracked-view":{CurrencyTrackedView:()=>null},
      "@/components/currency-research-view":{CurrencyResearchView:()=>null},
      "@/components/recovery/recovery-notice":{RecoveryNotice:()=>null},
      "@/components/i18n/locale-provider":{useI18n:()=>({t:(ko)=>ko})},
    });
    const elements=tree=>!tree||typeof tree!=="object"?[]:Array.isArray(tree)?tree.flatMap(elements):[tree,...elements(tree.props?.children)];
    const evidence={asOf:"2026-10-29T02:59:00.000Z",reporting:"KRW",current:{at:"2026-10-29T02:59:00.000Z",source:"owned_native_asset_and_kis_quote"}};
    const props={evidence,scopes:[],selectedScope:{kind:"all",key:"all",label:"All"}};
    const navigation=overrides=>elements(component.CurrencyPortfolioSurfaceClient({...props,...overrides})).find(element=>element.type===Navigation).props;
    for(const currency of ["KRW","USD"]){
      for(const surface of ["home","today","history"]){
        const nav=navigation({surface,evidence:{...evidence,reporting:currency}});
        assert.equal(nav.generatedAt,evidence.asOf,"Read time is not replaced with a quote timestamp or the render clock");
        assert.equal(Object.hasOwn(nav,'autoSyncPrices'),false);
      }
    }
    assert.equal(navigation({surface:"structure"}).autoSyncPrices,undefined);
    assert.equal(navigation({surface:"today",evidence:undefined}).generatedAt,undefined);
    assert.equal(navigation({surface:"today",evidence:{...evidence,current:{...evidence.current,source:"synthetic_fixture"}}}).generatedAt,undefined);
    params=new URLSearchParams("preview=design");
    assert.equal(navigation({surface:"today"}).generatedAt,undefined);
  });
});

/** Runs the component's real effects and event callbacks with a deterministic browser I/O clock. */
async function refreshHarness(test, { visibility = "visible", storageFailure = null, autoRespond = true, responseState = "fresh" } = {}) {
  let now = Math.floor(Date.parse("2026-09-09T01:00:00Z") / WINDOW_MS) * WINDOW_MS + 1_000;
  let nextTimerId = 0;
  let refreshCount = 0;
  const effects = [];
  const timeouts = new Map();
  const intervals = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const storage = new Map();
  const requests = [];
  const states = [];
  const activeMounts = new Set();
  const listenerPort = registry => ({
    addEventListener(type, callback) {
      if (!registry.has(type)) registry.set(type, new Set());
      registry.get(type).add(callback);
    },
    removeEventListener(type, callback) { registry.get(type)?.delete(callback); },
  });
  const fakeDocument = { visibilityState: visibility, ...listenerPort(documentListeners) };
  const fakeStorage = {
    getItem(key) {
      if (storageFailure === "read") throw new Error("Storage access denied");
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageFailure === "write") throw new Error("Storage quota unavailable");
      storage.set(key, value);
    },
    removeItem(key) { storage.delete(key); },
  };
  const fakeWindow = {
    ...listenerPort(windowListeners),
    setTimeout(callback, delay) { const id = ++nextTimerId; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { const id = ++nextTimerId; intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  Object.defineProperty(fakeWindow, "sessionStorage", { get() {
    if (storageFailure === "access") throw new Error("Storage is unavailable in this browser");
    return fakeStorage;
  } });
  const descriptors = new Map(["window", "document", "fetch", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const response = (state, ok = true, status = ok ? 200 : 503) => ({ ok, status, json: async () => typeof state === 'string' ? { state } : state });
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => fakeWindow.sessionStorage });
  Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true, writable: true });
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: (url, options) => {
    const request = { url, options };
    requests.push(request);
    if (autoRespond) return Promise.resolve(response(responseState));
    return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
  } });
  test.mock.method(Date, "now", () => now);
  test.after(() => {
    for (const unmount of [...activeMounts]) unmount();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const router = { refresh: () => { refreshCount += 1; } };
  const [component, polling] = await importUiWithPorts([
    "src/components/home/portfolio-refresh-button.tsx",
    "src/components/use-market-collection-polling.ts",
  ], {
    react: {
      useCallback: callback => callback,
      useEffect: callback => { effects.push(callback); },
      useRef: initial => ({ current: initial }),
      useState: initial => [initial, value => { states.push(value); }],
      useTransition: () => [false, callback => callback()],
    },
    "next/navigation": { useRouter: () => router },
    "@/components/i18n/locale-provider": { useI18n: () => ({ t: (ko, en) => en ?? ko }) },
    "@/components/i18n/localized-text": { T: () => null },
    "@/components/home/home-history-messages": { translateHomeHistory: value => value },
    "lucide-react": { RefreshCw: () => null },
  });
  return {
    requests, storage, states, timeouts, intervals,
    get refreshCount() { return refreshCount; },
    get bucket() { return String(Math.floor(now / WINDOW_MS)); },
    mount(props = {}) {
      const effectStart = effects.length;
      const button = component.PortfolioRefreshButton(props);
      const cleanups = effects.slice(effectStart).map(effect => effect()).filter(cleanup => typeof cleanup === "function");
      let active = true;
      const unmount = () => { if (!active) return; active = false; cleanups.forEach(cleanup => cleanup()); activeMounts.delete(unmount); };
      activeMounts.add(unmount);
      return { click: () => button.props.children[0].props.onClick(), unmount };
    },
    mountPolling(keepCheckingHistory = false, startedAt, onProgress, operation) {
      const effectStart = effects.length;
      polling.useMarketCollectionPolling(true, undefined, keepCheckingHistory, startedAt, onProgress, operation);
      const cleanups = effects.slice(effectStart).map(effect => effect()).filter(cleanup => typeof cleanup === "function");
      let active = true;
      const unmount = () => { if (!active) return; active = false; cleanups.forEach(cleanup => cleanup()); activeMounts.delete(unmount); };
      activeMounts.add(unmount);
      return { unmount };
    },
    runMountTimer() { for (const [id, { callback, delay }] of [...timeouts]) { if (delay !== 0) continue; timeouts.delete(id); callback(); } },
    runInterval() { for (const { callback, delay } of [...intervals.values()]) { assert.equal(delay, WINDOW_MS); callback(); } },
    async runPollingInterval() { await Promise.all([...timeouts].map(([id,{callback,delay}])=>{assert.ok(delay>=2_000&&delay<=60_000);timeouts.delete(id);return callback();})); },
    advanceBucket() { now += WINDOW_MS; },
    advanceTime(ms) { now += ms; },
    get now() { return new Date(now).toISOString(); },
    setVisibility(value) { fakeDocument.visibilityState = value; },
    visibilityChange() { for (const callback of [...documentListeners.get("visibilitychange") ?? []]) callback(); },
    focus() { for (const callback of [...windowListeners.get("focus") ?? []]) callback(); },
    get listenerCount() { return [...documentListeners.values(), ...windowListeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
    respond(index, state = "fresh", ok = true, status = ok ? 200 : 503) { requests[index].resolve(response(state, ok, status)); },
    reject(index) { requests[index].reject(new Error("Network unavailable")); },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

const continuation = (startedAt, marker = "a") => ({ ownerBinding: marker.repeat(64), startedAt,
  targets: Array.from({ length: 8 }, (_, i) => ({ ticker: `Q${i}`, market: "us", currency: "USD" })), fxTicker: "Q0" });
const continuationReceipt = (operation, state = "queued", completed = 3) => ({ state, operation, startedAt: operation.startedAt,
  progress: { completed, total: 8, pending: 8 - completed, failed: 0, items: [] } });

describe("quote operation navigation restoration", () => {
  it("restores a captured operation only through an authorized poll and does not render stored financial data", async test => {
    const h = await refreshHarness(test, { autoRespond: false }), operation = continuation(h.now);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(operation));
    h.mount();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(JSON.parse(h.requests[0].options.body), { reason: "poll", startedAt: operation.startedAt, operation });
    assert.equal(h.states.some(value => value?.progress || value?.targets), false, "stored hints cannot paint before server validation");
    const receipt = continuationReceipt(operation);
    h.respond(0, receipt); await settle();
    assert.ok(h.states.includes(receipt)); assert.equal(h.states.at(-1), "queued");
    assert.ok(h.refreshCount > 0);
    assert.equal(h.requests.some(row => JSON.parse(row.options.body).reason === "manual"), false);
  });

  it("continues the same manual operation after unmounting and mounting the shared button again", async test => {
    const h = await refreshHarness(test, { autoRespond: false }), operation = continuation(h.now);
    const first = h.mount(); first.click();
    h.respond(0, continuationReceipt(operation)); await settle();
    assert.deepEqual(JSON.parse(h.storage.get(REFRESH_OPERATION_KEY)), operation);
    first.unmount(); h.mount();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(JSON.parse(h.requests[1].options.body), { reason: "poll", startedAt: operation.startedAt, operation });
    h.respond(1, continuationReceipt(operation, "fresh", 8)); await settle();
    assert.equal(h.states.at(-1), "fresh");
    assert.equal(h.requests.filter(row => JSON.parse(row.options.body).reason === "manual").length, 1);
  });

  it("ends a saved operation on changed owner or scope without exposing its receipt or starting a new collection", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(continuation(h.now)));
    h.mount(); h.respond(0, { state: "operation_scope_changed" }, false, 409); await settle();
    assert.equal(h.storage.has(REFRESH_OPERATION_KEY), false);
    assert.equal(h.states.some(value => value?.progress || value?.targets), false);
    assert.equal(h.states.at(-1), "waiting");
    assert.equal(h.requests.length, 1);
  });

  it("aborts a leaving screen's restore request and ignores its late receipt on the next screen", async test => {
    const h = await refreshHarness(test, { autoRespond: false }), oldOperation = continuation(h.now), oldReceipt = continuationReceipt(oldOperation);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(oldOperation));
    const first = h.mount(); first.unmount();
    assert.equal(h.requests[0].options.signal.aborted, true);
    h.storage.delete(REFRESH_OPERATION_KEY); h.mount();
    h.respond(0, oldReceipt); await settle();
    assert.equal(h.states.includes(oldReceipt), false);
    assert.equal(h.refreshCount, 0);
  });

  for (const rejected of [false, true]) it(`does not let a late ${rejected ? "rejected" : "successful"} restoration replace a newer manual operation`, async test => {
    const h = await refreshHarness(test, { autoRespond: false }), oldOperation = continuation(h.now);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(oldOperation));
    const screen = h.mount();
    h.advanceTime(1000); const newOperation = continuation(h.now), newReceipt = continuationReceipt(newOperation);
    screen.click(); assert.equal(h.requests.length, 2);
    h.respond(1, newReceipt); await settle();
    const stateCount = h.states.length, oldReceipt = continuationReceipt(oldOperation, "fresh", 8);
    h.respond(0, rejected ? { state: "operation_scope_changed" } : oldReceipt, !rejected, rejected ? 409 : 200); await settle();
    assert.equal(h.states.length, stateCount);
    assert.deepEqual(JSON.parse(h.storage.get(REFRESH_OPERATION_KEY)), newOperation);
    assert.equal(h.states.includes(oldReceipt), false);
  });

  for (const rejected of [false, true]) it(`ignores another mounted button's late ${rejected ? "rejected" : "successful"} restoration after a new manual operation`, async test => {
    const h = await refreshHarness(test, { autoRespond: false }), oldOperation = continuation(h.now);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(oldOperation));
    const first = h.mount(); h.mount();
    assert.equal(h.requests.length, 2);
    h.advanceTime(1000); const newOperation = continuation(h.now), newReceipt = continuationReceipt(newOperation);
    first.click(); h.respond(2, newReceipt); await settle();
    const stateCount = h.states.length, oldReceipt = continuationReceipt(oldOperation, "fresh", 8);
    h.respond(1, rejected ? { state: "operation_scope_changed" } : oldReceipt, !rejected, rejected ? 409 : 200); await settle();
    assert.deepEqual(JSON.parse(h.storage.get(REFRESH_OPERATION_KEY)), newOperation);
    assert.equal(h.states.length, stateCount, "the other button must ignore its obsolete restoration too");
    h.respond(0, oldReceipt); await settle();
    assert.equal(h.states.includes(oldReceipt), false);
  });

  it("does not erase a newer saved operation when an older poll is rejected", async test => {
    const h = await refreshHarness(test, { autoRespond: false }), oldOperation = continuation(h.now);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(oldOperation));
    const progress = [];
    h.mountPolling(false, oldOperation.startedAt, value => progress.push(value), oldOperation);
    const pending = h.runPollingInterval();
    h.advanceTime(1000); const newOperation = continuation(h.now);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(newOperation));
    h.respond(0, { state: "operation_scope_changed" }, false, 409); await pending;
    assert.deepEqual(JSON.parse(h.storage.get(REFRESH_OPERATION_KEY)), newOperation);
    assert.deepEqual(progress, [{ state: "operation_ended" }]);
    assert.equal(h.timeouts.size, 0);
  });

  it("never restores expired, corrupt, or preview hints automatically", async test => {
    const h = await refreshHarness(test);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(continuation(new Date(Date.parse(h.now) - 30 * 60_000 - 1).toISOString())));
    h.mount().unmount(); assert.equal(h.requests.length, 0);
    h.storage.set(REFRESH_OPERATION_KEY, "{"); h.mount().unmount(); assert.equal(h.requests.length, 0);
    h.storage.set(REFRESH_OPERATION_KEY, JSON.stringify(continuation(h.now)));
    h.mount({ designPreview: true }).unmount(); assert.equal(h.requests.length, 0);
  });

  for (const storageFailure of ["access", "read", "write"]) it(`keeps explicit refresh usable when browser storage fails at ${storageFailure}`, async test => {
    const h = await refreshHarness(test, { autoRespond: false, storageFailure });
    const screen = h.mount(); assert.equal(h.requests.length, 0);
    screen.click(); h.respond(0, continuationReceipt(continuation(h.now), "fresh", 8)); await settle();
    assert.equal(h.states.at(-1), "fresh"); assert.ok(h.refreshCount > 0);
  });
});

function rerenderHooks() {
  const cells = []; let cursor = 0;
  const same = (left, right) => left?.length === right?.length && left.every((value, index) => Object.is(value, right[index]));
  return {
    begin() { cursor = 0; },
    commit() { for (const cell of cells) if (cell.pending) { cell.cleanup?.(); cell.cleanup = cell.pending(); cell.pending = null; } },
    unmount() { for (const cell of cells) cell.cleanup?.(); },
    react: {
      useState(initial) { const at = cursor++; cells[at] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[at].value, next => { cells[at].value = typeof next === 'function' ? next(cells[at].value) : next; }]; },
      useRef(initial) { const at = cursor++; cells[at] ??= { current: initial }; return cells[at]; },
      useCallback(callback, deps) { const at = cursor++; if (!cells[at] || !same(cells[at].deps, deps)) cells[at] = { value: callback, deps }; return cells[at].value; },
      useEffect(callback, deps) { const at = cursor++; const cell = cells[at] ??= {}; if (!same(cell.deps, deps)) { cell.pending = callback; cell.deps = deps; } },
      useTransition: () => [false, callback => callback()],
    },
  };
}

it('a new queued operation never paints the previous completion before its effects or first poll', async test => {
  const hooks = rerenderHooks(), intervals = new Map(), responses = []; let timerId = 0;
  const start = '2026-11-03T01:00:00.000Z';
  const descriptors = new Map(['window', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout(callback) { const id = ++timerId; intervals.set(id, () => {intervals.delete(id);return callback();}); return id; }, clearTimeout(id) { intervals.delete(id); } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { assert.ok(responses.length); return { ok: true, json: async () => responses.shift() }; } });
  test.mock.method(Date, 'now', () => Date.parse(start));
  test.after(() => { hooks.unmount(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const router = { refresh() {} };
  const [component] = await importUiWithPorts(['src/components/home/portfolio-refresh-button.tsx'], {
    react: hooks.react,
    'next/navigation': { useRouter: () => router },
    '@/components/i18n/locale-provider': { useI18n: () => ({ t: (_ko, en) => en }) },
    '@/components/i18n/localized-text': { T: () => null },
    '@/components/home/home-history-messages': { translateHomeHistory: value => value },
    'lucide-react': { RefreshCw: () => null },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
  const render = () => { hooks.begin(); return component.PortfolioRefreshButton({}); };
  const progress = (state, completed, startedAt) => ({ state, startedAt, progress: { completed, total: 8, pending: 8 - completed, failed: 0, items: [] } });
  let tree = render(); hooks.commit();
  responses.push(progress('queued', 3, start)); tree.props.children[0].props.onClick(); await settle();
  tree = render(); hooks.commit();
  responses.push(progress('fresh', 8, start)); await Promise.all([...intervals.values()].map(callback => callback()));
  tree = render(); hooks.commit();
  assert.equal(tree.props.children[0].props.disabled, false);
  assert.match(text(nodes(tree).find(node => node.type === 'summary')), /8\/8 checked · complete/);
  // First retry deliberately reuses the same timestamp: generation alone must isolate it.
  for (const startedAt of [start, '2026-11-03T01:00:01.000Z']) {
    responses.push(progress('queued', 3, startedAt)); tree.props.children[0].props.onClick(); await settle();
    tree = render();
    assert.equal(tree.props.children[0].props.disabled, true, 'the first render of the new operation stays busy');
    assert.match(text(nodes(tree).find(node => node.type === 'summary')), /3\/8 checked · in progress/);
    assert.doesNotMatch(text(nodes(tree).find(node => node.type === 'summary')), /complete/);
    hooks.commit();
    responses.push(progress('fresh', 8, startedAt)); await Promise.all([...intervals.values()].map(callback => callback()));
    tree = render(); hooks.commit();
    assert.equal(tree.props.children[0].props.disabled, false);
  }
});

for (const initialState of ['fresh', 'partial']) it(`a ${initialState} receipt follows later pending items without claiming completion or reopening a timed-out window`, async test => {
  const hooks = rerenderHooks(), timers = new Map(), responses = []; let timerId = 0;
  const start = '2026-11-03T01:00:00.000Z'; let now = Date.parse(start);
  const descriptors = new Map(['window', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout(callback) { const id = ++timerId; timers.set(id, () => { timers.delete(id); return callback(); }); return id; }, clearTimeout(id) { timers.delete(id); } } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible' } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { assert.ok(responses.length); return { ok: true, json: async () => responses.shift() }; } });
  test.mock.method(Date, 'now', () => now);
  test.after(() => { hooks.unmount(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const router = { refresh() {} };
  const [component] = await importUiWithPorts(['src/components/home/portfolio-refresh-button.tsx'], {
    react: hooks.react, 'next/navigation': { useRouter: () => router },
    '@/components/i18n/locale-provider': { useI18n: () => ({ t: (_ko, en) => en }) },
    '@/components/i18n/localized-text': { T: () => null },
    '@/components/home/home-history-messages': { translateHomeHistory: value => value }, 'lucide-react': { RefreshCw: () => null },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
  const render = () => { hooks.begin(); const tree = component.PortfolioRefreshButton({}); hooks.commit(); return tree; };
  const receipt = (state, completed, pending, failed = 0, comparisonPending = 1) => ({ state, startedAt: start, progress: { completed, total: 8, pending, failed, items: [] }, comparison: { pending: comparisonPending, failed: 1 } });
  const summary = tree => text(nodes(tree).find(node => node.type === 'summary'));
  const tick = async response => { if (response) responses.push(response); await Promise.all([...timers.values()].map(callback => callback())); return render(); };
  let tree = render();
  responses.push(receipt(initialState, initialState === 'fresh' ? 8 : 7, 0, initialState === 'fresh' ? 0 : 1));
  tree.props.children[0].props.onClick(); await settle(); tree = render();
  assert.match(summary(tree), initialState === 'fresh' ? /8\/8 checked · complete/ : /7\/8 checked · incomplete/);
  tree = await tick(receipt('queued', 3, 5, 0, 0));
  assert.match(summary(tree), /3\/8 checked · in progress/); assert.doesNotMatch(summary(tree), /complete/);
  assert.equal(tree.props.children[0].props.disabled, true);
  assert.equal(timers.size, 1, 'unfinished quotes keep polling even after comparison work ends');
  tree = await tick(receipt('partial', 6, 0, 2));
  assert.match(summary(tree), /6\/8 checked · incomplete/); assert.equal(tree.props.children[0].props.disabled, false);
  tree = await tick(receipt('fresh', 8, 0));
  assert.match(summary(tree), /8\/8 checked · complete/);
  assert.match(text(tree), /Comparison prices for today's change are awaiting verification/);
  assert.match(text(tree), /Some comparison prices could not be checked/);
  tree = await tick(receipt('queued', 3, 5, 0, 0)); assert.match(summary(tree), /in progress/);
  now += 30 * 60_000 + 1; tree = await tick();
  assert.match(summary(tree), /3\/8 checked · paused/); assert.doesNotMatch(summary(tree), /in progress|complete/);
  assert.equal(tree.props.children[0].props.disabled, false); assert.equal(timers.size, 0);
  render(); assert.equal(timers.size, 0, 'pending receipt does not restart a stopped polling window');
});

describe("portfolio refresh lifecycle", () => {
  it("never starts collection on mount, time passing, focus, visibility or a route return", async test => {
    const h=await refreshHarness(test);const first=h.mount();
    h.runMountTimer();h.advanceBucket();h.runInterval();h.focus();h.visibilityChange();await settle();
    first.unmount();h.mount();h.runMountTimer();await settle();
    assert.equal(h.requests.length,0);assert.equal(h.refreshCount,0);
    assert.equal(h.timeouts.size,0);assert.equal(h.intervals.size,0);assert.equal(h.listenerCount,0);
  });
  it("deduplicates overlapping manual clicks and permits the next explicit refresh", async test => {
    const h=await refreshHarness(test,{autoRespond:false});const first=h.mount(),second=h.mount();
    first.click();second.click();first.click();assert.equal(h.requests.length,1);
    const request=h.requests[0];assert.deepEqual(JSON.parse(request.options.body),{reason:'manual'});
    assert.equal(request.url,'/api/portfolio/live-prices/sync');assert.ok(request.options.signal instanceof AbortSignal);
    h.respond(0,'fresh');await settle();assert.ok(h.refreshCount>0);
    first.click();assert.equal(h.requests.length,2);h.respond(1,'queued');await settle();
    assert.equal(h.states.at(-1),'queued');
  });

  it("keeps a shared manual request for a remaining button and ignores the departed button's result", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    const first = h.mount(), second = h.mount();
    first.click(); second.click(); first.unmount();
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].options.signal.aborted, false);
    h.respond(0, 'fresh'); await settle();
    assert.equal(h.refreshCount, 1);
  });

  it("detaches the last button's request before a new screen can receive a previous owner's holdings", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    const first = h.mount(), second = h.mount();
    first.click(); second.click(); first.unmount(); second.unmount();
    assert.equal(h.requests[0].options.signal.aborted, true);
    const next = h.mount(); next.click();
    assert.equal(h.requests.length, 2);
    const beforeLateResponse = h.states.length;
    h.respond(0, { state: 'fresh', progress: { items: [{ label: 'OWNER_A_PRIVATE_HOLDING' }] } });
    await settle();
    assert.equal(h.states.length, beforeLateResponse, 'unmounted request callbacks cannot update state');
    assert.equal(h.refreshCount, 0);
    const companion = h.mount(); companion.click();
    assert.equal(h.requests.length, 2, 'the previous finally cannot erase the new shared request');
    h.respond(1, { state: 'fresh', progress: { items: [{ label: 'OWNER_B_HOLDING' }] } });
    await settle();
    assert.equal(h.states.some(value => JSON.stringify(value)?.includes('OWNER_A_PRIVATE_HOLDING')), false);
    assert.equal(h.states.some(value => JSON.stringify(value)?.includes('OWNER_B_HOLDING')), true);
  });

  for (const state of ["synced", "partial", "fresh", "empty", "cooldown"]) {
    it(`refreshes Server Components when the sync endpoint returns ${state}`, async test => {
      const h = await refreshHarness(test, { responseState: state });
      const button = h.mount();
      button.click();
      await settle();
      assert.equal(h.refreshCount, 1);
      assert.notEqual(h.states.at(-1), "error");
    });
  }

  it("releases failed in-flight requests so a manual retry can succeed", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    const button = h.mount();
    button.click(); h.reject(0);
    await settle();
    assert.equal(h.states.at(-1), "error");
    assert.equal(h.refreshCount, 0);
    button.click();
    assert.equal(h.requests.length, 2);
    h.respond(1, "fresh");
    await settle();
    assert.equal(h.refreshCount, 1);
  });

  it("does not start timers in design preview, and preview click refreshes without POST", async test => {
    const h = await refreshHarness(test);
    h.mount();
    const preview = h.mount({ designPreview: true });
    assert.equal(h.timeouts.size, 0);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.listenerCount, 0);
    preview.click();
    await settle();
    assert.equal(h.requests.length, 0);
    assert.equal(h.refreshCount, 1);
  });
});

describe("market collection quote and history polling", () => {
  it("honors delayed-only retries and server wait hints without slowing other active instruments",()=>{
    const now=Date.now(),delayed={state:'delayed',retryAt:new Date(now+120_000).toISOString()};
    assert.equal(quoteRefreshPollDelay({progress:{items:[delayed]}},0,now),30_000);
    assert.equal(quoteRefreshPollDelay({progress:{items:[delayed,{state:'running'}]}},0,now),2_000);
    assert.equal(quoteRefreshPollDelay({retryAfterSeconds:15},0,now),15_000);
    assert.equal(quoteRefreshPollDelay(undefined),10_000);
  });
  it("shows completed quotes while separately following comparison evidence, then stops all polling",async test=>{
    const h=await refreshHarness(test,{autoRespond:false});h.mountPolling(false,h.now);
    for(const [index,pending] of [2,1,0].entries()) {
      const tick=h.runPollingInterval();h.respond(index,{state:'fresh',readVersion:`prices-close-${index}`,comparison:{pending,failed:0}});await tick;
      assert.equal(h.states.at(-1).state,'fresh');
      if(pending)assert.equal([...h.timeouts.values()][0].delay,10_000);
    }
    assert.equal(h.refreshCount,3);assert.equal(h.timeouts.size,0);
  });
  it("retains completed quotes across a failed comparison check and timeout while reporting connection trouble",async test=>{
    const h=await refreshHarness(test,{autoRespond:false}),receipts=[];h.mountPolling(false,h.now,data=>receipts.push(data));
    let tick=h.runPollingInterval();h.respond(0,{state:'fresh',readVersion:'quotes-done',comparison:{pending:1,failed:0}});await tick;
    tick=h.runPollingInterval();h.reject(1);await tick;
    assert.equal(h.states.at(-1).state,'fresh');assert.equal(receipts.at(-1).connectionUnavailable,true);
    tick=h.runPollingInterval();h.respond(2,{state:'fresh',readVersion:'quotes-done',comparison:{pending:1,failed:0}});await tick;
    assert.equal(receipts.at(-1).connectionUnavailable,undefined);
    tick=h.runPollingInterval();h.respond(3,{state:'service_unavailable'},false);await tick;
    assert.equal(h.states.at(-1).state,'fresh');assert.equal(receipts.at(-1).connectionUnavailable,true);
    h.advanceTime(30*60_000+1);await h.runPollingInterval();
    assert.equal(h.states.at(-1).state,'fresh');assert.equal(h.timeouts.size,0);assert.equal(h.refreshCount,1);
  });
  for (const useStartedAt of [false, true]) it(`detaches ${useStartedAt ? 'operation' : 'history'} polling after its last subscriber and ignores old receipts`, async test => {
    const h = await refreshHarness(test, { autoRespond: false }), receipts = [];
    const startedAt = useStartedAt ? h.now : undefined;
    const first = h.mountPolling(false, startedAt, value => receipts.push(['old', value]));
    const second = h.mountPolling(false, startedAt, value => receipts.push(['old', value]));
    h.runMountTimer();
    const oldTick = h.runPollingInterval();
    assert.equal(h.requests.length, 1, 'simultaneous mounted subscribers share one poll');
    first.unmount(); assert.equal(h.requests[0].options.signal.aborted, false);
    second.unmount(); assert.equal(h.requests[0].options.signal.aborted, true);
    h.mountPolling(false, startedAt, value => receipts.push(['new', value])); h.runMountTimer();
    const nextTick = h.runPollingInterval();
    assert.equal(h.requests.length, 2);
    h.respond(0, { state: 'fresh', progress: { items: [{ label: 'OWNER_A_PRIVATE_HOLDING' }] } });
    await oldTick;
    assert.deepEqual(receipts, []);
    assert.equal(h.refreshCount, 0);
    h.mountPolling(false, startedAt, value => receipts.push(['new', value])); h.runMountTimer();
    const companionTick = h.runPollingInterval();
    assert.equal(h.requests.length, 2, 'the old finally cannot erase the new poll');
    h.respond(1, { state: 'fresh', progress: { items: [{ label: 'OWNER_B_HOLDING' }] } });
    await Promise.all([nextTick, companionTick]);
    assert.equal(receipts.length, 2);
    assert.ok(receipts.every(([screen, value]) => screen === 'new' && value.progress.items[0].label === 'OWNER_B_HOLDING'));
  });

  it("continues a manually started queue beyond two minutes without another manual admission", async test => {
    const h=await refreshHarness(test,{autoRespond:false}); h.mountPolling(false,h.now);h.runMountTimer();
    for(let index=0;index<15;index++) {const tick=h.runPollingInterval();h.respond(index,{state:index===14?'fresh':'queued',readVersion:String(index)});await tick;}
    assert.equal(h.requests.length,15);assert.equal(h.states.at(-1).state,'fresh');assert.equal(h.intervals.size,0);
    assert.ok(h.requests.every(row=>{const body=JSON.parse(row.options.body);return body.reason==='poll'&&body.startedAt===h.now;}));
  });
  it("pauses invisible work and reports a bounded incomplete timeout rather than completion",async test=>{
    const h=await refreshHarness(test,{responseState:'queued'});h.mountPolling(false,h.now);h.runMountTimer();
    h.setVisibility('hidden');await h.runPollingInterval();assert.equal(h.requests.length,0);h.setVisibility('visible');
    for(let count=0;count<MANUAL_REFRESH_MAX_CHECKS;count++)await h.runPollingInterval();
    assert.equal(h.requests.length,MANUAL_REFRESH_MAX_CHECKS);assert.equal(h.states.at(-1).state,'waiting');assert.equal(h.timeouts.size,0);
  });
  it("checks new manual work after two seconds, backs off unchanged receipts, and refreshes only changed evidence",async test=>{
    const h=await refreshHarness(test,{autoRespond:false});h.mountPolling(false,h.now);
    assert.equal([...h.timeouts.values()][0].delay,2_000);
    for(let index=0;index<13;index++) {
      const tick=h.runPollingInterval();
      h.respond(index,{state:'queued',readVersion:'same-price',freshTargetCount:index===1?1:2,targetCount:8});await tick;
    }
    assert.equal(h.refreshCount,1,'job status and count changes alone do not reload the whole page');
    assert.equal([...h.timeouts.values()][0].delay,10_000);
    const tick=h.runPollingInterval();h.respond(13,{state:'queued',readVersion:'new-fx'});await tick;
    assert.equal(h.refreshCount,2);assert.equal([...h.timeouts.values()][0].delay,2_000);
    h.advanceTime(30*60_000+1);await h.runPollingInterval();
    assert.equal(h.requests.length,14);assert.equal(h.states.at(-1).state,'waiting');assert.equal(h.timeouts.size,0);
  });
  it("refreshes changed prices and FX even when ready instrument counts stay the same", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    h.mountPolling(); h.runMountTimer();
    for (const [index, readVersion] of ['quote-1-fx-1', 'quote-2-fx-1', 'quote-2-fx-2', 'quote-2-fx-2'].entries()) {
      const tick = h.runPollingInterval();
      h.respond(index, {state:'queued', freshTargetCount:1, targetCount:2, readVersion});
      await tick;
    }
    assert.equal(h.refreshCount, 3, 'Changed evidence must reach the page; identical evidence must not refresh it repeatedly');
  });
  it("keeps fresh quotes fresh at timeout while still refreshing pending history", async test => {
    const h = await refreshHarness(test, { responseState: "fresh" });
    h.mountPolling(true);
    h.runMountTimer();
    for (let check = 0; check < 12; check++) await h.runPollingInterval();
    assert.equal(h.requests.length, 12);
    assert.equal(h.states.at(-1).state, "fresh", "history polling cannot turn confirmed fresh quotes into waiting quotes");
    assert.equal(h.refreshCount, 5, "pending history still receives its periodic and final Server Component refreshes");
    assert.equal(h.intervals.size, 0, "history polling remains bounded");
    assert.deepEqual(JSON.parse(h.requests[0].options.body), { reason: "poll" });
  });

  it("does not refresh unchanged fresh quotes on every poll when history checking is disabled", async test => {
    const h = await refreshHarness(test, { responseState: "fresh" });
    h.mountPolling();
    h.runMountTimer();
    for (let check = 0; check < 12; check++) await h.runPollingInterval();
    assert.equal(h.states.at(-1).state, "fresh");
    assert.equal(h.refreshCount, 1);
    assert.equal(h.intervals.size, 0);
  });

  for (const terminal of ["partial", "empty"]) it("keeps final completion result " + terminal, async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    h.mountPolling(); h.runMountTimer();
    for (let index = 0; index < 12; index++) {
      const tick = h.runPollingInterval();
      h.respond(index, {state:index === 11 ? terminal : "queued", readVersion:String(index)});
      await tick;
    }
    assert.equal(h.states.at(-1).state, terminal);
    assert.equal(h.intervals.size, 0);
  });

  it("retains waiting at timeout when the quote endpoint has not confirmed freshness", async test => {
    const h = await refreshHarness(test, { responseState: "queued" });
    h.mountPolling(true);
    h.runMountTimer();
    for (let check = 0; check < 11; check++) await h.runPollingInterval();
    assert.equal(h.states.at(-1).state, "queued");
    await h.runPollingInterval();
    assert.equal(h.states.at(-1).state, "waiting");
    assert.equal(h.refreshCount, 5);
    assert.equal(h.intervals.size, 0);
  });
});
