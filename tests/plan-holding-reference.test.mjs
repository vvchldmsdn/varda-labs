import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { PLAN_STORAGE_KEY } from "../src/lib/investment-plan.ts";

describe("plan to holding handoff", () => {
  it("reads only a valid expiring draft and passes only its name on an explicit click", async () => {
    let raw = JSON.stringify({ version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: Date.now() + 60000,
      input: { currency: "KRW", amount: 1000, rows: [{ name: "My ETF", value: 5000, targetBps: 10000 }] } });
    const storage = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => { assert.equal(key, PLAN_STORAGE_KEY); return raw; } };
    try {
      const [reference] = await importUiWithPorts(["src/components/onboarding/plan-holding-reference.tsx"], {
        react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
        "next/link": { default: () => null },
        "@/components/i18n/locale-provider": { useI18n: () => ({ t: ko => ko }) },
      });
      const searches = [];
      const tree = reference.PlanHoldingReference({ disabled: false, onSearch: name => searches.push(name) });
      const walk = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
      const button = walk(tree).find(node => node.type === "button");
      assert.deepEqual(searches, []);
      button.props.onClick();
      assert.deepEqual(searches, ["My ETF"]);
      assert.equal(walk(tree).some(node => node.type === "input"), false);
      raw = "malformed";
      assert.equal(walk(reference.PlanHoldingReference({ disabled: false, onSearch() {} })).some(node => node.type === "button"), false);
      raw = JSON.stringify({ version: 1, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expiresAt: Date.now() - 1,
        input: { currency: "KRW", amount: 1000, rows: [{ name: "Expired", value: 5000, targetBps: 10000 }] } });
      assert.equal(walk(reference.PlanHoldingReference({ disabled: false, onSearch() {} })).some(node => node.type === "button"), false);
    } finally { globalThis.localStorage = storage; }
  });

  it("sends plan search names in a bounded authenticated POST, retaining the GET contract", async () => {
    let authenticated = true;
    const searches = [];
    const [route] = await importUiWithPorts(["src/app/api/instruments/search/route.ts"], {
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => authenticated ? { ok: true, tenantContext: { ownerUserId: "fixture" } } : { ok: false, failure: { httpStatus: 401 } } },
      "@/db/queries/onboarding-instrument-search": { searchOnboardingInstruments: async q => { searches.push(q); return []; } },
    });
    const request = (body, extra = {}) => new Request("https://varda.test/api/instruments/search", { method: "POST", headers: { Origin: "https://varda.test", "Content-Type": "application/json", ...extra }, body });
    const ok = await route.POST(request(JSON.stringify({ q: "My ETF" })));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(searches, ["My ETF"]);
    for (const body of ["{", JSON.stringify({ q: "x", amount: 1000 }), JSON.stringify({ q: "x".repeat(81) }), JSON.stringify({ q: "x".repeat(5000) })]) assert.equal((await route.POST(request(body))).status, 400);
    assert.equal((await route.POST(request('{"q":"private"}', { Origin: "https://other.test" }))).status, 403);
    authenticated = false;
    assert.equal((await route.POST(request('{"q":"private"}'))).status, 401);
    assert.deepEqual(searches, ["My ETF"]);
    authenticated = true;
    assert.equal((await route.GET(new Request("https://varda.test/api/instruments/search?q=OTHER"))).status, 200);
    assert.deepEqual(searches, ["My ETF", "OTHER"]);
  });

  it("emits first holding completion only from confirmed writer success and never from preview", async () => {
    let submit;
    let result = { status: "complete", results: [{ key: "row", result: { status: "success", assetId: "saved-id", firstHoldingCreated: true } }] };
    const events = [];
    const [form] = await importUiWithPorts(["src/components/holding-onboarding-form.tsx"], {
      react: { useState: initial => [initial, () => {}], useActionState: (fn, initial) => { submit = fn; return [initial, () => {}, false]; } },
      "next/link": { default: () => null },
      "@/components/use-market-collection-polling": { useMarketCollectionPolling: () => null },
      "@/app/portfolio/holdings/new/actions": { createHoldingBatch: async () => result },
      "@/components/i18n/locale-provider": { useI18n: () => ({ t: ko => ko }) },
      "@/components/i18n/management-text": { ManagementText: () => null },
      "@/components/onboarding/instrument-search": { InstrumentSearch: () => null },
      "@/components/onboarding/holding-import-panel": { HoldingImportPanel: () => null },
      "@/components/onboarding/plan-holding-reference": { PlanHoldingReference: () => null },
      "@/lib/first-visit-events": { trackFirstVisit: (...args) => events.push(args) },
    });
    const options = { accounts: [{ id: "fixture", name: "Fixture" }], portfolioGroups: [] };
    const data = new FormData(); data.set("holdings", "[]");
    form.HoldingOnboardingForm({ options });
    await submit({}, data);
    assert.deepEqual(events, [["first_holding_created", "saved-id"]]);
    result = { status: "partial", results: [{ key: "row", result: { status: "error", firstHoldingCreated: true, assetId: "error" } }] };
    await submit({}, data);
    result = { status: "complete", results: [{ key: "row", result: { status: "success", assetId: "second" } }] };
    await submit({}, data);
    form.HoldingOnboardingForm({ options, preview: true });
    result.results[0].result.firstHoldingCreated = true;
    await submit({}, data);
    assert.equal(events.length, 1);
  });
});
