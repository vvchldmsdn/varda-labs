import assert from "node:assert/strict";
import { test } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const scope = { kind: "account", key: "account:11111111-1111-4111-8111-111111111111", accountId: "11111111-1111-4111-8111-111111111111", accountCode: "test", label: "Test" };
const tenant = { ownerUserId: "22222222-2222-4222-8222-222222222222", role: "user" };
const binding = "b".repeat(64);
const range = { start: "2025-01-01", end: "2025-01-31" };

async function harness({ authenticated = true, permitted = true, fail = false } = {}) {
  const reads = [];
  const [{ GET }] = await importWithPorts(["src/app/beta/api/history/period-attribution/route.ts"], {
    "@/lib/cairn-v2/server-access": { requireBetaFixtureAccess: async () => {} },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () =>
      authenticated ? { ok: true, tenantContext: tenant } : { ok: false, failure: { httpStatus: 401 } } },
    "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async args => {
      assert.deepEqual(args.tenantContext, tenant);
      return { state: "ready", catalog: { scopes: [scope] }, resolution: permitted && args.scope === scope.key ? { state: "resolved", scope } : { state: "blocked" } };
    } },
    "@/lib/cairn-v2/display-session": { displayBindingForScopes: () => binding },
    "@/lib/cairn-v2/period-attribution-read": { readPeriodAttribution: async args => {
      reads.push(args);
      if (fail) throw Error("Private database error");
      return { range, state: "partial", priceKrw: 2500, fxKrw: -100, totalKrw: 2400 };
    } },
  });
  function request(query = new URLSearchParams({ scope: scope.key, ...range }), marker = binding) {
    return GET(new Request("https://qa.invalid/beta/api/history/period-attribution?" + query, {
      headers: marker ? { "X-Cairn-Display-Binding": marker } : {},
    }));
  }
  return { request, reads };
}

test("period reads use the admitted tenant, scope and exact inclusive dates", async () => {
  const { request, reads } = await harness();
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-cairn-display-binding"), binding);
  assert.equal((await response.json()).totalKrw, 2400);
  assert.deepEqual(reads, [{ tenantContext: tenant, scope, range }]);
});

test("period reads reject changed sessions, inaccessible scopes, and malformed date ranges before reading holdings", async () => {
  const { request, reads } = await harness();
  for (const marker of ["", "a".repeat(64)]) assert.equal((await request(undefined, marker)).status, 409);
  for (const [key, value] of [["scope", "all"], ["start", "2025-02-01"], ["end", "2025-02-30"], ["end", "2999-12-30"], ["owner", tenant.ownerUserId]]) {
    const query = new URLSearchParams({ scope: scope.key, ...range });
    query.set(key, value);
    assert.equal((await request(query)).status, key === "scope" ? 403 : 400);
  }
  const duplicate = new URLSearchParams({ scope: scope.key, ...range });
  duplicate.append("start", range.start);
  assert.equal((await request(duplicate)).status, 400);
  assert.equal(reads.length, 0);
  const guest = await harness({ authenticated: false });
  assert.equal((await guest.request()).status, 401);
  assert.equal(guest.reads.length, 0);
});

test("failed period reads return a retryable error without amounts or private diagnostics", async () => {
  const { request } = await harness({ fail: true });
  const response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "history_unavailable" });
});
