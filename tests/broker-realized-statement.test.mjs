import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { projectBrokerRealizedStatement } from "../src/lib/broker-realized-statement.ts";
import { migrateBrokerRealizedStatements, verifyRealizedReviewSchema } from "../scripts/migrate-broker-realized-statements.mjs";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";

const months = [
  {month:"2025-12", domesticKrw:"-100", overseasUsd:"1.25", overseasBrokerKrw:"1500"},
  {month:"2026-01", domesticKrw:null, overseasUsd:"0.00", overseasBrokerKrw:null},
];
const payload = {start_date:"2025-12-20", end_date:"2026-01-10", account_label:"Domestic & US", months};
test("broker statements keep missing values, zero, original currency and reported equivalent distinct", () => {
  const result = projectBrokerRealizedStatement(payload);
  assert.equal(result.domesticKrw, "-100");
  assert.equal(result.overseasUsd, "1.25");
  assert.equal(result.subtotalKrw, "1400");
  assert.equal(result.months[1].overseasBrokerKrw, null);
  const absent = months.map(({month})=>({month, domesticKrw:null, overseasUsd:null, overseasBrokerKrw:null}));
  assert.equal(projectBrokerRealizedStatement({...payload,months:absent}).subtotalKrw, null);
  assert.equal(projectBrokerRealizedStatement({...payload,months:[months[0],months[0]]}),null);
  assert.equal(projectBrokerRealizedStatement({...payload,months:[months[1]]}),null);
  assert.equal(projectBrokerRealizedStatement({...payload,months:[{...months[0],domesticKrw:"wrong"},months[1]]}),null);
});

test("ledger migration and owner-scoped broker statements preserve superseded receipts and isolate their evidence", async () => {
  const [reader] = await importWithPorts(["src/db/queries/broker-realized-statements.ts"], {});
  const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002";
  const acc="00000000-0000-4000-8000-000000000003", foreign="00000000-0000-4000-8000-000000000004";
  const db = new PGlite();
  const client = { query: (sql,params) => !params && sql.includes("CREATE TABLE public.account_realized_profit_reviews")
    ? db.exec(sql) : db.query(sql,params) };
  try {
    await db.exec("create role varda_tenant_app; create table accounts(id uuid primary key, canonical_owner_user_id uuid, name text, sort_order int, is_active boolean default true, unique(id,canonical_owner_user_id)); grant select on accounts to varda_tenant_app; create schema drizzle; create table drizzle.__drizzle_migrations(hash text,created_at bigint);");
    const prev=PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations.at(-2);
    await db.query("insert into drizzle.__drizzle_migrations values($1,$2)",[prev.sha256,prev.createdAt]);
    assert.equal((await migrateBrokerRealizedStatements(client)).status,"ready");
    assert.equal((await migrateBrokerRealizedStatements(client,true)).status,"applied");
    assert.equal((await migrateBrokerRealizedStatements(client,true)).status,"already_applied");
    await db.query("insert into accounts(id,canonical_owner_user_id,name,sort_order) values($1,$2,'A',0),($3,$4,'B',0)",[acc,owner,foreign,other]);
    const put="insert into account_realized_profit_reviews(canonical_owner_user_id,account_id,evidence_hash,start_date,end_date,months,evidence) values($1,$2,$3,'2025-12-20','2026-01-10',$4::jsonb,$5::jsonb)";
    const args=[owner,acc,"a".repeat(64),JSON.stringify(months),JSON.stringify({version:1,basis:"broker_reported_realized_subtotals",privateSources:["statement.jpg"]})];
    await db.query(put,args);
    await assert.rejects(db.query(put,args),e=>e.code==="23505");
    await assert.rejects(db.query(put,[other,acc,"c".repeat(64),...args.slice(3)]),e=>e.code==="23503");
    await db.query(put,[other,foreign,...args.slice(2)]);
    await db.query(put,[owner,acc,"b".repeat(64),JSON.stringify([{...months[0],domesticKrw:"350"},months[1]]),args[4]]);
    await assert.rejects(db.query("update account_realized_profit_reviews set months=months"),/immutable/);
    await db.exec("set role varda_tenant_app");
    await db.query("select set_config('app.current_user_id',$1,false)",[owner]);
    const get=async(id,account=null)=>(await db.query(reader.BROKER_REALIZED_STATEMENTS_SQL,[id,account])).rows;
    assert.equal((await get(owner)).length,1);
    assert.equal(projectBrokerRealizedStatement((await get(owner,acc))[0]).subtotalKrw,"1850");
    assert.equal((await get(other)).length,0);
    assert.equal((await get(owner,foreign)).length,0);
    await assert.rejects(db.query("select evidence from account_realized_profit_reviews"),e=>e.code==="42501");
    await assert.rejects(db.query(put,args),e=>e.code==="42501");
    await db.exec("reset role; set search_path=public,pg_catalog; grant select(evidence) on account_realized_profit_reviews to varda_tenant_app");
    await assert.rejects(verifyRealizedReviewSchema(async sql=>(await db.query(sql)).rows,true),/schema evidence differs/);
    await db.query("delete from accounts where id=$1",[acc]);
    assert.equal((await db.query("select count(*) from account_realized_profit_reviews")).rows[0].count,1);
  } finally {await db.close();}
});
