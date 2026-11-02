import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "../src/lib/market-data/tenant-live-price-sync-policy.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

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
  const descriptors = new Map(["window", "document", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const response = (state, ok = true) => ({ ok, json: async () => typeof state === 'string' ? { state } : state });
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
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
      return { click: () => button.props.onClick(), unmount };
    },
    mountPolling(keepCheckingHistory = false) {
      const effectStart = effects.length;
      polling.useMarketCollectionPolling(true, undefined, keepCheckingHistory);
      const cleanups = effects.slice(effectStart).map(effect => effect()).filter(cleanup => typeof cleanup === "function");
      let active = true;
      const unmount = () => { if (!active) return; active = false; cleanups.forEach(cleanup => cleanup()); activeMounts.delete(unmount); };
      activeMounts.add(unmount);
      return { unmount };
    },
    runMountTimer() { for (const [id, { callback, delay }] of [...timeouts]) { assert.equal(delay, 0); timeouts.delete(id); callback(); } },
    runInterval() { for (const { callback, delay } of [...intervals.values()]) { assert.equal(delay, WINDOW_MS); callback(); } },
    async runPollingInterval() { for (const { callback, delay } of [...intervals.values()]) { assert.equal(delay, 10_000); await callback(); } },
    advanceBucket() { now += WINDOW_MS; },
    setVisibility(value) { fakeDocument.visibilityState = value; },
    visibilityChange() { for (const callback of [...documentListeners.get("visibilitychange") ?? []]) callback(); },
    focus() { for (const callback of [...windowListeners.get("focus") ?? []]) callback(); },
    get listenerCount() { return [...documentListeners.values(), ...windowListeners.values()].reduce((sum, entries) => sum + entries.size, 0); },
    respond(index, state = "fresh", ok = true) { requests[index].resolve(response(state, ok)); },
    reject(index) { requests[index].reject(new Error("Network unavailable")); },
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

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
    assert.equal(h.states.at(-1), "fresh", "history polling cannot turn confirmed fresh quotes into waiting quotes");
    assert.equal(h.refreshCount, 5, "pending history still receives its periodic and final Server Component refreshes");
    assert.equal(h.intervals.size, 0, "history polling remains bounded");
    assert.deepEqual(JSON.parse(h.requests[0].options.body), { reason: "poll" });
  });

  it("does not refresh unchanged fresh quotes on every poll when history checking is disabled", async test => {
    const h = await refreshHarness(test, { responseState: "fresh" });
    h.mountPolling();
    h.runMountTimer();
    for (let check = 0; check < 12; check++) await h.runPollingInterval();
    assert.equal(h.states.at(-1), "fresh");
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
    assert.equal(h.states.at(-1), terminal);
    assert.equal(h.intervals.size, 0);
  });

  it("retains waiting at timeout when the quote endpoint has not confirmed freshness", async test => {
    const h = await refreshHarness(test, { responseState: "queued" });
    h.mountPolling(true);
    h.runMountTimer();
    for (let check = 0; check < 11; check++) await h.runPollingInterval();
    assert.equal(h.states.at(-1), "queued");
    await h.runPollingInterval();
    assert.equal(h.states.at(-1), "waiting");
    assert.equal(h.refreshCount, 5);
    assert.equal(h.intervals.size, 0);
  });
});
