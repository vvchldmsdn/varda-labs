import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

test("full and recent ALL use only a complete, owned same-market-day close; account history stays scoped", async () => {
  const pg = new PGlite();
  try {
    const owner = randomUUID(), foreignOwner = randomUUID();
    const [brokerage, isa, irp] = Array.from({ length: 3 }, randomUUID);
    const source = "varda_manual_daily_snapshot", imported = "base44_import";
    const evidence = "a".repeat(64);
    await pg.exec(`
      create table accounts(id uuid primary key, canonical_owner_user_id uuid, code text, sort_order int, is_active bool,
        account_type text default 'investment', created_at timestamptz default '2026-01-01');
      create table daily_position_snapshots(account_id uuid, canonical_owner_user_id uuid, source text, snapshot_date date, is_sample bool);
      create table event_ledger_entries(account_id uuid, canonical_owner_user_id uuid, event_date date, is_sample bool);
      create table daily_portfolio_snapshots(id uuid default gen_random_uuid(), canonical_owner_user_id uuid, account_id uuid,
        account text, snapshot_date date, source text, rule_version text, cycle_end_at timestamptz, description text,
        captured_at timestamptz default now(), created_at timestamptz default now(), updated_at timestamptz default now(),
        closing_performance jsonb, total_market_value numeric, total_cost numeric, total_pnl numeric, total_return_pct numeric,
        cash_value numeric, invested_amount numeric, is_sample bool default false);
      create table broker_recovery_batches(canonical_owner_user_id uuid, account_id uuid, manifest jsonb, recorded_at timestamptz);
      create table native_ledger_revisions(canonical_owner_user_id uuid, account_id uuid, affected_at timestamptz,
        marker_sequence int, recorded_at timestamptz);`);
    await pg.query("select set_config('app.current_user_id', $1, false)", [owner]);
    const scopes = [{ kind: "all", key: "all" }];
    for (const [id, code] of [[brokerage, "brokerage"], [isa, "isa"], [irp, "irp"]]) {
      await pg.query("insert into accounts values($1,$2,$3,0,true)", [id, owner, code]);
      scopes.push({ kind: "account", accountId: id, accountCode: code, key: "account:" + id });
    }
    const laterAccount = randomUUID();
    await pg.query("insert into accounts values($1,$2,'later',1,true,'investment','2026-10-30'),($3,$2,'cash',2,true,'cash','2026-01-01')",
      [laterAccount, owner, randomUUID()]);
    async function add(accountId, account, date, sourceKey, value, rule = null, description = null) {
      await pg.query(`insert into daily_portfolio_snapshots
        (account_id, account, canonical_owner_user_id, snapshot_date, source, total_market_value,
          cycle_end_at, rule_version, description, closing_performance)
        values($1,$2,$3,$4,$5,$6,($4::date+time '07:00') at time zone 'Asia/Seoul',$7,$8,$9)`,
        [accountId, account, owner, date, sourceKey, value, rule, description,
          rule === "broker_account_review_close_v1" ? { reviewEvidenceHash: evidence } : null]);
    }
    for (const [storage, market, siblingSource] of [
      ["2026-07-02", "2026-07-01", imported], ["2026-07-03", "2026-07-02", source],
    ]) {
      await add(brokerage, "brokerage", storage, source, 100, "broker_account_review_close_v1");
      // A complete import at the same market date competes with the repaired close.
      await add(brokerage, "brokerage", market, imported, 90);
      for (const [id, code, amount] of [[isa, "isa", 10], [irp, "irp", 20]]) {
        await add(id, code, market, imported, amount);
        if (siblingSource === source) await add(id, code, storage, source, amount);
      }
      await add(null, "all", storage, source, 130, "broker_account_review_aggregate_v1",
        `accounts=3; other_component_source=${siblingSource}; review_hash=${evidence}`);
    }
    const [reader, observations] = await importWithPorts(
      ["src/lib/cairn-v2/history-read.ts", "src/lib/cairn-v2/history-observations.ts"], {
        "@/db/tenant-transaction-context": { runTenantReadTransaction: async (_, build) =>
          Promise.all(build({ query: async (statement, values) => (await pg.query(statement, values)).rows })) },
        "@/db/queries/tenant-group-reads": { loadTenantPortfolioGroupMemberships: async () => assert.fail() },
        "@/db/queries/account-history-review": { readAccountHistoryReview: async () => null },
      });
    const read = (scope, historyWindow) => reader.getBetaHistoryRead({
      scope, analysisScopes: scopes, tenantContext: { ownerUserId: owner }, historyWindow,
    });
    const rows = async (scope, window) => {
      const result = await read(scope, window);
      assert.equal(result.readStatus, "ready");
      return result.portfolioRows;
    };
    for (const window of [undefined, "recent"]) {
      const all = await rows(scopes[0], window);
      assert.deepEqual(all.filter(r => r.rowKind === "stored").map(r => [r.valuationDate, r.totalMarketValue]).sort(),
        [["2026-07-01", 130], ["2026-07-02", 130]]);
      const chosen = observations.historyObservationPoints(all, true).rows;
      assert.deepEqual(chosen.map(r => [r.date, r.valueKrw]), [["2026-07-01", 130], ["2026-07-02", 130]]);
      assert((await rows(scopes[1], window)).every(r => r.account === "brokerage"));
    }
    const stored = async () => (await rows(scopes[0])).filter(r => r.rowKind === "stored").map(r => r.valuationDate);
    await pg.query("insert into event_ledger_entries values($1,$2,'2026-07-02',false)", [laterAccount, owner]);
    assert.deepEqual(await stored(), ["2026-07-01"]);
    await pg.query("delete from event_ledger_entries where account_id=$1", [laterAccount]);
    await pg.query("update daily_portfolio_snapshots set total_market_value=total_market_value+1 where account='irp' and source=$1", [imported]);
    assert.deepEqual(await stored(), ["2026-07-02"]);
    await pg.query("update daily_portfolio_snapshots set canonical_owner_user_id=$1 where account='all'", [foreignOwner]);
    assert.deepEqual(await stored(), []);
    await pg.query("update daily_portfolio_snapshots set canonical_owner_user_id=$1 where account='all'", [owner]);
    await pg.query("update accounts set is_active=false where id=$1", [irp]);
    assert.deepEqual(await stored(), []);
  } finally { await pg.close(); }
});
