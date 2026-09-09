import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TENANT_LIVE_PRICE_SYNC_POLICY } from "../src/lib/market-data/tenant-live-price-sync-policy.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const WINDOW_MS = TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds;
const STORAGE_KEY = "varda:live-price-sync:last-bucket";

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
  const response = (state, ok = true) => ({ ok, json: async () => ({ state }) });
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
  const [component] = await importUiWithPorts(["src/components/home/portfolio-refresh-button.tsx"], {
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
    mount(props = { autoSync: true }) {
      const effectStart = effects.length;
      const button = component.PortfolioRefreshButton(props);
      const cleanups = effects.slice(effectStart).map(effect => effect()).filter(cleanup => typeof cleanup === "function");
      let active = true;
      const unmount = () => { if (!active) return; active = false; cleanups.forEach(cleanup => cleanup()); activeMounts.delete(unmount); };
      activeMounts.add(unmount);
      return { click: () => button.props.onClick(), unmount };
    },
    runMountTimer() { for (const [id, { callback, delay }] of [...timeouts]) { assert.equal(delay, 0); timeouts.delete(id); callback(); } },
    runInterval() { for (const { callback, delay } of [...intervals.values()]) { assert.equal(delay, WINDOW_MS); callback(); } },
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
  it("checks once on visible mount and once per later bucket without growing storage", async test => {
    const h = await refreshHarness(test);
    const first = h.mount();
    assert.equal(h.requests.length, 0);
    h.runMountTimer();
    await settle();
    assert.equal(h.requests.length, 1);
    assert.deepEqual({ ...h.requests[0].options, body: JSON.parse(h.requests[0].options.body) }, {
      method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: { reason: "page_view" },
    });
    assert.equal(h.requests[0].url, "/api/portfolio/live-prices/sync");
    assert.equal(h.storage.get(STORAGE_KEY), h.bucket);
    h.focus(); h.visibilityChange(); h.runInterval();
    await settle();
    assert.equal(h.requests.length, 1);
    first.unmount();
    h.mount(); h.runMountTimer();
    await settle();
    assert.equal(h.requests.length, 1, "a route remount in the same tab and bucket must not send another automatic request");
    h.advanceBucket(); h.runInterval();
    await settle();
    assert.equal(h.requests.length, 2);
    assert.equal(h.storage.size, 1);
    assert.equal(h.storage.get(STORAGE_KEY), h.bucket);
  });

  it("skips hidden checks without consuming the bucket and catches up once on return or focus", async test => {
    const h = await refreshHarness(test, { visibility: "hidden" });
    h.mount(); h.runMountTimer(); h.runInterval(); h.focus();
    await settle();
    assert.equal(h.requests.length, 0);
    assert.equal(h.storage.size, 0);
    h.advanceBucket(); h.runInterval();
    h.setVisibility("visible"); h.visibilityChange(); h.focus();
    await settle();
    assert.equal(h.requests.length, 1);
    h.setVisibility("hidden"); h.advanceBucket(); h.runInterval();
    h.setVisibility("visible"); h.focus(); h.visibilityChange();
    await settle();
    assert.equal(h.requests.length, 2);
  });

  it("shares an in-flight request across automatic and manual callers and releases it after completion", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    h.mount(); h.runMountTimer();
    const manual = h.mount({ autoSync: false });
    manual.click(); manual.click();
    assert.equal(h.requests.length, 1);
    h.respond(0, "fresh");
    await settle();
    assert.ok(h.refreshCount > 0, "fresh server cache must still reach the displayed Server Components");
    manual.click();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(JSON.parse(h.requests[1].options.body), { reason: "manual" });
    h.respond(1, "synced");
    await settle();
  });

  it("removes the initial timer, repeating timer and both listeners on unmount", async test => {
    const h = await refreshHarness(test);
    const button = h.mount();
    assert.equal(h.timeouts.size, 1);
    assert.equal(h.intervals.size, 1);
    assert.equal(h.listenerCount, 2);
    button.unmount();
    assert.equal(h.timeouts.size, 0);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.listenerCount, 0);
    h.advanceBucket(); h.runMountTimer(); h.runInterval(); h.focus(); h.visibilityChange();
    await settle();
    assert.equal(h.requests.length, 0);
  });

  for (const storageFailure of ["access", "read", "write"]) {
    it(`continues one check per local bucket when session storage ${storageFailure} fails`, async test => {
      const h = await refreshHarness(test, { storageFailure });
      h.mount();
      assert.doesNotThrow(() => h.runMountTimer());
      await settle();
      assert.equal(h.requests.length, 1);
      assert.doesNotThrow(() => { h.focus(); h.visibilityChange(); h.runInterval(); });
      await settle();
      assert.equal(h.requests.length, 1);
      h.advanceBucket();
      assert.doesNotThrow(() => h.focus());
      await settle();
      assert.equal(h.requests.length, 2);
    });
  }

  for (const state of ["synced", "partial", "fresh", "cooldown"]) {
    it(`refreshes Server Components when the sync endpoint returns ${state}`, async test => {
      const h = await refreshHarness(test, { responseState: state });
      const button = h.mount({ autoSync: false });
      button.click();
      await settle();
      assert.equal(h.refreshCount, 1);
      assert.notEqual(h.states.at(-1), "error");
    });
  }

  it("releases failed in-flight requests so a manual retry can succeed", async test => {
    const h = await refreshHarness(test, { autoRespond: false });
    const button = h.mount({ autoSync: false });
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

  it("does not start automatic timers when disabled or in design preview, and preview click refreshes without POST", async test => {
    const h = await refreshHarness(test);
    h.mount({ autoSync: false });
    const preview = h.mount({ autoSync: true, designPreview: true });
    assert.equal(h.timeouts.size, 0);
    assert.equal(h.intervals.size, 0);
    assert.equal(h.listenerCount, 0);
    preview.click();
    await settle();
    assert.equal(h.requests.length, 0);
    assert.equal(h.refreshCount, 1);
  });
});
