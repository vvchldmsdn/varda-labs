import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
const owner="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";
const [policy] = await importWithPorts(["src/lib/member-activity.ts"], {});
test("member activity accepts only allowlisted feature and no identity/financial fields", () => {
 assert.equal(policy.parseActivityBody({feature:"home"}),"home");
 for(const value of [{feature:"home",email:"x"},{feature:"home",amount:1},{feature:"home",ownerUserId:other},{feature:"__proto__"},null,[],{feature:"/auth/callback"}]) assert.equal(policy.parseActivityBody(value),null);
 for(const path of ["/auth/sign-in","/demo/home","/start","/management/members","/api/x"]) assert.equal(policy.activityFeature(path),null);
});
test("member activity identity requires verified matching session and fixed admin email",async()=>{
 async function identity({email="vvchldmsdn@gmail.com",verified=true,id="subject",provider="neon_auth",active=true}={}){
  const [mod]=await importWithPorts(["src/lib/auth/member-activity-identity.ts"],{
   react:{cache:fn=>fn},
   "./current-session-subject":{readCurrentSessionSubject:async()=>({state:"authenticated",provider,providerSubject:"subject"})},
   "./current-tenant-context":{resolveCurrentTenantContext:async()=>active?{ok:true,tenantContext:{ownerUserId:owner}}:{ok:false}},
   "./auth-transport-runtime":{getAuthTransportRuntime:()=>({state:"ready",auth:{getSession:async()=>({data:{user:{id,email,emailVerified:verified,name:"Member"}}})}})}
  });return mod.readActivityIdentity();
 }
 assert.equal((await identity()).isAdmin,true);
 assert.equal((await identity({email:"member@example.com"})).isAdmin,false);
 assert.equal(await identity({verified:false}),null);
 assert.equal(await identity({id:"different"}),null);
 assert.equal(await identity({active:false}),null);
 assert.equal((await identity({provider:"naver"})).isAdmin,false);
});
test("member activity DAL denies anonymous writes and nonadmin reports before SQL",async()=>{
 let sqlCalls=0;let identity=null;
 const [dal]=await importWithPorts(["src/db/queries/member-activity.ts"],{
  "@/db/client":{sqlClient:{transaction:()=>{sqlCalls++;throw Error("must not query");}}},
  "@/lib/auth/member-activity-identity":{readActivityIdentity:async()=>identity}
 });
 await dal.recordMemberActivity("home");assert.equal(await dal.getMemberActivityReport(),null);
 identity={ownerUserId:owner,isAdmin:false};assert.equal(await dal.getMemberActivityReport(),null);assert.equal(sqlCalls,0);
});
test("activity API rejects foreign origin and extra payload and keeps response private",async()=>{
 let calls=0;
 const [route]=await importWithPorts(["src/app/api/member-activity/route.ts"],{"@/db/queries/member-activity":{recordMemberActivity:async()=>calls++}});
 const request=(body,origin="https://example.com")=>new Request("https://example.com/api/member-activity",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await route.POST(request({feature:"home"},"https://evil.com"))).status,400);
 assert.equal((await route.POST(request({feature:"home",email:"member"}))).status,400);
 const response=await route.POST(request({feature:"home"}));assert.equal(response.status,204);assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(calls,1);
});
test("activity SQL counts visits, deduplicates, isolates users and denies tenant access",async()=>{
 const [dal]=await importWithPorts(["src/db/queries/member-activity.ts"],{"@/db/client":{sqlClient:{}},"@/lib/auth/member-activity-identity":{readActivityIdentity:async()=>null}});
 const db=new PGlite();
 try{
  await db.exec("create role varda_tenant_app; create table app_users(id uuid primary key,status text);"+readFileSync(new URL("../drizzle/0047_member_activity.sql",import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
  await db.query("insert into app_users values ($1,'active'),($2,'active')",[owner,other]);
  const record=(id,feature)=>db.query(dal.RECORD_ACTIVITY_SQL,[id,"Member","member@example.com",feature]);
  await record(owner,"home");await record(owner,"home");await record(owner,"lab");await record(other,"simulation");
  let rows=(await db.query(dal.REPORT_CTE+" select id,visits,active_days,features from members order by id")).rows;
  assert.equal(rows[0].visits,1);assert.equal(rows[0].active_days,1);assert.equal(rows[0].features.length,2);assert.equal(rows[1].features.length,1);
  await db.query("update member_activity_profiles set last_seen=now()-interval '31 minutes' where owner_user_id=$1",[owner]);
  await record(owner,"structure");
  assert.equal((await db.query(dal.REPORT_CTE+" select visits from members where id=$1",[owner])).rows[0].visits,2);
  await db.exec("set role varda_tenant_app");
  await assert.rejects(db.query("select * from member_activity_profiles"),/permission denied/);
  await assert.rejects(db.query("select * from member_activity_daily"),/permission denied/);
  await db.exec("reset role");
  await db.query("delete from app_users where id=$1",[other]);
  assert.equal((await db.query("select count(*)::int as n from member_activity_daily where owner_user_id=$1",[other])).rows[0].n,0);
 }finally{await db.close();}
});
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
test("tracker excludes sample and observes personal mode without sending query or identity",async()=>{
 const original={document:globalThis.document,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 let params=new URLSearchParams();let effects=[];let timers=[];const payloads=[];
 const [mod]=await importUiWithPorts(["src/components/member-activity-tracker.tsx"],{
  react:{useEffect:effect=>effects.push(effect)},
  "next/navigation":{usePathname:()=>"/try",useSearchParams:()=>params}
 });
 try{
  globalThis.document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
  globalThis.fetch=async(url,options)=>{payloads.push([url,JSON.parse(options.body)]);return new Response(null,{status:204});};
  globalThis.setTimeout=fn=>{timers.push(fn);return timers.length;};globalThis.clearTimeout=()=>{};
  mod.MemberActivityTracker();effects.pop()();assert.equal(timers.length,0);
  params=new URLSearchParams("mode=personal&amount=secret&email=private");mod.MemberActivityTracker();const cleanup=effects.pop()();timers.pop()();await Promise.resolve();cleanup();
  assert.deepEqual(payloads,[["/api/member-activity",{feature:"input"}]]);
  params=new URLSearchParams("mode=personal&preview=design");mod.MemberActivityTracker();effects.pop()();assert.equal(timers.length,0);
 }finally{Object.assign(globalThis,original);}
});
