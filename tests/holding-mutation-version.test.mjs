import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isHoldingMutationVersion } from "../src/lib/holding-mutation-version.ts";
import { parseHoldingStateCorrectionInput } from "../src/lib/holding-state-correction.ts";
import { parseHoldingArchiveInput, parseHoldingRestoreInput } from "../src/lib/holding-lifecycle.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = "11111111-1111-4111-8111-111111111111";
const asset = "22222222-2222-4222-8222-222222222222";
const initialVersion = "2026-09-10T01:02:03.123456Z";
const scope = { kind: "all", key: "all", label: "All" };
const tenantContext = { ownerUserId: owner };

function form(version, averageCost = "100") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ assetId: asset, expectedUpdatedAt: version, quantity: "2", averageCost, archiveConfirmed: "yes" })) data.set(key, value);
  return data;
}

describe("holding mutation version parsing", () => {
  it("keeps PostgreSQL microseconds and compatible millisecond tokens unchanged", () => {
    for (const version of [initialVersion, "2026-09-10T01:02:03.000001Z", "2026-09-10T01:02:03.123Z"]) {
      assert.equal(isHoldingMutationVersion(version), true);
      for (const parse of [parseHoldingStateCorrectionInput, parseHoldingArchiveInput, parseHoldingRestoreInput]) {
        const parsed = parse(form(version));
        assert.equal(parsed.ok, true);
        assert.equal(parsed.input.expectedUpdatedAt, version);
      }
    }
  });

  it("rejects rollover dates, offsets and unsupported precision without normalizing them", () => {
    for (const version of [
      null, new Date(initialVersion), "2026-09-10", "2026-09-10T01:02:03Z",
      "2026-09-10T01:02:03.1234Z", "2026-09-10T01:02:03.1234567Z",
      "2026-09-10T01:02:03.123456+00:00", "2026-02-29T01:02:03.123456Z",
      "2026-09-10T24:02:03.123456Z", "2026-09-10T01:02:60.123456Z",
    ]) assert.equal(isHoldingMutationVersion(version), false);
    for (const version of ["2026-02-30T01:02:03.123456Z", "2026-09-10T01:02:03.1234567Z"]) {
      for (const parse of [parseHoldingStateCorrectionInput, parseHoldingArchiveInput, parseHoldingRestoreInput]) assert.equal(parse(form(version)).ok, false);
    }
  });
});

let database;
async function fixture() {
  const pg = database ??= new PGlite();
  const sqlErrors = [];
  await pg.exec("drop schema public cascade; create schema public;" + DDL);
  // The mutation token must be UTC independently of the database session timezone.
  await pg.exec("set timezone = 'Asia/Seoul'");
  await pg.query("insert into accounts values ($1, $2, 'brokerage', 'Brokerage', 0, true)", [account, owner]);
  await pg.query("insert into assets (id, account_id, canonical_owner_user_id, account, name, ticker, asset_type, market, currency, quantity, average_cost, current_price, updated_at) values ($1,$2,$3,'brokerage','Fixture','005930','stock','korea','KRW',2,null,110,$4)", [asset, account, owner, initialVersion]);
  const sqlClient = {
    async transaction(build) {
      const commands = build({ query: (text, params = []) => ({ text, params }) });
      return pg.transaction(async (tx) => {
        const result = [];
        for (const command of commands) result.push((await tx.query(command.text, command.params)).rows);
        return result;
      });
    },
  };
  const [read, correction, lifecycle] = await importWithPorts([
    "src/db/queries/tenant-holdings.ts", "src/lib/holding-state-correction-write.ts", "src/lib/holding-lifecycle-write.ts",
  ], {
    "@/db/client": { sqlClient },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext }) },
    "@/db/queries/portfolio-analysis-scope-targets": { getPortfolioAnalysisScopeTargets: async () => { throw new Error("Not needed for all scope"); } },
    "@/db/tenant-transaction-context": { runTenantReadTransaction: async (ownerUserId, build) => {
      assert.equal(ownerUserId, owner);
      return sqlClient.transaction(build);
    } },
    "@/lib/portfolio-mutation-transaction": { runPortfolioMutation: async (ownerUserId, text, params) => {
      assert.equal(ownerUserId, owner);
      try { return await pg.transaction(async (tx) => (await tx.query(text, params)).rows); }
      catch (error) { sqlErrors.push({ code: error.code, message: error.message }); throw error; }
    } },
  });
  async function holding() {
    const result = await read.getReadOnlyTenantHoldings({ scope, tenantContext, serviceDate: "2026-09-10" });
    assert.equal(result.state, "ready");
    assert.equal(result.holdings.length, 1);
    return result.holdings[0];
  }
  return { pg, correction, lifecycle, holding, sqlErrors };
}

describe("holding mutation version SQL round trips", () => {
  after(async () => { await database?.close(); });

  it("adds missing cost and permits a second correction without changing valuation or inventing trades", async () => {
    const f = await fixture();
    const before = await f.holding();
    assert.equal(before.updatedAt, initialVersion);
    assert.equal(before.averageCost, null);
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form(before.updatedAt))).status, "success");
    const first = await f.holding();
    assert.match(first.updatedAt, /\.\d{6}Z$/);
    assert.notEqual(first.updatedAt, before.updatedAt);
    assert.equal(Number(first.averageCost), 100);
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form(first.updatedAt, "101"))).status, "success");
    const second = await f.holding();
    assert.equal(Number(second.averageCost), 101);
    assert.equal(second.quantity, before.quantity);
    assert.equal(second.currentPrice, before.currentPrice);
    const audit = (await f.pg.query("select previous_average_cost::text, corrected_average_cost::text from holding_state_corrections order by corrected_at")).rows;
    assert.equal(audit.length, 2);
    assert.equal(audit[0].previous_average_cost, null);
    assert.equal(Number(audit[1].corrected_average_cost), 101);
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form(second.updatedAt, "101"))).status, "invalid");
    // The fixture contains no trade, cash-flow or snapshot tables: those writes would fail.
    assert.equal((await f.pg.query("select count(*)::int as n from holding_state_corrections")).rows[0].n, 2);
  });

  it("rejects a stale version only one microsecond behind the stored row", async () => {
    const f = await fixture();
    const before = await f.holding();
    await f.pg.query("update assets set updated_at = updated_at + interval '1 microsecond' where id = $1", [asset]);
    const current = await f.holding();
    assert.equal(current.updatedAt, "2026-09-10T01:02:03.123457Z");
    assert.equal(new Date(current.updatedAt).getTime(), new Date(before.updatedAt).getTime());
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form(before.updatedAt))).status, "conflict");
    assert.equal((await f.lifecycle.archiveSessionHolding(form(before.updatedAt))).status, "conflict");
    assert.equal((await f.holding()).averageCost, null);
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form(current.updatedAt))).status, "success");
  });

  it("archives and restores with exact versions and rejects stale restore tokens", async () => {
    const f = await fixture();
    assert.equal((await f.correction.writeSessionHoldingStateCorrection(form((await f.holding()).updatedAt))).status, "success");
    const corrected = await f.holding();
    assert.equal((await f.lifecycle.archiveSessionHolding(form(corrected.updatedAt))).status, "success");
    const archived = await f.holding();
    assert.notEqual(archived.archivedAt, null);
    assert.equal((await f.lifecycle.restoreSessionHolding(form(corrected.updatedAt))).status, "conflict", JSON.stringify(f.sqlErrors));
    assert.equal((await f.lifecycle.restoreSessionHolding(form(archived.updatedAt))).status, "success");
    const restored = await f.holding();
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.quantity, corrected.quantity);
    assert.equal(restored.averageCost, corrected.averageCost);
    assert.equal((await f.pg.query("select event_type from holding_lifecycle_events order by occurred_at")).rows.map(row => row.event_type).join(","), "archived,restored");
  });
});

const DDL = `
create table accounts (id uuid primary key, canonical_owner_user_id uuid not null, code text not null, name text not null, sort_order integer not null, is_active boolean not null);
create table assets (
  id uuid primary key, account_id uuid not null, canonical_owner_user_id uuid not null, account text not null,
  name text not null, ticker text, asset_type text, market text not null, currency text not null,
  quantity numeric(20,6) not null, average_cost numeric(20,4), current_price numeric(20,4) not null,
  price_source text, price_as_of timestamptz, price_status text, archived_at timestamptz, updated_at timestamptz not null
);
create table holding_state_corrections (
  id uuid primary key default gen_random_uuid(), canonical_owner_user_id uuid, asset_id uuid, account_id uuid,
  previous_quantity numeric, corrected_quantity numeric, previous_average_cost numeric, corrected_average_cost numeric,
  previous_asset_updated_at timestamptz, corrected_asset_updated_at timestamptz, reason text, policy_version text, corrected_at timestamptz
);
create table portfolio_group_asset_memberships (id uuid primary key, asset_id uuid, canonical_owner_user_id uuid, valid_from date, valid_to date);
create table holding_lifecycle_events (
  id uuid primary key default gen_random_uuid(), canonical_owner_user_id uuid, asset_id uuid, account_id uuid, event_type text,
  previous_archived_at timestamptz, resulting_archived_at timestamptz, previous_asset_updated_at timestamptz,
  resulting_asset_updated_at timestamptz, reason text, policy_version text, occurred_at timestamptz
);
`;
