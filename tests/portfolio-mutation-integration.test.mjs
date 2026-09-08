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
async function fixture() {
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
  });
  return { pg, batches, holdings, accounts, groups, marketReadStarted,
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
insert into live_price_quotes values('005930','korea','KRW',110,'fixture','live','ok',now(),now());
`;
