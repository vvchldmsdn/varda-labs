import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sqlTransport} from '../scripts/krw-usd-rc-rehearsal.mjs';
import {importWithPorts} from '../tests/helpers/import-with-ports.mjs';
export async function runNativeTradeCutoffCases({admin,worker,tenant,report}) {
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),asset=randomUUID();
 const ports={'next/server':{after:()=>{throw Error('No provider calls permitted')}},'@/db/tenant-client':{getTenantSqlClient:()=>sqlTransport(tenant,new Set())},'@/db/client':{sqlClient:sqlTransport(worker,new Set())}};
 const [q,cutoff,snapshots,projection,valuation]=await importWithPorts(['src/db/queries/native-portfolio-ledger.ts','src/db/queries/native-cutoff-evidence.ts','src/db/queries/native-portfolio-snapshots.ts','src/lib/native-portfolio-projection.ts','src/lib/currency-tracked-portfolio.ts'],ports);
 await admin.query("insert into app_users(id,status) values($1,'active'),($2,'active')",[owner,other]);
 await admin.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,'trade-rehearsal','Trade Rehearsal','brokerage','USD')",[account,owner]);
 const ctx={ownerUserId:owner};
 const check=async(name,fn)=>{const r={name,status:'FAIL'};report.cases.push(r);await fn();r.status='PASS'};
 const write=async(event,newAsset)=>{const current=await q.readNativeLedger(ctx,account);return q.writeNativeMutation(ctx,{operationId:randomUUID(),accountId:account,expectedSequence:current.accounts[0].state.sequence,event,...(newAsset?{newAsset}:{})});};
 await check('real-pg-settlement-and-idempotent-atomic-first-buy',async()=>{
   const opening={operationId:randomUUID(),accountId:account,expectedSequence:null,opening:{at:'2026-09-01T00:00:00Z',cash:{KRW:'1000000',USD:'1000'},positions:[]}};
   assert.equal((await q.writeNativeMutation(ctx,opening)).status,'created');
   assert.equal((await q.writeNativeMutation(ctx,opening)).status,'existing');
   assert.equal((await write({type:'buy',at:'2026-09-01T01:00:00Z',assetId:asset,quantity:'0.411494',currency:'USD',settlement:{amount:'420000',currency:'KRW'}},{id:asset,name:'Synthetic VOO',ticker:'VOO',market:'us',currency:'USD',assetType:'etf'})).status,'created');
   const state=(await q.readNativeLedger(ctx,account)).accounts[0].state;
   assert.deepEqual(state.cash,{KRW:'580000',USD:'1000'});assert.equal(state.positions[0].quantity,'0.411494');assert.equal(state.positions[0].costLots[0].amount,'420000');
 });
 await check('real-pg-tenant-boundary-and-rollback',async()=>{
   assert.deepEqual((await q.readNativeLedger({ownerUserId:other},account)).accounts,[]);
   const before=(await admin.query('select native_state from accounts where id=$1',[account])).rows[0];
   assert.equal((await write({type:'sell',at:'2026-09-01T02:00:00Z',assetId:asset,quantity:'1',currency:'USD',settlement:{amount:'100',currency:'USD'}})).status,'invalid');
   assert.deepEqual((await admin.query('select native_state from accounts where id=$1',[account])).rows[0],before);
 });
 await check('real-pg-exclusive-cutoff-delays-and-today',async()=>{
   await write({type:'sell',at:'2026-09-01T03:00:00Z',assetId:asset,quantity:'0.411494',currency:'USD',settlement:{amount:'420000',currency:'KRW'}});
   for(const [at,amount] of [['2026-09-01T21:59:59.999Z','100'],['2026-09-01T22:00:00.000Z','50'],['2026-09-01T22:00:00.001Z','25'],['2026-09-01T22:05:00Z','20']]) assert.equal((await write({type:'deposit',at,amount,currency:'USD'})).status,'created');
   await admin.query("insert into fx_rates(date,usdkrw,source,status,observed_at,fetched_at,rate_kind,is_sample) values('2026-09-01','1000','synthetic_fx','ok','2026-09-01T21:00:00Z','2026-09-01T21:01:00Z','spot',false)");
   for(const actual of ['2026-09-01T22:00:00.000Z','2026-09-01T22:05:00Z','2026-09-01T22:30:00Z','2026-09-01T23:00:00Z']) {
     const e=await cutoff.readNativeCutoffEvidence(ctx,account,'2026-09-02',actual);
     assert.equal(valuation.buildTrackedCurrencyPortfolio(e).current.total,'2100');
     const r=await snapshots.saveNativeCutoffSnapshots(ctx,e,'2026-09-02',actual);assert.equal(r.status,'ready');
   }
   assert.equal((await admin.query("select count(*)::int n from daily_portfolio_snapshots where account_id=$1 and source='native_ledger_cutoff_v2'",[account])).rows[0].n,1);
   const ledger=await q.readNativeLedger(ctx,account),asOf='2026-09-02T00:00:00Z';
   const e=projection.attachNativeLedgerEvidence({ownerId:owner,reporting:'USD',asOf,current:{at:asOf,source:'synthetic_cash',scopeComplete:false,positions:[]},history:[],trades:null,fx:[{base:'USD',quote:'KRW',rate:'1000',observedAt:asOf,fetchedAt:asOf,kind:'spot',source:'synthetic_fx'}],maxFxAgeMs:86400000,maxPriceAgeMs:86400000},ledger,'account');
   const result=valuation.buildTrackedCurrencyPortfolio(e);assert.equal(result.current.total,'2195');assert.equal(result.movement.valuationChange,'95');assert.equal(result.movement.attribution.investmentChange,'0');
 });
}
