import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = "11111111-1111-4111-8111-111111111111";
const input = { currency: "KRW", amount: 500000, rows: [{ name: "My first fund", value: 900000, targetBps: 10000 }] };
const pg = new PGlite();
let route, queries, resolution, failure;
const request = (method, body, headers = {}) => new Request("https://local.test/api/investment-plans", {
  method, headers: { origin: "https://local.test", "content-type": "application/json", ...headers },
  ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
});
const asTenant = (text, params = [], tenant = owner) => pg.transaction(async tx => {
  await tx.exec("set local role varda_tenant_app");
  await tx.query("select set_config('app.current_user_id', $1, true)", [tenant]);
  return (await tx.query(text, params)).rows;
});

describe("isolated investment plan persistence", () => {
  before(async () => {
    await pg.exec(`create role varda_tenant_app; create table app_users(id uuid primary key, status text not null);
      insert into app_users values('${owner}','active'),('${other}','active');`);
    await pg.exec(readFileSync(new URL("../drizzle/0045_investment_plans.sql", import.meta.url), "utf8"));
    const sqlClient = { transaction: async (build, options) => {
      if (failure) throw new Error("secret database failure must not escape");
      assert.equal(options.isolationLevel, "ReadCommitted");
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      if (!options.readOnly) {
        assert.equal(commands[1].text, "select set_config('lock_timeout', '3000', true), set_config('statement_timeout', '5000', true)");
        assert.equal(commands[2].text, "select pg_advisory_xact_lock(hashtextextended($1, 0))");
      }
      return pg.transaction(async tx => {
        await tx.exec("set local role varda_tenant_app");
        const result = [];
        for (const command of commands) result.push((await tx.query(command.text, command.params)).rows);
        return result;
      });
    } };
    [route, queries] = await importWithPorts(["src/app/api/investment-plans/route.ts", "src/db/queries/investment-plans.ts"], {
      "@/db/tenant-client": { getTenantSqlClient: () => sqlClient },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
    });
  });
  beforeEach(async () => {
    await pg.exec("truncate investment_plans; update app_users set status = 'active'");
    resolution = { ok: true, tenantContext: { ownerUserId: owner, role: "user" } };
    failure = false;
  });
  after(async () => pg.close());

  it("persists the authenticated owner's immutable plan and makes identical retries idempotent", async () => {
    const first = await route.POST(request("POST", { id, input }));
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { id, created: true });
    const retry = await route.POST(request("POST", { id, input }));
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { id, created: false });
    const changed = await route.POST(request("POST", { id, input: { ...input, amount: 10 } }));
    assert.equal(changed.status, 409);
    const list = await route.GET(request("GET"));
    const { plans } = await list.json();
    assert.equal(plans.length, 1);
    assert.deepEqual(plans[0].input, input);
    assert.ok(Number.isFinite(Date.parse(plans[0].createdAt)));
    assert.equal(list.headers.get("cache-control"), "private, no-store");
    assert.equal(list.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal((await pg.query("select relforcerowsecurity from pg_class where relname='investment_plans'")).rows[0].relforcerowsecurity, true);
    assert.deepEqual((await pg.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r => r.tablename), ["app_users", "investment_plans"]);
  });

  it("protects list, delete, insertion and updates across tenants at the database boundary", async () => {
    await route.POST(request("POST", { id, input }));
    resolution = { ok: true, tenantContext: { ownerUserId: other, role: "user" } };
    assert.deepEqual(await (await route.GET(request("GET"))).json(), { plans: [] });
    assert.equal((await route.DELETE(request("DELETE", { id }))).status, 404);
    assert.deepEqual(await asTenant("select * from investment_plans", [], other), []);
    await assert.rejects(asTenant("insert into investment_plans(owner_user_id,id,input_json,engine_version) values($1,$2,$3,'deficit_proportional_capped_v1')", [owner, id, JSON.stringify(input)], other), /row-level security/);
    await assert.rejects(asTenant("update investment_plans set input_json='{}'"), /permission denied/);
    await assert.rejects(asTenant("select * from app_users"), /permission denied/);
    assert.equal((await route.POST(request("POST", { id, input }))).status, 201); // same id is independently scoped
    assert.equal((await pg.query("select count(*)::int as n from investment_plans")).rows[0].n, 2);
  });

  it("processes overlapping duplicate requests as one creation and one retry", async () => {
    const responses = await Promise.all([route.POST(request("POST", { id, input })), route.POST(request("POST", { id, input }))]);
    assert.deepEqual(responses.map(value => value.status).sort(), [200, 201]);
    assert.equal((await pg.query("select count(*)::int as n from investment_plans")).rows[0].n, 1);
    // PGlite serializes transactions; production uses the same owner lock and a fresh
    // ReadCommitted statement after acquiring it (not a stale pre-lock count).
  });

  it("fails closed for stale sessions after app-user deactivation and for missing tenant settings", async () => {
    await route.POST(request("POST", { id, input }));
    await pg.query("update app_users set status='disabled' where id=$1", [owner]);
    assert.deepEqual(await (await route.GET(request("GET"))).json(), { plans: [] });
    assert.equal((await route.POST(request("POST", { id, input }))).status, 403);
    assert.equal((await route.DELETE(request("DELETE", { id }))).status, 404);
    assert.deepEqual(await asTenant("select * from investment_plans", [], ""), []);
  });

  it("enforces 50 plans while retaining idempotent retry at the limit", async () => {
    for (let n = 0; n < 50; n++) {
      const planId = `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
      assert.equal((await queries.saveInvestmentPlan({ ownerUserId: owner }, planId, input)).status, "created");
    }
    assert.equal((await queries.saveInvestmentPlan({ ownerUserId: owner }, "11111111-1111-4111-8111-000000000000", input)).status, "existing");
    assert.deepEqual(await (await route.POST(request("POST", { id, input }))).json(), { error: "plan_limit" });
    assert.equal((await pg.query("select count(*)::int as n from investment_plans")).rows[0].n, 50);
  });

  it("rejects anonymous/unlinked sessions without saving and accepts retry after authentication", async () => {
    for (const [code, httpStatus, expected] of [["unauthenticated", 401, 401], ["identity_unlinked", 403, 409], ["auth_provider_unavailable", 503, 503]]) {
      resolution = { ok: false, failure: { code, httpStatus } };
      assert.equal((await route.POST(request("POST", { id, input }))).status, expected);
      assert.equal((await route.GET(request("GET"))).status, expected);
    }
    assert.equal((await pg.query("select count(*)::int as n from investment_plans")).rows[0].n, 0);
    resolution = { ok: true, tenantContext: { ownerUserId: owner } };
    assert.equal((await route.POST(request("POST", { id, input }))).status, 201);
  });

  it("rejects CSRF, oversized bodies, URL inputs, owner injection and malformed plans", async () => {
    const cases = [
      request("POST", { id, input }, { origin: "https://evil.test" }),
      request("POST", { id, input }, { "sec-fetch-site": "cross-site" }),
      request("POST", { id, input, ownerUserId: other }),
      request("POST", { id, input: { ...input, currency: "USD" } }),
      request("POST", { id, input: { ...input, rows: [{ ...input.rows[0], targetBps: 0 }] } }),
      request("POST", "x".repeat(4097)), request("POST", "{"),
      new Request("https://local.test/api/investment-plans?amount=123", { method: "POST", body: JSON.stringify({ id, input }) }),
    ];
    for (const candidate of cases) assert.equal((await route.POST(candidate)).status, 400);
    assert.equal((await pg.query("select count(*)::int as n from investment_plans")).rows[0].n, 0);
  });

  it("returns a generic recoverable error and deletes only a saved plan after successful retry", async () => {
    failure = true;
    const failed = await route.POST(request("POST", { id, input }));
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: "service_unavailable" });
    failure = false;
    assert.equal((await route.POST(request("POST", { id, input }))).status, 201);
    assert.deepEqual(await (await route.DELETE(request("DELETE", { id }))).json(), { deleted: true });
    assert.deepEqual(await (await route.GET(request("GET"))).json(), { plans: [] });
    assert.equal((await route.DELETE(request("DELETE", { id }))).status, 404);
  });
});
