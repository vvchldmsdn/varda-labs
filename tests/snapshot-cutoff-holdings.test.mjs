import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { holdingsChangedAfterCutoff, eventsChangedAfterCutoff } from "../src/lib/snapshots/cutoff-holdings.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const cutoff = new Date("2026-09-09T22:00:00Z");
const holding = (overrides = {}) => ({id: "owned", createdAt: "2026-08-16T00:00:00Z",
  updatedAt: "2026-08-16T00:00:00Z", ...overrides});
describe("snapshot holding cutoff evidence", () => {
  it("permits unchanged holdings in a delayed snapshot and preserves the exact boundary", () => {
    assert.deepEqual(holdingsChangedAfterCutoff([holding(), holding({updatedAt: cutoff})], cutoff), []);
  });
  it("does not backdate a new user's 08:43 registration to the 07:00 snapshot", () => {
    assert.deepEqual(holdingsChangedAfterCutoff([holding({createdAt: "2026-09-09T23:43:00Z",
      updatedAt: "2026-09-09T23:43:00Z"})], cutoff), ["owned"]);
  });
  it("does not write a later quantity or cost correction as an earlier position", () => {
    assert.deepEqual(holdingsChangedAfterCutoff([holding({updatedAt: "2026-09-10T00:10:00Z"})], cutoff), ["owned"]);
    assert.deepEqual(holdingsChangedAfterCutoff([holding({updatedAt: "invalid"})], cutoff), ["owned"]);
  });
  it("rejects a ledger-only creation or correction after cutoff", () => {
    assert.deepEqual(eventsChangedAfterCutoff([holding({id: "ledger-created", createdAt: "2026-09-10T00:10:00Z"}),
      holding({id: "ledger-corrected", updatedAt: "2026-09-10T00:10:00Z"})], cutoff), ["ledger-created", "ledger-corrected"]);
  });
});

describe("daily snapshot cutoff admission through actual server code", () => {
  it("includes an asset archived after cutoff in the guard instead of silently omitting it", async t => {
    const f = await snapshotFixture(t, { changed: { archivedAt: "2026-09-09T23:43:00Z", updatedAt: "2026-09-09T23:43:00Z" } });
    await assert.rejects(f.run(), error => error.code === "holdings_changed_after_cutoff" && error.details.assetIds.includes("changed"));
    assert.equal(f.writes.length, 0);
  });

  it("checks a position reduced to zero before selecting the current open positions", async t => {
    const f = await snapshotFixture(t, { changed: { quantity: "0", updatedAt: "2026-09-09T23:43:00Z" } });
    await assert.rejects(f.run(), error => error.code === "holdings_changed_after_cutoff" && error.details.assetIds.includes("changed"));
    assert.equal(f.writes.length, 0);
  });

  it("keeps earlier archived assets outside current valuation and ignores another requested account's changes", async t => {
    const f = await snapshotFixture(t, { changed: { account: "acct1", accountId: "account-1", quantity: "0", updatedAt: "2026-09-09T23:43:00Z" },
      archived: true, events: [{ account: "acct1", updatedAt: "2026-09-09T23:43:00Z" }] });
    const result = await f.run({ account: "acct0" });
    assert.equal(result.ok, true);
    const positions = f.writes.filter(write => write.table === "daily_position_snapshots").flatMap(write => write.rows);
    assert.deepEqual(positions.map(row => row.assetId), ["open"]);
    assert.equal(result.results.acct0.totalMarketValue, 210);
  });

  it("blocks ledger-only changes before writing either positions or portfolio totals", async t => {
    for (const timestamps of [
      { createdAt: "2026-09-09T23:43:00Z" },
      { updatedAt: "2026-09-09T23:43:00Z" },
    ]) {
      const f = await snapshotFixture(t, { events: [timestamps] });
      await assert.rejects(f.run(), error => error.code === "event_changed_after_cutoff" && error.details.eventIds.includes("event-0"));
      assert.equal(f.writes.length, 0);
    }
  });

  it("does not admit a sample close as an official cutoff fallback", async t => {
    const f = await snapshotFixture(t, { sampleClose: true });
    const preflight = await f.run({ dryRun: true });
    assert.equal(preflight.freshClose.missingCount, 1);
    assert.equal(preflight.writeReady, false);
    await assert.rejects(f.run(), error => error.code === "missing_fresh_closes");
    assert.equal(f.writes.length, 0);
  });
});

async function snapshotFixture(t, { changed, archived = false, events = [], sampleClose = false } = {}) {
  const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const now = new Date("2026-09-10T00:00:00Z");
  const base = {
    ...holding(), id: "open", canonicalOwnerUserId: owner, legacyBase44Id: null, archivedAt: null,
    name: "Holding", ticker: "005930", market: "korea", currency: "KRW", assetType: "stock", category: null,
    account: "acct0", accountId: "account-0", quantity: "2", currentPrice: "100", averageCost: "80",
    fractionalKrwValue: null, fractionalAvgCost: null, groupId: null, targetWeight: null, maAssetClass: null,
  };
  const holdings = [base, ...(changed ? [{ ...base, id: "changed", ticker: "000660", ...changed }] : []),
    ...(archived ? [{ ...base, id: "archived", archivedAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" }] : [])];
  const accounts = [0, 1].map(index => ({ id: `account-${index}`, canonicalOwnerUserId: owner, code: `acct${index}`,
    name: `Account ${index}`, accountType: "investment", currency: "KRW", isActive: true }));
  const priceRows = holdings.map(row => ({ ...row, id: `price-${row.id}`, priceDate: "2026-09-09", closePrice: "105",
    isSample: sampleClose, source: "kis", fetchedAt: now }));
  const rowsByTable = {
    accounts, assets: holdings,
    fx_rates: [{ rateDate: "2026-09-09", usdKrw: "1337.5", source: "test", status: "ok", isSample: false, fetchedAt: "2026-09-09T13:24:00Z" }],
    asset_price_snapshots: priceRows,
    event_ledger_entries: events.map((event, index) => ({ ...holding(), id: `event-${index}`, account: "acct0",
      accountId: "account-0", eventType: "manual_adjustment", eventDate: "2026-09-09", assetId: "open", ...event })),
  };
  // Execute the actual Drizzle WHERE expressions for lifecycle and price
  // admission in Postgres; a mock that ignores predicates would miss both bugs.
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create table accounts(id text, code text, canonical_owner_user_id uuid, is_active boolean, account_type text);
    create table assets(id text, account_id text, archived_at timestamptz);
    create table asset_price_snapshots(id text, market text, currency text, ticker text, is_sample boolean);`);
  for (const account of accounts) await pg.query("insert into accounts values($1,$2,$3,$4,$5)", [account.id, account.code, owner, true, "investment"]);
  for (const asset of holdings) await pg.query("insert into assets values($1,$2,$3)", [asset.id, asset.accountId, asset.archivedAt]);
  for (const price of priceRows) await pg.query("insert into asset_price_snapshots values($1,$2,$3,$4,$5)", [price.id, price.market, price.currency, price.ticker, price.isSample]);
  const dialect = new PgDialect(), writes = [];
  const selection = () => {
    let table, condition;
    const query = {
      from(value) { table = getTableName(value); return query; },
      where(value) { condition = value; return query; }, innerJoin() { return query; }, orderBy() { return query; }, limit() { return query; },
      async then(resolve, reject) {
        try {
          let rows = rowsByTable[table] ?? [];
          if (table === "assets" || table === "asset_price_snapshots") {
            const built = dialect.sqlToQuery(condition);
            const source = table === "assets" ? "assets inner join accounts on assets.account_id=accounts.id" : table;
            const result = await pg.query(`select ${table}.id from ${source} where ${built.sql}`, built.params);
            const ids = new Set(result.rows.map(row => row.id));
            rows = rows.filter(row => ids.has(row.id));
          }
          return resolve(rows);
        } catch (error) { return reject(error); }
      },
    };
    return query;
  };
  const [module] = await importWithPorts(["src/lib/snapshots/daily.ts"], { "@/db/client": { db: {
    select: selection, selectDistinct: selection,
    insert: table => ({ values: rows => { writes.push({ table: getTableName(table), rows: Array.isArray(rows) ? rows : [rows] }); return {}; } }),
    batch: async () => [],
  } } });
  return { writes, run: options => module.runDailySnapshot({ tenantContext: { ownerUserId: owner }, now, dryRun: false, ...options }) };
}
