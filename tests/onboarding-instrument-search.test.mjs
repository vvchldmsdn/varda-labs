import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [policy] = await importWithPorts(["src/lib/onboarding-instrument-search.ts"], {});
const masterId = "11111111-1111-4111-8111-111111111111";
const stockId = "22222222-2222-4222-8222-222222222222";
const good = { id: masterId, name: "Example ETF", ticker: "ABC", market: "US", currency: "USD" };

describe("onboarding instrument catalog", () => {
  it("validates literal bounded search and opaque catalog IDs", () => {
    assert.equal(policy.parseOnboardingInstrumentSearch(" F "), "F");
    for (const value of [null, [], "", " ", "a".repeat(81), "stock\nname"]) assert.equal(policy.parseOnboardingInstrumentSearch(value), null);
    assert.equal(policy.instrumentSearchLikePattern("a%_\\b"), "%a\\%\\_\\\\b%");
    assert.deepEqual(policy.parseOnboardingInstrumentId(`etf:${masterId}`), { kind: "etf", id: masterId });
    for (const value of [masterId, `tenant:${masterId}`, `stock:${masterId}:`, `etf:${masterId}:other`]) assert.equal(policy.parseOnboardingInstrumentId(value), null);
  });

  it("does not infer missing currency, exchange or symbol identity", () => {
    assert.deepEqual(policy.canonicalOnboardingInstrument(good, "etf"), { ...good, id: `etf:${masterId}`, market: "us", assetType: "etf", source: "etf_master" });
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, market: "Japan" }, "stock"), null);
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, currency: "KRW" }, "stock"), null);
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, ticker: "US0000000001", market: "KR", currency: "KRW" }, "stock"), null);
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, currency: null }, "stock"), null);
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, name: "" }, "stock"), null);
    assert.equal(policy.canonicalOnboardingInstrument({ ...good, ticker: "0012A0", market: "KR", currency: "KRW" }, "etf").ticker, "0012A0");
  });

  it("deduplicates shared constituent identities, ranks exact symbols, and caps public output", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ ...policy.canonicalOnboardingInstrument(good, "etf"), ticker: `A${index}`, id: `row-${index}` }));
    const result = policy.rankOnboardingInstruments([...rows, rows[0]], "A18");
    assert.equal(result.length, 12);
    assert.equal(result[0].ticker, "A18");
    assert.equal(new Set(result.map(row => row.ticker)).size, 12);
  });

  it("queries only admitted shared reference rows with parameterized text and bounded reads", async () => {
    const calls = [];
    const db = drizzle(async (query, params) => {
      calls.push({ query, params });
      return { rows: query.includes('from "etf_masters"')
        ? [[masterId, "Example ETF", "ABC", "US", "USD"]]
        : [[stockId, "Example share", "XYZ", "US", "USD"], [stockId, "Ambiguous", "XYZ", null, "USD"]] };
    });
    const [query] = await importWithPorts(["src/db/queries/onboarding-instrument-search.ts"], { "@/db/client": { db } });
    assert.deepEqual(await query.searchOnboardingInstruments(" "), []);
    assert.equal(calls.length, 0);
    const result = await query.searchOnboardingInstruments("a%'_\\");
    assert.equal(calls.length, 2);
    assert.equal(result.length, 2);
    for (const call of calls) {
      assert.match(call.query, /"etf_masters"\."is_active" = \$/);
      assert.match(call.query, /"etf_masters"\."is_sample" = \$/);
      assert.match(call.query, /limit \$/);
      assert.equal(call.params.at(-1), 36);
      assert.ok(call.params.includes("%a\\%'\\_\\\\%"));
      assert.doesNotMatch(call.query, /from "assets"|from "accounts"|canonical_owner_user_id/);
      assert.doesNotMatch(call.query, /a%'/);
    }
    assert.match(calls[1].query, /"etf_holdings"\."is_sample" = \$/);
    assert.match(calls[1].query, /lower\("etf_holdings"\."security_type"\) = 'stock'/);
    assert.match(calls[1].query, /max\(reference.as_of_date\)/);
    calls.length = 0;
    assert.equal(await query.resolveOnboardingInstrumentById("fake"), null);
    assert.equal(calls.length, 0);
    assert.equal((await query.resolveOnboardingInstrumentById(`etf:${masterId}`)).ticker, "ABC");
    assert.equal(calls[0].params.at(-1), 1);
    assert.ok(calls[0].params.includes(masterId));
  });
});

describe("onboarding instrument search route", () => {
  const routePath = "src/app/api/instruments/search/route.ts";
  async function routeWith({ resolution = { ok: true, tenantContext: { ownerUserId: masterId, role: "user" } }, search = async () => [] } = {}) {
    const [route] = await importWithPorts([routePath], {
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
      "@/db/queries/onboarding-instrument-search": { searchOnboardingInstruments: search },
    });
    return route;
  }
  it("requires an active authenticated tenant before any catalog read", async () => {
    for (const status of [401, 403, 503]) {
      const route = await routeWith({ resolution: { ok: false, failure: { httpStatus: status } }, search: () => { throw Error("must not read"); } });
      const response = await route.GET(new Request("https://app.test/api/instruments/search?q=ABC"));
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual((await response.json()).instruments, []);
    }
  });
  it("rejects missing, repeated, excessive and control-character queries before database access", async () => {
    let calls = 0;
    const route = await routeWith({ search: async () => { calls += 1; return []; } });
    for (const query of ["", "q=", "q=ABC&q=XYZ", `q=${"a".repeat(81)}`, "q=a%00"]) {
      const response = await route.GET(new Request(`https://app.test/api/instruments/search?${query}`));
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
  it("returns only catalog result and suppresses database error details", async () => {
    const instrument = policy.canonicalOnboardingInstrument(good, "etf");
    const route = await routeWith({ search: async query => { assert.equal(query, "ABC"); return [instrument]; } });
    const response = await route.GET(new Request("https://app.test/api/instruments/search?q=%20ABC%20"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready", instruments: [instrument] });
    const broken = await routeWith({ search: async () => { throw Error("database credential details"); } });
    const failure = await broken.GET(new Request("https://app.test/api/instruments/search?q=ABC"));
    assert.equal(failure.status, 503);
    assert.deepEqual(await failure.json(), { status: "unavailable", instruments: [] });
  });
});
