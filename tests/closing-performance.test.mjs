import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

test("daily worker stores a closed return, repairs the next link, and rejects a superseded worker", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create role varda_tenant_app");
    for (const { tag } of JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries) {
      await pg.exec(readFileSync("drizzle/" + tag + ".sql", "utf8"));
    }
    await pg.query("select set_config('app.trade_reliability_version','0059',false)");
    const owner = randomUUID(), account = randomUUID(), asset = randomUUID(), code = "test_close";
    await pg.query("insert into app_users(id,status,role) values($1,'active','user')", [owner]);
    await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Demo','brokerage','KRW')", [account,owner,code]);
    await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,quantity,current_price) values($1,$2,$3,$4,'Demo','TEST','korea','KRW',8,121)", [asset,owner,account,code]);
    const commands = build => build({query: (sql, params=[]) => ({sql,params})});
    const batch = async (tx, queries) => {
      const result = [];
      for (const {sql,params} of queries) result.push((await tx.query(sql,params)).rows);
      return result;
    };
    const [worker] = await importWithPorts(["src/lib/snapshots/durable-work.ts"], {
      "@/db/client": {sqlClient: {
        query: async (sql,params) => (await pg.query(sql,params)).rows,
        transaction: build => pg.transaction(tx => batch(tx,commands(build))),
      }},
      "@/db/tenant-transaction-context": {runTenantReadTransaction: (userId,build) => pg.transaction(async tx => {
        await tx.query("select set_config('app.current_user_id',$1,true)", [userId]);
        return batch(tx,commands(build));
      })},
    });
    const save = async (date, quantity, price) => {
      const id = randomUUID();
      await pg.query(`insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,account,snapshot_date,source,
        cycle_end_at,num_assets,total_market_value,total_return_pct,description)
        values($1,$2,$3,$4,$5,'varda_manual_daily_snapshot',($5::date+time '07:00') at time zone 'Asia/Seoul',1,$6,-40,'snapshot_status=complete')`,
        [id,owner,account,code,date,quantity*price]);
      await pg.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,asset_id,account,snapshot_date,source,
        asset_name,market,currency,price_source,price_basis,quantity,unit_price,market_value_krw)
        values($1,$2,$3,$4,$5,'varda_manual_daily_snapshot','Demo','korea','KRW','test_close','official_close',$6,$7,$8)`,
        [owner,account,asset,code,date,quantity,price,quantity*price]);
      return id;
    };
    const claim = async date => {
      await pg.query("insert into daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage) values($1,$2,$3,'legacy') on conflict do nothing", [owner,account,date]);
      const work = await worker.claimSnapshotWork("legacy",date);
      assert.equal(work?.snapshotDate,date);
      return work;
    };
    const load = async id => (await pg.query("select closing_performance,total_return_pct from daily_portfolio_snapshots where id=$1",[id])).rows[0];
    const first = await save("2026-10-05",10,100);
    const third = await save("2026-10-07",8,121);
    const missing = await claim("2026-10-07");
    assert.equal(await worker.finishValuedSnapshot(missing),true);
    assert.equal((await load(third)).closing_performance.dailyReturnPct,null);
    assert.equal((await load(third)).closing_performance.reason,"valuation");

    const second = await save("2026-10-06",8,110);
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,account,asset_id,event_type,event_date,
      source,asset_name,legacy_asset_id,before_value,after_value,quantity_delta,amount_krw,price,fx_rate)
      values($1,$2,$3,$4,'sell','2026-10-05','test','Demo','000000000000000000000001','10','8',-2,220,110,1)`,
      [owner,account,code,asset]);
    const complete = await claim("2026-10-06");
    assert.equal(await worker.finishValuedSnapshot(complete),true);
    const closed = await load(second);
    assert.equal(closed.closing_performance.date,"2026-10-05");
    assert.equal(closed.closing_performance.previousSnapshotId,first);
    assert.ok(Math.abs(closed.closing_performance.dailyReturnPct - 10) < 1e-8);
    assert.equal(Number(closed.total_return_pct),-40,"profit on purchase cost is an independent metric");
    assert.equal(await worker.finishValuedSnapshot(complete),false,"an acknowledged lease cannot publish twice");
    const next = await claim("2026-10-07");
    assert.equal(await worker.finishValuedSnapshot(missing),false);
    assert.equal((await load(third)).closing_performance.dailyReturnPct,null);
    assert.equal(await worker.finishValuedSnapshot(next),true);
    const healed = (await load(third)).closing_performance;
    assert.equal(healed.previousSnapshotId,second);
    assert.ok(Math.abs(healed.dailyReturnPct - 10) < 1e-8);
    assert.equal(await worker.claimSnapshotWork("legacy","2026-10-07"),null);
  } finally {
    await pg.close();
  }
});
