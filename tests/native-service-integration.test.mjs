import assert from "node:assert/strict";
import { after, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const account = "11111111-1111-4111-8111-111111111111", peer = "22222222-2222-4222-8222-222222222222", foreign = "33333333-3333-4333-8333-333333333333", asset = "44444444-4444-4444-8444-444444444444";
let database;
after(async () => { await database?.close(); });
const baseDdl = `
create table app_users(id uuid primary key,status text not null);
create table accounts(id uuid primary key,canonical_owner_user_id uuid,code text not null,name text not null,is_active boolean default true,updated_at timestamptz default now());
create table assets(id uuid primary key,canonical_owner_user_id uuid,account_id uuid,account text,name text,ticker text,market text,currency text,asset_type text,quantity numeric(20,6) not null default 0,current_price numeric(20,4),average_cost numeric(20,4),price_source text,price_status text,archived_at timestamptz,updated_at timestamptz default now());
create table event_ledger_entries(id uuid primary key,canonical_owner_user_id uuid,event_date date not null,event_type text not null,source text,recorded_at timestamptz,rule_version text,account text,account_id uuid,asset_id uuid,legacy_asset_id varchar(24) not null,asset_name text not null,before_value text not null,after_value text not null,is_sample boolean not null default false);
create table daily_portfolio_snapshots(id uuid primary key default gen_random_uuid(),canonical_owner_user_id uuid,snapshot_date date,account text,account_id uuid,source text not null default 'base44_import',rule_version text,is_sample boolean not null default false,captured_at timestamptz);
create unique index snapshot_owner_date_account_source on daily_portfolio_snapshots(canonical_owner_user_id,snapshot_date,account,source) where canonical_owner_user_id is not null;
`;
const quote = value => `"${value.replaceAll('"', '""')}"`;

async function fixture({ unknownCost = false } = {}) {
  const pg = database ??= new PGlite();
  await pg.exec("drop schema public cascade; create schema public; do $$ begin if not exists(select 1 from pg_roles where rolname='varda_tenant_app') then create role varda_tenant_app; end if; end $$;" + baseDdl);
  for (const name of ["0043_powerful_living_tribunal.sql", "0049_twelve_data_collection.sql", "0050_native_portfolio_ledger.sql", "0051_market_provider_observations.sql"]) await pg.exec(readFileSync(`drizzle/${name}`, "utf8"));
  await pg.exec("create unique index if not exists accounts_id_canonical_owner_unique on accounts(id,canonical_owner_user_id)");
  await pg.exec(readFileSync("drizzle/0024_nebulous_tag.sql", "utf8"));
  const [schema, configuration] = await importWithPorts(["src/db/schema.ts", "src/lib/market-data/twelve-data-config.ts"], {});
  // Mirror all columns selected by the real DAL from the actual Drizzle schema.
  // Core native/provider constraints and writers come from their real migration SQL above.
  const tables = [schema.appUsers, schema.accounts, schema.assets, schema.eventLedgerEntries, schema.dailyPortfolioSnapshots,
    schema.dailyPositionSnapshots, schema.livePriceQuotes, schema.assetPriceSnapshots, schema.fxRates, schema.assetGroups, schema.settings];
  for (const table of tables) {
    const { name, columns } = getTableConfig(table);
    const existing = (await pg.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1", [name])).rows.map(row => row.column_name);
    if (!existing.length) await pg.exec(`create table ${quote(name)} (${columns.map(column => `${quote(column.name)} ${column.getSQLType()}`).join(",")})`);
    else for (const column of columns) if (!existing.includes(column.name)) await pg.exec(`alter table ${quote(name)} add column ${quote(column.name)} ${column.getSQLType()}`);
  }
  await pg.exec("grant usage on schema public to varda_tenant_app");
  for (const migration of ['0045_investment_plans','0052_native_legacy_lifecycle_guard','0056_native_tenant_mutation']) await pg.exec(readFileSync(`drizzle/${migration}.sql`, 'utf8'));
  for (const name of ["accounts", "assets", "event_ledger_entries", "daily_portfolio_snapshots", "asset_groups", "settings", "portfolio_groups", "portfolio_group_account_memberships", "portfolio_group_asset_memberships"]) {
    await pg.exec(`alter table ${quote(name)} enable row level security; alter table ${quote(name)} force row level security;
      create policy tenant_read on ${quote(name)} for select to varda_tenant_app using(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid); grant select on ${quote(name)} to varda_tenant_app;`);
  }
  await pg.query("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')", [owner, other]);
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,sort_order) values($1,$4,'one','One',0),($2,$4,'two','Two',1),($3,$5,'foreign','Foreign',0)", [account, peer, foreign, owner, other]);
  const calls = [], state = { price: "125", fx: "1400", historicalRates: {}, splits: [], dividends: [], timestamp: null };
  const transport = tenant => ({ query: async (text, params = []) => (await pg.query(text, params)).rows,
    transaction: async build => {
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      return pg.transaction(async tx => {
        if (tenant) await tx.exec("set local role varda_tenant_app");
        const rows = []; for (const command of commands) rows.push((await tx.query(command.text, command.params)).rows); return rows;
      });
    } });
  const listing = { instrumentKey: "us:ARCX:VOO", ticker: "VOO", symbol: "VOO", micCode: "ARCX", exchange: "NYSE", type: "ETF", currency: "USD", exchangeTimezone: "America/New_York" };
  const config = { provider: { mode: "live", apiKey: "isolated-sql-fixture", listings: [listing], audience: "member_display",
    license: { status: "confirmed", reference: "fixture", cacheScope: "fixture", expiresAt: new Date(Date.now() + 30 * 86400000), datasets: ["us_quote", "usd_krw", "usd_krw_history", "us_daily_raw", "us_splits", "us_dividends"], audiences: ["member_display"], quoteDelay: "delayed" },
    release: { approved: true, reference: "fixture" } }, budget: { httpRequestsPerMinute: 100, apiCreditsPerMinute: 100, minimumIntervalMs: 0 }, storage: { retentionSeconds: 86400, quoteFreshSeconds: 600, fxFreshSeconds: 600, historyFreshSeconds: 600 } };
  const http = async (endpoint, parameters) => {
    calls.push({ endpoint, parameters });
    const meta = { symbol: "VOO", currency: "USD", mic_code: "ARCX", exchange: "NYSE", type: "ETF", exchange_timezone: "America/New_York", interval: "1day" };
    if (endpoint === "/quote") return { ...meta, close: state.price, last_quote_at: state.timestamp ?? Math.floor((Date.now() - 25 * 3600000) / 1000) };
    if (endpoint === "/exchange_rate") return { symbol: "USD/KRW", rate: parameters.date ? state.historicalRates[new Date(`${parameters.date}Z`).toISOString()] ?? "1300" : state.fx, timestamp: parameters.date ? Math.floor(Date.parse(`${parameters.date}Z`) / 1000) : Math.floor(Date.now() / 1000) - 5 };
    if (endpoint === "/time_series") return { meta, values: [...new Set([parameters.start_date, parameters.end_date])].map(datetime => ({ datetime, close: state.price })) };
    if (endpoint === "/splits") return { meta, splits: state.splits };
    if (endpoint === "/dividends") return { meta, dividends: state.dividends };
    throw new Error("unexpected_external_fixture_endpoint");
  };
  const [writer, loader, service, engine, snapshots] = await importWithPorts([
    "src/db/queries/native-portfolio-ledger.ts", "src/db/queries/currency-tracked-portfolio.ts", "src/lib/market-data/twelve-data-service.ts", "src/lib/currency-tracked-portfolio.ts", "src/db/queries/native-portfolio-snapshots.ts",
  ], {
    "@/db/client": { db: drizzle(pg), sqlClient: transport(false) },
    "@/db/tenant-client": { getTenantSqlClient: () => transport(true) },
    "./tenant-client": { getTenantSqlClient: () => transport(true) },
    "./twelve-data-config": { ...configuration, getTwelveDataServerConfig: () => config },
    "./twelve-data-http": { fetchTwelveDataPayload: http },
    "next/server": { after: () => {} },
  });
  const openingAt = new Date(Date.now() - 3 * 86400000).toISOString(), buyAt = new Date(Date.now() - 2 * 86400000).toISOString();
  async function open(accountId, ownerId, cash, positions = []) {
    assert.equal((await writer.writeNativeMutation({ ownerUserId: ownerId }, { operationId: randomUUID(), accountId, expectedSequence: null, opening: { at: openingAt, cash: { USD: cash, KRW: "0" }, positions } })).status, "created");
  }
  if (unknownCost) {
    await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity) values($1,$2,$3,'one','Owned VOO','VOO','us','USD','etf',2)", [asset, owner, account]);
    await open(account, owner, "800", [{ assetId: asset, quantity: "2", currency: "USD", costLots: null }]);
  } else {
    await open(account, owner, "1000");
    assert.equal((await writer.writeNativeMutation({ ownerUserId: owner }, { operationId: randomUUID(), accountId: account, expectedSequence: 0,
      event: { type: "buy", at: buyAt, assetId: asset, quantity: "2", price: "100", currency: "USD" },
      newAsset: { id: asset, name: "Owned VOO", ticker: "VOO", market: "us", currency: "USD", assetType: "etf" } })).status, "created");
  }
  await open(peer, owner, "50"); await open(foreign, other, "400");
  const scope = accountId => ({ kind: "account", key: `account:${accountId}`, accountId, accountCode: accountId === account ? "one" : accountId === peer ? "two" : "foreign", label: "Test" });
  return { pg, writer, loader, service, engine, snapshots, config, calls, scope, state, listing, buyAt };
}

it("connects group membership SQL and tenant RLS to the same native writer, snapshot and currency engines", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner }, groupId = "55555555-5555-4555-8555-555555555555";
  const groupScope = { kind: "portfolio_group", key: `group:${groupId}`, portfolioGroupId: groupId, label: "Mixed group" };
  await f.pg.query("insert into portfolio_groups(id,canonical_owner_user_id,name) values($1,$2,'Mixed group')", [groupId, owner]);
  await f.pg.query("insert into portfolio_group_account_memberships(canonical_owner_user_id,portfolio_group_id,account_id,valid_from) values($1,$2,$3,'2026-09-01')", [owner, groupId, peer]);
  assert.equal(await f.writer.hasNativeLedger(tenant, groupScope), true, "whole-account group enters the real native route");
  assert.equal(await f.writer.hasNativeLedger({ ownerUserId: other }, groupScope), false);
  await assert.rejects(f.pg.query("insert into portfolio_group_account_memberships(canonical_owner_user_id,portfolio_group_id,account_id,valid_from) values($1,$2,$3,'2026-09-01')", [owner, groupId, foreign]), /foreign key/);
  await f.pg.query("insert into portfolio_group_asset_memberships(canonical_owner_user_id,portfolio_group_id,asset_id,valid_from) values($1,$2,$3,'2026-09-01')", [owner, groupId, asset]);
  for (let i = 0; i < 2; i++) { await f.loader.getTrackedCurrencyEvidence(tenant, { kind: "all", key: "all", label: "All" }, "KRW"); await f.service.drainTwelveDataService(f.config); }
  const all = await f.loader.getTrackedCurrencyEvidence(tenant, { kind: "all", key: "all", label: "All" }, "KRW", { collect: false });
  assert.equal((await f.snapshots.saveNativeSnapshots(tenant, all)).created, 2);
  const first = await f.loader.getTrackedCurrencyEvidence(tenant, groupScope, "USD", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(first).current.total, "300");
  assert.equal((await f.snapshots.saveNativeSnapshots(tenant, first)).status, "incomplete", "a group never writes an incomplete account snapshot");
  t.mock.timers.tick(26 * 3600000); f.state.price = "135"; f.state.fx = "1260";
  const dividend = { operationId: randomUUID(), accountId: account, expectedSequence: 1, event: { type: "dividend", assetId: asset, amount: "5", currency: "USD", at: new Date(Date.now() - 3600000).toISOString() } };
  assert.equal((await f.writer.writeNativeMutation(tenant, dividend)).status, "created");
  assert.equal((await f.writer.writeNativeMutation(tenant, dividend)).status, "existing");
  f.state.historicalRates[dividend.event.at] = "1260";
  await f.service.requestTwelveDataHistoricalFx({ requestedAt: [dividend.event.at], asOf: new Date().toISOString() }, f.config);
  await f.service.drainTwelveDataService(f.config);
  for (let i = 0; i < 3; i++) { await f.loader.getTrackedCurrencyEvidence(tenant, groupScope, "KRW"); await f.service.drainTwelveDataService(f.config); }
  const evidence = await f.loader.getTrackedCurrencyEvidence(tenant, groupScope, "USD", { collect: false });
  const usd = f.engine.buildTrackedCurrencyPortfolio(evidence), krw = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, reporting: "KRW" });
  assert.equal(usd.history[0].total, "300"); assert.equal(usd.current.total, "320");
  assert.equal(usd.movement.attribution.assetTradeFlow, "-5"); assert.equal(usd.movement.attribution.investmentChange, "25");
  assert.ok(Math.abs(usd.performanceReturn.totalReturn - 25 / (300 - 5 / 26)) < 1e-12);
  assert.equal(krw.history[0].total, "420000"); assert.equal(krw.current.total, "403200");
  assert.equal(krw.movement.attribution.investmentChange, "-10500");
  const again = await f.loader.getTrackedCurrencyEvidence(tenant, groupScope, "USD", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(again).current.total, "320");
  assert.equal((await f.writer.readNativeLedger(tenant)).entries.filter(row => row.operationId === dividend.operationId).length, 1);
  const foreignGroup = await f.loader.getTrackedCurrencyEvidence({ ownerUserId: other }, groupScope, "USD", { collect: false });
  assert.equal(foreignGroup.current.positions.length, 0, "other owner cannot read group membership or names");
  await f.pg.query("update portfolio_group_asset_memberships set valid_from='2026-09-13' where portfolio_group_id=$1", [groupId]);
  const future = await f.loader.getTrackedCurrencyEvidence(tenant, groupScope, "USD", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(future).current.total, "50");
});

it("runs native mutation through actual dashboard DAL, provider SQL evidence, snapshots and subsequent performance", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner };
  const first = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW");
  assert.equal(f.calls.length, 0, "demand never calls the HTTP boundary inline");
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(first).current.complete, false);
  const drained = await f.service.drainTwelveDataService(f.config);
  assert.equal(drained.failed, 0); assert.equal(drained.processed, 3);
  const unknown = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(unknown.current.positions.find(row => row.id === asset).observation, null, "unknown split coverage cannot prove quantity matches raw-price basis");
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW");
  assert.equal((await f.service.drainTwelveDataService(f.config)).processed, 1);
  const usd = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  const krw = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  const usdValue = f.engine.buildTrackedCurrencyPortfolio(usd), krwValue = f.engine.buildTrackedCurrencyPortfolio(krw);
  assert.equal(usdValue.current.total, "1050"); assert.equal(krwValue.current.total, "1470000");
  assert.equal(usdValue.current.positions.find(row => row.id === asset).cost, "200");
  assert.equal(krwValue.current.positions.find(row => row.id === asset).cost, "260000");
  assert.equal(usd.current.positions.find(row => row.id === asset).observation.source, "twelve_data:us:ARCX:VOO");
  assert.deepEqual((await f.pg.query("select distinct dataset from market_provider_observations order by dataset")).rows.map(row => row.dataset), ["us_daily_raw", "us_quote", "usd_krw", "usd_krw_history"]);
  assert.equal((await f.snapshots.saveNativeSnapshots(tenant, usd)).created, 1);
  const saved = (await f.pg.query("select native_evidence from daily_portfolio_snapshots where account_id=$1", [account])).rows[0].native_evidence;
  assert.match(saved.frame.positions.find(row => row.id === asset).observation.price, /^125(?:\.0+)?$/);
  assert.equal(saved.frame.positions.find(row => row.id === `cash:${account}:USD`).observation.quantity, "800");
  assert.equal(f.calls.length, 6, "read-only valuation and snapshot write do not collect");

  const peerValue = f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(peer), "USD", { collect: false }));
  assert.equal(peerValue.current.total, "50");
  const allValue = f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence(tenant, { kind: "all", key: "all", label: "All" }, "USD", { collect: false }));
  assert.equal(allValue.current.total, "1100");
  const otherValue = f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence({ ownerUserId: other }, { kind: "all", key: "all", label: "All" }, "USD", { collect: false }));
  assert.equal(otherValue.current.total, "400"); assert.ok(!otherValue.current.positions.some(row => row.name.includes("VOO")));
  const denied = await f.loader.getTrackedCurrencyEvidence({ ownerUserId: other }, f.scope(account), "USD", { collect: false });
  assert.deepEqual(denied.current.positions, []); assert.equal(denied.ledgerComplete, false); assert.deepEqual(denied.history, []);

  t.mock.timers.tick(25 * 3600000);
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 1, event: { type: "deposit", at: new Date().toISOString(), amount: "100", currency: "USD" } })).status, "created");
  t.mock.timers.tick(3600000); f.state.price = "130"; f.state.fx = "1500";
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const expired = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(expired.current.positions.find(row => row.id === asset).observation, null, "expired action coverage blocks only the holding");
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const next = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  const nextKrw = f.engine.buildTrackedCurrencyPortfolio(next), nextUsd = f.engine.buildTrackedCurrencyPortfolio({ ...next, reporting: "USD" });
  assert.equal(nextUsd.current.total, "1160"); assert.equal(nextUsd.history[0].total, "1050");
  assert.equal(nextUsd.movement.attribution.assetTradeFlow, "100"); assert.equal(nextUsd.movement.attribution.investmentChange, "10");
  assert.equal(nextUsd.performanceReturn.status, "ready"); assert.ok(Math.abs(nextUsd.performanceReturn.totalReturn - 10 / (1050 + 100 / 26)) < 1e-12);
  assert.equal(nextKrw.current.total, "1740000"); assert.equal(nextKrw.history[0].total, "1470000", "stored spot FX remains evidence of the original capture");
  assert.equal(nextKrw.performanceReturn.status, "ready");
  assert.deepEqual((await f.pg.query("select native_evidence from daily_portfolio_snapshots where account_id=$1", [account])).rows[0].native_evidence, saved, "subsequent reads never rewrite original snapshots");
});

it("limits missing dated FX, stale FX and conflicting quote effects to the actual dependent metrics", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner };
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW"); await f.service.drainTwelveDataService(f.config);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW"); await f.service.drainTwelveDataService(f.config);
  await f.pg.exec("delete from market_provider_observations where dataset='usd_krw_history'");
  const missingCost = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  const missingCostKrw = f.engine.buildTrackedCurrencyPortfolio(missingCost);
  assert.equal(missingCostKrw.current.total, "1470000"); assert.equal(missingCostKrw.current.positions.find(row => row.id === asset).cost, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio({ ...missingCost, reporting: "USD" }).current.positions.find(row => row.id === asset).cost, "200");
  await f.pg.exec("update market_provider_observations set observed_at=observed_at-interval '4 days' where dataset='usd_krw'");
  const stale = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(stale).current.total, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio({ ...stale, reporting: "USD" }).current.total, "1050");
  await f.pg.exec("delete from market_provider_observations where dataset='usd_krw'");
  const missing = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(missing).current.total, null); assert.equal(f.engine.buildTrackedCurrencyPortfolio({ ...missing, reporting: "USD" }).current.total, "1050");
  // Reuse the original quote observation with a different value through the actual worker.
  f.state.timestamp = Math.floor((Date.now() - 25 * 3600000) / 1000); f.state.price = "126";
  t.mock.timers.tick(20 * 60000);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 1);
  const conflict = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(conflict.current.positions.find(row => row.id === asset).observation, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(conflict).current.total, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(conflict).current.verifiedSubtotal, "800");
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(peer), "USD", { collect: false })).current.total, "50");
});

it("quarantines an admitted split until the owner records the matching ratio without applying it twice", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner };
  f.state.splits = [{ date: "2026-09-10", ratio: 0.5, from_factor: 2, to_factor: 1 }];
  t.mock.timers.tick(86400000);
  f.state.price = "62.5";
  const target = f.service.resolveTwelveDataTarget({ ticker: "VOO", market: "us", currency: "USD" }, f.config).target;
  await f.service.requestTwelveDataEvidence({ kind: "history", target, startDate: "2026-09-09", endDate: "2026-09-10", asOf: new Date().toISOString() }, f.config);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const blocked = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(blocked.current.positions.find(row => row.id === asset).observation, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(blocked).current.total, null);
  assert.equal((await f.pg.query("select quantity::text as quantity from assets where id=$1", [asset])).rows[0].quantity, "2.000000");
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 1, event: { type: "split", at: "2026-09-10T15:00:00.000Z", assetId: asset, ratio: { n: "2", d: "1" } } })).status, "created");
  const matched = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(matched.current.positions.find(row => row.id === asset).observation.quantity, "4.000000");
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(matched).current.total, "1050");
  await f.pg.exec("update market_provider_action_coverage set status='conflict' where action_type='split'");
  const conflict = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(conflict.current.positions.find(row => row.id === asset).observation, null);
});

it("values closed recorded sales from original acquisition and sale FX while keeping fees separate", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner }, soldAt = new Date(Date.now() - 86400000).toISOString();
  f.state.historicalRates[soldAt] = "1400";
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 1,
    event: { type: "sell", at: soldAt, assetId: asset, quantity: "2", price: "110", currency: "USD", fee: { amount: "1", currency: "USD" } } })).status, "created");
  const missing = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(missing).realizedPnl.total, null);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio({ ...missing, reporting: "USD" }).realizedPnl.total, "20");
  assert.equal(missing.current.positions.some(row => row.id === asset), false, "closed holding is absent from current dashboard assets");
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const evidence = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "KRW", { collect: false });
  const krw = f.engine.buildTrackedCurrencyPortfolio(evidence), usd = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, reporting: "USD" });
  assert.equal(krw.realizedPnl.total, "48000"); assert.equal(usd.realizedPnl.total, "20");
  assert.equal(krw.realizedPnl.rows[0].proceeds, "308000"); assert.equal(krw.realizedPnl.rows[0].cost, "260000");
  assert.equal(usd.current.total, "1019", "the USD1 fee remains in cash accounting, outside gross realized P&L");
  assert.ok(f.calls.filter(call => call.endpoint === "/exchange_rate" && call.parameters.date).some(call => `${call.parameters.date}.000Z` === soldAt));
  assert.ok(f.calls.filter(call => call.endpoint === "/exchange_rate" && call.parameters.date).some(call => `${call.parameters.date}.000Z` === f.buyAt));
  const foreignEvidence = await f.loader.getTrackedCurrencyEvidence({ ownerUserId: other }, { kind: "all", key: "all", label: "All" }, "USD", { collect: false });
  assert.deepEqual(f.engine.buildTrackedCurrencyPortfolio(foreignEvidence).realizedPnl.rows, []);
  const contaminated = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, realizedTrades: evidence.realizedTrades.map(row => ({ ...row, ownerId: other })) });
  assert.equal(contaminated.status, "blocked"); assert.equal(contaminated.reason, "owner_scope_mismatch");
  const duplicate = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, realizedTrades: [...evidence.realizedTrades, ...evidence.realizedTrades] });
  assert.equal(duplicate.realizedPnl.total, null); assert.equal(duplicate.realizedPnl.verifiedSubtotal, "0");
  const future = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, realizedTrades: evidence.realizedTrades.map(row => ({ ...row, at: new Date(Date.now() + 1000).toISOString() })) });
  assert.equal(future.realizedPnl.total, null); assert.equal(future.realizedPnl.rows[0].reason, "invalid_recorded_sale");
  const spotOnly = f.engine.buildTrackedCurrencyPortfolio({ ...evidence, fx: [{ base: "USD", quote: "KRW", rate: "1400", observedAt: f.buyAt, fetchedAt: soldAt, source: "twelve_data", kind: "spot" }] });
  assert.equal(spotOnly.realizedPnl.total, null, "undesignated current spot cannot patch historical sale or acquisition rates");
});

it("keeps an unknown disposed cost missing after a later basis entry for the remaining shares", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture({ unknownCost: true }), tenant = { ownerUserId: owner };
  const firstSaleAt = new Date(Date.now() - 86400000).toISOString(), basisAt = new Date(Date.now() - 12 * 3600000).toISOString(), lastSaleAt = new Date(Date.now() - 6 * 3600000).toISOString();
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 0,
    event: { type: "sell", at: firstSaleAt, assetId: asset, quantity: "1", price: "110", currency: "USD" } })).status, "created");
  const first = (await f.pg.query("select native_data->'effect'->'realized' as realized from event_ledger_entries where native_data->'event'->>'type'='sell'")).rows[0].realized;
  assert.equal(first.disposedCostLots, null);
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 1,
    event: { type: "cost_basis", at: basisAt, assetId: asset, costLots: [{ amount: "100", currency: "USD", at: f.buyAt, source: "user_native_ledger", remaining: { n: "1", d: "1" } }] } })).status, "created");
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 2,
    event: { type: "sell", at: lastSaleAt, assetId: asset, quantity: "1", price: "120", currency: "USD" } })).status, "created");
  const report = f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false }));
  assert.equal(report.realizedPnl.total, null); assert.equal(report.realizedPnl.verifiedSubtotal, "20");
  assert.equal(report.realizedPnl.rows.find(row => row.at === firstSaleAt).reason, "missing_cost_evidence");
  assert.equal(report.realizedPnl.rows.find(row => row.at === lastSaleAt).pnl, "20");
  assert.deepEqual((await f.pg.query("select native_data->'effect'->'realized' as realized from event_ledger_entries where native_data->'event'->>'at'=$1", [firstSaleAt])).rows[0].realized, first);
});

for (const actionCase of [
  { name: "2-for-1 split", from: "2", to: "1", price: "62.5", quantity: "4.000000" },
  { name: "1-for-2 reverse split", from: "1", to: "2", price: "250", quantity: "1.000000" },
]) it(`keeps a same-day ${actionCase.name} provisional, then reconciles late and duplicate actions once`, async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 10, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner };
  f.config.storage.retentionSeconds = 3 * 86400;
  f.state.price = actionCase.price; f.state.timestamp = Date.UTC(2026, 8, 10, 21) / 1000;
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  await f.service.drainTwelveDataService(f.config);
  const pending = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  assert.equal(pending.current.positions.find(row => row.id === asset).evidenceReason, "corporate_actions_pending");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const target = f.service.resolveTwelveDataTarget({ ticker: "VOO", market: "us", currency: "USD" }, f.config).target;
  const window = { target, startDate: "2026-09-09", endDate: "2026-09-10", asOf: new Date().toISOString() };
  const initialKnowledge = window.asOf;
  assert.equal((await f.service.readTwelveDataSplitRisk(window, f.config)).status, "provisional");
  assert.equal(f.calls.some(call => call.endpoint === "/time_series"), false, "same-day action job never requests an unfinished daily bar");
  const provisional = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(provisional).current.total, null);
  assert.equal(provisional.current.positions.find(row => row.id === asset).evidenceReason, "corporate_actions_provisional");
  assert.deepEqual(await f.snapshots.saveNativeSnapshots(tenant, provisional), { status: "incomplete", created: 0 });
  const event = { date: "2026-09-10", from_factor: actionCase.from, to_factor: actionCase.to };
  f.state.splits = [event, { ...event, from_factor: `${actionCase.from}.0`, to_factor: `${actionCase.to}.000` }];
  t.mock.timers.tick(11 * 60000);
  await f.service.requestTwelveDataSplitRisk({ ...window, asOf: new Date().toISOString() }, f.config);
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const late = await f.service.readTwelveDataSplitRisk({ ...window, asOf: new Date().toISOString() }, f.config);
  assert.equal(late.status, "provisional"); assert.equal(late.actions.length, 1, "duplicate vendor rows normalize to one event");
  assert.deepEqual((await f.service.readTwelveDataSplitRisk({ ...window, asOf: initialKnowledge }, f.config)).actions, [], "later knowledge does not rewrite the earlier empty response");
  const operation = { operationId: randomUUID(), accountId: account, expectedSequence: 1, event: { type: "split", at: "2026-09-10T15:00:00.000Z", assetId: asset, ratio: { n: actionCase.from, d: actionCase.to } } };
  assert.equal((await f.writer.writeNativeMutation(tenant, operation)).status, "created");
  assert.equal((await f.writer.writeNativeMutation(tenant, operation)).status, "existing");
  t.mock.timers.tick(8 * 3600000);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD");
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const confirmed = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(confirmed.current.positions.find(row => row.id === asset).observation.quantity, actionCase.quantity);
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(confirmed).current.total, "1050", "raw price and owner quantity apply exactly one split");
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(confirmed).current.positions.find(row => row.id === asset).cost, "200");
  assert.equal((await f.snapshots.saveNativeSnapshots(tenant, confirmed)).created, 1);
  assert.equal((await f.service.readTwelveDataSplitRisk({ ...window, asOf: new Date().toISOString() }, f.config)).actions.length, 1);
  t.mock.timers.tick(24 * 3600000);
  await f.service.requestTwelveDataEvidence({ kind: "history", target, startDate: "2026-09-09", endDate: "2026-09-11", asOf: new Date().toISOString() }, f.config);
  assert.equal((await f.service.drainTwelveDataService(f.config)).failed, 0);
  const widened = await f.service.readTwelveDataSplitRisk({ ...window, endDate: "2026-09-11", asOf: new Date().toISOString() }, f.config);
  assert.equal(widened.status, "admitted", "newer complete coverage supersedes an older provisional overlapping window");
  assert.equal(widened.actions.length, 1);
});

it("holds an owner action ahead of its price and never automatically books provider cash dividends", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 11, 22) });
  const f = await fixture(), tenant = { ownerUserId: owner };
  f.state.splits = [{ date: "2026-09-10", from_factor: 2, to_factor: 1 }];
  f.state.dividends = [{ ex_date: "2026-09-10", amount: "1" }, { ex_date: "2026-09-10", amount: "1.00" }];
  f.state.timestamp = Date.UTC(2026, 8, 10, 14) / 1000;
  assert.equal((await f.writer.writeNativeMutation(tenant, { operationId: randomUUID(), accountId: account, expectedSequence: 1, event: { type: "split", at: "2026-09-10T15:00:00.000Z", assetId: asset, ratio: { n: "2", d: "1" } } })).status, "created");
  const target = f.service.resolveTwelveDataTarget({ ticker: "VOO", market: "us", currency: "USD" }, f.config).target;
  await f.service.requestTwelveDataEvidence({ kind: "history", target, startDate: "2026-09-10", endDate: "2026-09-10", asOf: new Date().toISOString() }, f.config);
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD"); await f.service.drainTwelveDataService(f.config);
  const beforePrice = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(beforePrice.current.positions.find(row => row.id === asset).evidenceReason, "corporate_action_price_pending");
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(beforePrice).current.total, null);
  t.mock.timers.tick(11 * 60000); f.state.timestamp = Date.UTC(2026, 8, 10, 21) / 1000; f.state.price = "62.5";
  await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD"); await f.service.drainTwelveDataService(f.config);
  const priced = await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false });
  assert.equal(f.engine.buildTrackedCurrencyPortfolio(priced).current.total, "1050", "provider cash-per-share never creates an account cash credit");
  assert.equal((await f.snapshots.saveNativeSnapshots(tenant, priced)).created, 1);
  t.mock.timers.tick(60 * 1000);
  const dividend = { operationId: randomUUID(), accountId: account, expectedSequence: 2, event: { type: "dividend", at: new Date().toISOString(), assetId: asset, amount: "4", currency: "USD" } };
  assert.equal((await f.writer.writeNativeMutation(tenant, dividend)).status, "created");
  assert.equal((await f.writer.writeNativeMutation(tenant, dividend)).status, "existing");
  const paid = f.engine.buildTrackedCurrencyPortfolio(await f.loader.getTrackedCurrencyEvidence(tenant, f.scope(account), "USD", { collect: false }));
  assert.equal(paid.current.total, "1054");
  assert.equal(paid.performanceReturn.status, "ready");
  assert.ok(Math.abs(paid.performanceReturn.totalReturn - 4 / 1050) < 1e-12, "recorded cash dividend enters performance once on a raw-price series");
});
