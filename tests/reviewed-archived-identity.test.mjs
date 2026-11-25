import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrateReviewedArchivedIdentity } from "../scripts/migrate-reviewed-archived-identity.mjs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const rule = "broker_account_review_close_v1";
const hash = "a".repeat(64);
const date = "2026-02-04";
const source = "varda_manual_daily_snapshot";

test("an adopted account admits only a verified, inactive historical instrument and keeps its native state intact", async () => {
  const pg = new PGlite();
  const owner = randomUUID(), account = randomUUID(), asset = randomUUID();
  try {
    await pg.exec("create role varda_tenant_app; create schema drizzle; create table drizzle.__drizzle_migrations(hash text not null,created_at bigint not null)");
    const entries = JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8")).entries;
    for (const { tag, when } of entries.filter(entry => entry.idx <= 67)) {
      const sql = readFileSync("drizzle/" + tag + ".sql","utf8");
      await pg.exec(sql);
      await pg.query("insert into drizzle.__drizzle_migrations values($1,$2)", [createHash("sha256").update(sql).digest("hex"),when]);
    }
    assert.equal((await migrateReviewedArchivedIdentity(pg)).status, "ready");
    assert.equal((await migrateReviewedArchivedIdentity(pg,"apply")).status, "applied");
    assert.equal((await migrateReviewedArchivedIdentity(pg,"apply")).status, "already_applied");
    // Reproduce an installation where the published 0068 guard is already in use.
    await pg.exec(readFileSync("drizzle/0068_reviewed_archived_asset_identity.sql","utf8"));
    await pg.query("delete from drizzle.__drizzle_migrations where created_at=$1", [entries[69].when]);
    assert.equal((await migrateReviewedArchivedIdentity(pg)).status, "ready");
    assert.equal((await migrateReviewedArchivedIdentity(pg,"apply")).status, "applied");

    await pg.query("select set_trade_reliability_mode('compatible','Historical instrument test')");
    await pg.query("select set_config('app.trade_reliability_version','0059',false)");
    await pg.query("insert into app_users(id,status,role) values($1,'active','user')", [owner]);
    await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'brokerage','Brokerage','brokerage','KRW')", [account,owner]);
    const opened = date + "T00:00:00Z";
    const native = {version:1,accountId:account,sequence:1,at:opened,startedAt:opened,cash:{KRW:"0",USD:"100"},positions:[]};
    await pg.query(`insert into event_ledger_entries(canonical_owner_user_id,account_id,account,event_type,event_date,source,recorded_at,
      rule_version,asset_name,before_value,after_value,native_sequence,native_operation_id,native_data)
      values($1,$2,'brokerage','native_revision',$3,'native_ledger_v1',now(),'native_revision_v1','Adoption','','',1,gen_random_uuid(),jsonb_build_object('state',$4::jsonb))`,
      [owner,account,date,JSON.stringify(native)]);
    await pg.query("update accounts set native_state=$2::jsonb where id=$1", [account,JSON.stringify(native)]);
    const position = {ticker:"EX",name:"Former holding",currency:"USD",market:"us",quantity:2,price:10,fxRate:1300,valueKrw:26000};
    await pg.query(`insert into account_history_reviews(canonical_owner_user_id,account_id,evidence_hash,captured_revision,start_date,end_date,excluded_labels,points,evidence)
      values($1,$2,$3,0,$4,$4,'{}',$5::jsonb,'{"version":1,"basis":"reviewed_holdings_excluding_cash","currency":"KRW"}')`,
      [owner,account,hash,date,JSON.stringify([{date,valueKrw:26000,positions:[position]}])]);
    await pg.query(`insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,source,snapshot_date,num_assets,total_market_value,rule_version,closing_performance,cycle_end_at)
      values($1,$2,'brokerage',$3,$4,1,26000,$5,jsonb_build_object('reviewEvidenceHash',$6::text),$4::date+time '07:00')`,
      [owner,account,source,date,rule,hash]);

    async function materialize(options = {}) {
      await pg.transaction(async tx => {
        await tx.query("select set_config('app.current_user_id',$1,true),set_config('app.reviewed_close_hash',$2,true)",[options.owner ?? owner,options.hash ?? hash]);
        if (options.tenant) await tx.query("set local role varda_tenant_app");
        await tx.query(`insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,quantity,current_price,asset_type,archived_at,description,created_by_id,ma_rule_enabled,target_weight)
          values($1,$2,$3,'brokerage','Former holding',$4,'us','USD',$5,$6,null,$7,$8,$9,false,$10)`,
          [options.id ?? asset,owner,account,options.ticker ?? "EX",options.qty ?? 0,options.price ?? 0,options.active ? null : date,"Archived historical instrument for " + rule,options.marker === false ? null : rule + ":" + hash,options.target ?? null]);
        if (!options.missingPosition) {
          await tx.query(`insert into daily_position_snapshots(canonical_owner_user_id,account_id,asset_id,account,source,snapshot_date,asset_name,ticker,market,currency,quantity,unit_price,fx_rate,market_value_krw)
            values($1,$2,$3,'brokerage',$4,$5,'Former holding',$6,'us','USD',2,10,1300,$7)`,
            [owner,account,options.id ?? asset,source,date,options.ticker ?? "EX",options.value ?? 26000]);
        }
        await tx.query("set constraints all immediate");
      });
    }
    const denied = /reviewed_identity_requires_publication/;
    for (const options of [{owner:randomUUID()},{hash:"b".repeat(64)},{missingPosition:true},{value:25000},{ticker:"OTHER"},{qty:1},{price:1},{active:true},{target:20}]) {
      await assert.rejects(materialize(options), denied);
    }
    await assert.rejects(materialize({tenant:true}), /permission denied|row-level security/);
    await assert.rejects(materialize({marker:false}), /native_ledger_required/);
    await materialize();
    assert.deepEqual((await pg.query("select native_state from accounts where id=$1",[account])).rows[0].native_state,native);
    assert.equal((await pg.query("select count(*)::int n from event_ledger_entries where account_id=$1",[account])).rows[0].n,1);
    assert.deepEqual((await pg.query("select quantity=0 and archived_at is not null as archived, native_account_assets_match(account_id) as consistent from assets where id=$1",[asset])).rows[0],{archived:true,consistent:true});
    await assert.rejects(materialize({id:randomUUID()}), /assets_owner_account_instrument_unique|reviewed_identity_requires_publication/);
    await assert.rejects(pg.query("update assets set current_price=2 where id=$1",[asset]), /reviewed_identity_is_immutable/);
    await assert.rejects(pg.query("update assets set created_by_id=null where id=$1",[asset]), /reviewed_identity_is_immutable/);
    await assert.rejects(pg.query("update assets set quantity=2,archived_at=null where id=$1",[asset]), /reviewed_identity_is_immutable/);
    await assert.rejects(pg.query("delete from assets where id=$1",[asset]), /native_ledger_required|foreign key constraint/);

    const transport = {transaction: build => pg.transaction(async tx => {
      await tx.exec("set local role varda_tenant_app");
      const rows = [];
      for (const stmt of build({query:(text,params=[]) => ({text,params})})) rows.push((await tx.query(stmt.text,stmt.params)).rows);
      return rows;
    })};
    const [ledger] = await importWithPorts(["src/db/queries/native-portfolio-ledger.ts"], {
      "@/db/tenant-client":{getTenantSqlClient:() => transport},
    });
    const candidate = randomUUID();
    const write = (sequence,event,more={}) => ledger.writeNativeMutation({ownerUserId:owner}, {
      accountId:account, expectedSequence:sequence, operationId:randomUUID(), event, ...more,
    });
    const buy = await write(1,{type:"buy",assetId:candidate,at:"2026-02-05T12:00:00Z",quantity:"2",price:"10",currency:"USD"},{
      newAsset:{id:candidate,name:position.name,ticker:"EX",market:"us",currency:"USD",assetType:"stock"},
    });
    assert.deepEqual(buy.status, "created", JSON.stringify(buy));
    assert.equal((await pg.query("select count(*)::int n from assets where id=$1",[candidate])).rows[0].n,0);
    assert.equal((await pg.query("select archived_at is null and quantity=2 as active from assets where id=$1",[asset])).rows[0].active,true);
    assert.equal((await write(2,{type:"sell",assetId:asset,at:"2026-02-06T12:00:00Z",quantity:"2",price:"10",currency:"USD"})).status,"created");
    assert.equal((await write(3,{type:"deposit",currency:"KRW",amount:"100",at:"2026-02-07T12:00:00Z"})).status,"created");
    assert.equal((await pg.query("select archived_at is not null and quantity=0 as closed from assets where id=$1",[asset])).rows[0].closed,true);
    await assert.rejects(pg.query("update assets set target_weight=10 where id=$1",[asset]), /reviewed_identity_is_immutable/);

    await pg.query("insert into drizzle.__drizzle_migrations values('unexpected',9999999999999)");
    await assert.rejects(migrateReviewedArchivedIdentity(pg,"apply"), /migration_frontier_mismatch/);
  } finally {
    await pg.close();
  }
});
