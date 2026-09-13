import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { ACTIVATION_STORAGE_KEY, activationIntent, bindCurrentActivationIntent, parseActivationIntent } from "../src/lib/portfolio-activation.ts";
import { QUICK_STORAGE_KEY } from "../src/lib/quick-portfolio.ts";
import { planReturnDestination } from "../src/lib/auth/plan-return.ts";

const input = { currency: "KRW", rows: [{ name: "Personal A", value: 3000000, instrumentId: null }, { name: "VOO", value: 2000000, instrumentId: "us-voo" }] };
const draft = () => ({ version: 1, id: "11111111-1111-4111-8111-111111111111", expiresAt: Date.now() + 100000, input });
const request = (method, body, headers = {}, suffix = "") => new Request("https://local.test/api/portfolio-activation" + suffix, { method, headers: { origin: "https://local.test", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("explicit personal activation intent", () => {
  it("does not overwrite newer input or revive cancellation after asynchronous identity lookup", () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const first = draft();
    const expected = { draft: first, intent: activationIntent(first) };
    const store = value => { storage.setItem(QUICK_STORAGE_KEY, JSON.stringify(value)); storage.setItem(ACTIVATION_STORAGE_KEY, JSON.stringify(activationIntent(value))); };
    store(first);
    // Tab A is awaiting GET when tab B explicitly starts a different save.
    const latest = { ...draft(), id: "22222222-2222-4222-8222-222222222222" };
    store(latest);
    const untouched = [...values];
    assert.equal(bindCurrentActivationIntent(storage, expected, "a".repeat(64)), false);
    assert.deepEqual([...values], untouched);
    assert.equal(parseActivationIntent(storage.getItem(ACTIVATION_STORAGE_KEY), storage.getItem(QUICK_STORAGE_KEY)).draft.id, latest.id);
    store(first);
    values.delete(ACTIVATION_STORAGE_KEY);
    assert.equal(bindCurrentActivationIntent(storage, expected, "a".repeat(64)), false);
    assert.equal(storage.getItem(ACTIVATION_STORAGE_KEY), null);
  });
  it("binds only a current draft, preserving same-user retries and rejecting expiry/account changes", () => {
    const value = draft(); const expected = { draft: value, intent: activationIntent(value) };
    const values = new Map([[QUICK_STORAGE_KEY, JSON.stringify(value)], [ACTIVATION_STORAGE_KEY, JSON.stringify(expected.intent)]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, v) => values.set(key, v) };
    assert.equal(bindCurrentActivationIntent(storage, expected, "a".repeat(64)), true);
    assert.equal(bindCurrentActivationIntent(storage, expected, "a".repeat(64)), true);
    const bound = storage.getItem(ACTIVATION_STORAGE_KEY);
    assert.equal(bindCurrentActivationIntent(storage, expected, "b".repeat(64)), false);
    assert.equal(bindCurrentActivationIntent(storage, expected, "a".repeat(64), value.expiresAt), false);
    assert.equal(storage.getItem(ACTIVATION_STORAGE_KEY), bound);
  });
  it("requires a matching unexpired personal input, never just a navigation cookie", () => {
    const value = draft();
    assert.equal(parseActivationIntent(null, JSON.stringify(value)), null);
    const intent = activationIntent(value);
    assert.deepEqual(parseActivationIntent(JSON.stringify(intent), JSON.stringify(value)).draft, value);
    assert.equal(parseActivationIntent(JSON.stringify(intent), null), null);
    assert.equal(parseActivationIntent(JSON.stringify({ ...intent, draftId: "other" }), JSON.stringify(value)), null);
    assert.equal(parseActivationIntent(JSON.stringify(intent), JSON.stringify(value), value.expiresAt), null);
    assert.equal(parseActivationIntent(JSON.stringify({ ...intent, sessionKey: "another-user" }), JSON.stringify(value)), null);
  });
  it("returns only the verified quick journey to activation and preserves allocation plans", () => {
    assert.equal(planReturnDestination("authenticated", "1", "quick"), "/portfolio/activate");
    assert.equal(planReturnDestination("authenticated", "1", "allocation"), "/plans");
    assert.equal(planReturnDestination("authenticated", "1", "https://other.test"), "/plans");
    for (const state of ["unverified", "unauthenticated", "invalid", "unavailable"]) assert.equal(planReturnDestination(state, "1", "quick"), null);
  });
});

describe("authenticated personal activation route", () => {
  let route, session, resolution, writes, prepares, result, failure;
  before(async () => {
    [route] = await importWithPorts(["src/app/api/portfolio-activation/route.ts"], {
      "@/lib/auth/current-session-subject": { readCurrentSessionSubject: async () => session },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
      "@/lib/auth/self-service-tenant-onboarding-write": { createCurrentSessionTenant: async form => { prepares++; assert.equal(form.get("confirmation"), "create_empty_portfolio"); return { status: "success" }; } },
      "@/db/queries/portfolio-drafts": { savePortfolioDraft: async (tenant, id, value) => { if (failure) throw new Error("private failure"); writes.push({ tenant, id, value }); return { id, status: result }; } },
    });
  });
  beforeEach(() => {
    session = { state: "authenticated", provider: "neon_auth", providerSubject: "test-verified-subject" };
    resolution = { ok: true, tenantContext: { ownerUserId: "owner-a", role: "user" } };
    writes = []; prepares = 0; result = "created"; failure = false;
  });
  const key = async () => (await (await route.GET(request("GET"))).json()).sessionKey;
  it("blocks guests, unverified and unavailable sessions before any write", async () => {
    for (const state of ["unauthenticated", "unverified", "invalid", "unavailable"]) {
      session = { state };
      const response = await route.POST(request("POST", { draft: draft(), sessionKey: "x" }));
      assert.equal(response.status, state === "unauthenticated" || state === "unverified" ? 401 : 503);
    }
    assert.equal(writes.length + prepares, 0);
  });
  it("binds retries to the verified identity and never accepts a client owner", async () => {
    const sessionKey = await key();
    assert.match(sessionKey, /^[a-f0-9]{64}$/);
    session = { ...session, providerSubject: "different-user" };
    assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey }))).status, 409);
    assert.equal(writes.length + prepares, 0);
    assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey: await key(), ownerUserId: "owner-a" }))).status, 400);
  });
  it("uses the established owner and writes exact names and amounts without fabricated holding data", async () => {
    const value = draft(); const sessionKey = await key();
    const response = await route.POST(request("POST", { draft: value, sessionKey }));
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(writes, [{ tenant: resolution.tenantContext, id: value.id, value: input }]);
    assert.equal(prepares, 0);
    result = "existing";
    const retry = await route.POST(request("POST", { draft: value, sessionKey }));
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { id: value.id, created: false });
  });
  it("prepares only an unlinked verified identity, then re-resolves ownership on a fresh request", async () => {
    resolution = { ok: false, failure: { code: "identity_unlinked", httpStatus: 409 } };
    const response = await route.POST(request("POST", { draft: draft(), sessionKey: await key() }));
    assert.equal(response.status, 202);
    assert.equal(prepares, 1); assert.equal(writes.length, 0);
    for (const code of ["identity_disabled", "app_user_not_active", "identity_collision"]) {
      resolution = { ok: false, failure: { code, httpStatus: 403 } };
      assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey: await key() }))).status, 403);
    }
    assert.equal(prepares, 1);
  });
  it("rejects expired input, cross-origin writes, query data and unknown instruments", async () => {
    const sessionKey = await key();
    assert.equal((await route.POST(request("POST", { draft: { ...draft(), expiresAt: 1 }, sessionKey }))).status, 400);
    assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey }, { origin: "https://evil.test" }))).status, 400);
    assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey }, {}, "?data=private"))).status, 400);
    assert.equal((await route.POST(request("POST", { draft: { ...draft(), input: { currency: "KRW", rows: [{ name: "Demo", value: 10, instrumentId: "demo-asset" }] } }, sessionKey }))).status, 400);
    assert.equal(writes.length + prepares, 0);
  });
  it("reports save failures and conflicts without leaking private error details", async () => {
    const sessionKey = await key(); failure = true;
    const failed = await route.POST(request("POST", { draft: draft(), sessionKey }));
    assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { error: "unavailable" });
    failure = false;
    for (const status of ["conflict", "limit", "inactive"]) {
      result = status;
      assert.equal((await route.POST(request("POST", { draft: draft(), sessionKey }))).status, status === "inactive" ? 403 : 409);
    }
  });
});
