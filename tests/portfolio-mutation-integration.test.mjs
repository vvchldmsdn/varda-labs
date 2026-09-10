import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const account = "11111111-1111-4111-8111-111111111111";
const group = "22222222-2222-4222-8222-222222222222";
const updated = "2026-09-01T00:00:00.000Z";

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function holdingForm(extra = {}) {
  return form({ accountId: account, portfolioGroupId: group, market: "korea", assetType: "stock", ticker: "005930", name: "Fixture", quantity: "2", averageCost: "100", currentPrice: "110", ...extra });
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let database;
async function fixture(options = {}) {
  const pg = database ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public;" + DDL);
  await pg.query("insert into accounts(id, canonical_owner_user_id, code, name, account_type, currency, updated_at) values($1,$2,'acct_fixture','Fixture','investment','KRW',$3)", [account, owner, updated]);
  await pg.query("insert into portfolio_groups(id, canonical_owner_user_id, name, updated_at) values($1,$2,'Group',$3)", [group, owner, updated]);
  let marketGate;
  const marketReadStarted = deferred();
  const client = new Proxy(pg, { get(target, key) {
    if (key === "query") return async (sql, ...args) => {
      if (marketGate && sql.includes('"live_price_quotes"')) {
        marketReadStarted.resolve();
        await marketGate.promise;
      }
      return target.query(sql, ...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const batches = [];
  const priceRequests = [];
  const sqlClient = {
    async transaction(build, options) {
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      batches.push(commands);
      assert.equal(options.isolationLevel, "ReadCommitted");
      return pg.transaction(async (tx) => {
        const rows = [];
        for (const command of commands) rows.push((await tx.query(command.text, command.params)).rows);
        return rows;
      });
    },
  };
  const [holdings, accounts, groups] = await importWithPorts([
    "src/lib/holding-onboarding-write.ts", "src/lib/account-management-write.ts", "src/lib/portfolio-group-management-write.ts",
  ], {
    "@/db/client": { db: drizzle(client), sqlClient },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: { ownerUserId: owner } }) },
    "@/db/queries/onboarding-instrument-search": { resolveOnboardingInstrumentById: async (id) => options.instruments?.[id] ?? null },
    "@/lib/market-data/providers/kis": {
      getKisProviderPolicy: () => ({ configured: options.providerConfigured !== false }),
      createKisMarketDataProvider: () => ({ name: "kis" }),
    },
    "@/lib/market-data/collection-worker": { scheduleMarketCollection: () => {} },
    "@/lib/market-data/collection-queue": { enqueueMarketCollection: async (request) => {
      priceRequests.push(...request);
      if (options.refreshFailure) throw options.refreshFailure;
      return { queuedCount: request.length, retryAfterSeconds: 10 };
    } },
  });
  return { pg, batches, priceRequests, holdings, accounts, groups, marketReadStarted,
    pauseMarketRead() { marketGate = deferred(); return marketGate; },
    async count(table) { return (await pg.query(`select count(*)::int as n from ${table}`)).rows[0].n; },
  };
}

describe("portfolio lifecycle mutation integration", () => {
  after(async () => { await database?.close(); });
  it("rechecks account lifecycle after a real pre-write market-read interleave", async () => {
    const f = await fixture();
    try {
      const gate = f.pauseMarketRead();
      const pending = f.holdings.writeSessionHoldingOnboarding(holdingForm({ currentPrice: "" }));
      await f.marketReadStarted.promise;
      const archive = await f.accounts.archiveSessionAccount(form({ accountId: account, expectedUpdatedAt: updated, archiveConfirmed: "yes" }));
      assert.equal(archive.status, "success");
      gate.resolve();
      assert.equal((await pending).status, "conflict");
      assert.equal(await f.count("assets"), 0);
      assert.equal(await f.count("holding_onboarding_evidence"), 0);
      assert.equal(await f.count("portfolio_group_asset_memberships"), 0);
      const locks = f.batches.map((batch) => batch[2]);
      assert.ok(locks.every((command) => command.text === "select pg_advisory_xact_lock(hashtextextended($1, 0))"));
      assert.equal(new Set(locks.map((command) => command.params[0])).size, 1);
      assert.ok(f.batches.every((batch) => batch.length === 4));
    } finally { await f.pg.exec("discard all"); }
  });

  it("rejects a group archived while market evidence is being read", async () => {
    const f = await fixture();
    try {
      const gate = f.pauseMarketRead();
      const pending = f.holdings.writeSessionHoldingOnboarding(holdingForm({ currentPrice: "" }));
      await f.marketReadStarted.promise;
      const archived = await f.groups.archiveSessionPortfolioGroup(form({ groupId: group, expectedUpdatedAt: updated, archiveConfirmed: "yes" }));
      assert.equal(archived.status, "success");
      gate.resolve();
      assert.equal((await pending).status, "conflict");
      assert.equal(await f.count("assets"), 0);
    } finally { await f.pg.exec("discard all"); }
  });

  it("commits all onboarding records together and then prevents account archival", async () => {
    const f = await fixture();
    try {
      assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm())).status, "success");
      assert.equal(await f.count("assets"), 1);
      assert.equal(await f.count("holding_onboarding_evidence"), 1);
      assert.equal(await f.count("portfolio_group_asset_memberships"), 1);
      assert.equal((await f.accounts.archiveSessionAccount(form({ accountId: account, expectedUpdatedAt: updated, archiveConfirmed: "yes" }))).status, "conflict");
      assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm())).status, "conflict");
      assert.equal(await f.count("assets"), 1);
    } finally { await f.pg.exec("discard all"); }
  });

  it("reuses an owner-scoped default group and preserves unknown purchase cost", async () => {
    const f = await fixture();
    const withoutGroup = { portfolioGroupId: "", newPortfolioGroupName: "", averageCost: "" };
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm(withoutGroup))).status, "success");
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ ...withoutGroup, ticker: "000660" }))).status, "success");
    assert.equal(await f.count("portfolio_groups"), 2);
    const rows = (await f.pg.query("select asset.average_cost, evidence.average_cost as recorded_cost, groups.name from assets asset join holding_onboarding_evidence evidence on evidence.asset_id=asset.id join portfolio_group_asset_memberships membership on membership.asset_id=asset.id join portfolio_groups groups on groups.id=membership.portfolio_group_id")).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.average_cost === null && row.recorded_cost === null && row.name === "기본 포트폴리오"));
    assert.equal(f.priceRequests.length, 0);
  });

  it("does not reuse another owner's default group or spend provider budget for their account", async () => {
    const f = await fixture();
    await f.pg.query("insert into portfolio_groups(id,canonical_owner_user_id,name) values(gen_random_uuid(),$1,'기본 포트폴리오')", [foreign]);
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ portfolioGroupId: "" }))).status, "success");
    const owners = (await f.pg.query("select canonical_owner_user_id from portfolio_groups where name='기본 포트폴리오'")).rows;
    assert.deepEqual(owners.map((row) => row.canonical_owner_user_id).sort(), [owner, foreign].sort());
    const foreignAccount = "44444444-4444-4444-8444-444444444444";
    await f.pg.query("insert into accounts(id,canonical_owner_user_id,code,name) values($1,$2,'foreign','Foreign')", [foreignAccount, foreign]);
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ accountId: foreignAccount, ticker: "000660", currentPrice: "" }))).status, "conflict");
    assert.equal(f.priceRequests.length, 0);
  });

  it("reuses the same explicitly named group for subsequent batch rows", async () => {
    const f = await fixture();
    const grouping = { portfolioGroupId: "", newPortfolioGroupName: "Long term" };
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm(grouping))).status, "success");
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ ...grouping, newPortfolioGroupName: "long TERM", ticker: "000660" }))).status, "success");
    assert.equal(await f.count("portfolio_groups"), 2);
    assert.equal((await f.pg.query("select count(distinct portfolio_group_id)::integer as n from portfolio_group_asset_memberships")).rows[0].n, 1);
  });

  it("queues one missing quote, saves nothing until evidence arrives, then preserves its source", async () => {
    const f = await fixture();
    const result = await f.holdings.writeSessionHoldingOnboarding(holdingForm({ ticker: "000660", currentPrice: "", averageCost: "" }));
    assert.equal(result.status, "price_unavailable");
    assert.equal(await f.count("assets"), 0);
    assert.equal(f.priceRequests.length, 1);
    const request = f.priceRequests[0];
    assert.deepEqual(request, { kind: "live", ticker: "000660", market: "korea", currency: "KRW" });
    await f.pg.query("insert into live_price_quotes(ticker,market,currency,price,source,quote_type,status,price_as_of,fetched_at) values('000660','korea','KRW','145000','kis_test','live','ok',now(),now())");
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ ticker: "000660", currentPrice: "", averageCost: "" }))).status, "success");
    assert.equal(f.priceRequests.length, 1);
    const row = (await f.pg.query("select current_price,price_source,average_cost from assets")).rows[0];
    assert.equal(Number(row.current_price), 145000);
    assert.equal(row.price_source, "kis_test");
    assert.equal(row.average_cost, null);
  });

  it("leaves all portfolio records untouched while a quote is queued and returns a retry interval", async () => {
    const f = await fixture();
    const result = await f.holdings.writeSessionHoldingOnboarding(holdingForm({ portfolioGroupId: "", ticker: "000660", currentPrice: "" }));
    assert.equal(result.status, "price_unavailable");
    assert.equal(result.retryAfterSeconds, 10);
    assert.equal(f.priceRequests.length, 1);
    assert.equal(await f.count("assets"), 0);
    assert.equal(await f.count("holding_onboarding_evidence"), 0);
    assert.equal(await f.count("portfolio_groups"), 1);
  });

  it("rejects stale or future price evidence when no current quote can be obtained", async () => {
    const f = await fixture({ providerConfigured: false });
    await f.pg.query("update live_price_quotes set fetched_at=now()-interval '1 year'");
    await f.pg.query("insert into asset_price_snapshots(ticker,market,currency,date,close_price,is_sample) values('005930','korea','KRW','2020-01-01',999,false),('005930','korea','KRW','2099-01-01',999,false)");
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ currentPrice: "" }))).status, "price_unavailable");
    assert.equal(await f.count("assets"), 0);
    assert.equal(f.priceRequests.length, 0);
  });

  it("revalidates a selected catalog identity before resolving its price", async () => {
    const instrumentId = "stock:33333333-3333-4333-8333-333333333333";
    const f = await fixture({ instruments: { [instrumentId]: { ticker: "005930", market: "korea", currency: "KRW", assetType: "stock", name: "Verified name" } } });
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ instrumentId, ticker: "000660", currentPrice: "" }))).status, "invalid");
    assert.equal(f.priceRequests.length, 0);
    assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ instrumentId, name: "Client alias" }))).status, "success");
    assert.equal((await f.pg.query("select name from assets")).rows[0].name, "Verified name");
  });

  it("does not create a group or holding for a foreign account", async () => {
    const f = await fixture();
    try {
      await f.pg.query("update accounts set canonical_owner_user_id=$1 where id=$2", [foreign, account]);
      const request = holdingForm({ portfolioGroupId: "", newPortfolioGroupName: "New group" });
      assert.equal((await f.holdings.writeSessionHoldingOnboarding(request)).status, "conflict");
      assert.equal(await f.count("portfolio_groups"), 1);
      assert.equal(await f.count("assets"), 0);
    } finally { await f.pg.exec("discard all"); }
  });

  it("creates a requested new group and enforces duplicate active account names", async () => {
    const f = await fixture();
    try {
      assert.equal((await f.holdings.writeSessionHoldingOnboarding(holdingForm({ portfolioGroupId: "", newPortfolioGroupName: "New group" }))).status, "success");
      assert.equal(await f.count("portfolio_groups"), 2);
      const outcomes = await Promise.all([f.accounts.createSessionAccount(form({ name: "Second" })), f.accounts.createSessionAccount(form({ name: "Second" }))]);
      assert.deepEqual(outcomes.map((row) => row.status).sort(), ["conflict", "success"]);
      assert.equal(await f.count("accounts"), 2);
      const created = outcomes.find(row => row.status === "success");
      const saved = (await f.pg.query("select id, canonical_owner_user_id from accounts where name = 'Second'")).rows[0];
      assert.equal(created.createdAccountId, saved.id, "the continuation link targets the account actually created");
      assert.equal(saved.canonical_owner_user_id, owner);
      assert.equal(outcomes.find(row => row.status === "conflict").createdAccountId, undefined);
    } finally { await f.pg.exec("discard all"); }
  });

  it("keeps the 64-account boundary when two creation attempts arrive together", async () => {
    const f = await fixture();
    try {
      await f.pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) select gen_random_uuid(),$1,'extra_'||n,'Extra '||n,'investment','KRW' from generate_series(1,62) n", [owner]);
      const outcomes = await Promise.all([f.accounts.createSessionAccount(form({ name: "Last A" })), f.accounts.createSessionAccount(form({ name: "Last B" }))]);
      assert.deepEqual(outcomes.map((row) => row.status).sort(), ["conflict", "success"]);
      assert.equal(await f.count("accounts"), 64);
    } finally { await f.pg.exec("discard all"); }
  });
});

// Minimal PostgreSQL schema fixture: real columns and relevant identity constraints.
// PGlite executes the production SQL; its single connection is not a substitute
// for multi-session MVCC testing. The controlled market-read interleaves above
// exercise the original application-level race, with no external DB or provider.
const DDL = `
create table accounts(id uuid primary key, canonical_owner_user_id uuid, owner_user_id text, code text, name text, account_type text, currency text, is_active boolean default true, sort_order integer default 0, created_at timestamptz default now(), updated_at timestamptz default now(), unique(id,canonical_owner_user_id), unique(canonical_owner_user_id,code));
create table portfolio_groups(id uuid primary key, canonical_owner_user_id uuid, name text, description text, sort_order integer default 0, archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), unique(id,canonical_owner_user_id));
create unique index group_names on portfolio_groups(canonical_owner_user_id,lower(name)) where archived_at is null;
create table assets(id uuid primary key, canonical_owner_user_id uuid, account_id uuid references accounts(id), account text, name text, ticker text, asset_type text, market text, currency text, quantity numeric, average_cost numeric, current_price numeric, price_source text, price_fetched_at timestamptz, price_as_of timestamptz, price_quote_type text, price_status text, archived_at timestamptz, created_at timestamptz, updated_at timestamptz, unique(id,canonical_owner_user_id), unique(id,account_id));
create unique index asset_instruments on assets(canonical_owner_user_id,account_id,lower(btrim(market)),upper(btrim(currency)),upper(btrim(ticker)));
create table holding_onboarding_evidence(id uuid primary key, canonical_owner_user_id uuid, asset_id uuid, account_id uuid, quantity numeric, average_cost numeric, current_price numeric, reported_return_pct numeric, currency text, price_source text, price_as_of timestamptz, policy_version text, recorded_at timestamptz, created_at timestamptz, unique(asset_id), foreign key(asset_id,canonical_owner_user_id) references assets(id,canonical_owner_user_id), foreign key(account_id,canonical_owner_user_id) references accounts(id,canonical_owner_user_id), foreign key(asset_id,account_id) references assets(id,account_id));
create table portfolio_group_asset_memberships(id uuid primary key, canonical_owner_user_id uuid, portfolio_group_id uuid, asset_id uuid, valid_from date, valid_to date, created_at timestamptz, foreign key(portfolio_group_id,canonical_owner_user_id) references portfolio_groups(id,canonical_owner_user_id), foreign key(asset_id,canonical_owner_user_id) references assets(id,canonical_owner_user_id));
create unique index asset_members on portfolio_group_asset_memberships(portfolio_group_id,asset_id) where valid_to is null;
create table portfolio_group_account_memberships(id uuid primary key, canonical_owner_user_id uuid, portfolio_group_id uuid, account_id uuid, valid_from date, valid_to date, created_at timestamptz);
create unique index account_members on portfolio_group_account_memberships(portfolio_group_id,account_id) where valid_to is null;
create table live_price_quotes(ticker text, market text, currency text, price numeric, source text, quote_type text, status text, price_as_of timestamptz, fetched_at timestamptz);
create table asset_price_snapshots(ticker text,market text,currency text,date date,close_price numeric,source text,fetched_at timestamptz,is_sample boolean default false);
insert into live_price_quotes values('005930','korea','KRW',110,'fixture','live','ok',now(),now());
`;
