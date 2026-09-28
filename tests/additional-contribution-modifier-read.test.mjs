import assert from 'node:assert/strict';
import { after, before, beforeEach, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { buildNativeContributionPlan } from '../src/lib/native-contribution-plan.ts';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { calculateExplainableAdditionalContribution } from '../src/lib/additional-contribution-policy-engine.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const account='11111111-1111-4111-8111-111111111111', foreign='22222222-2222-4222-8222-222222222222';
const ids=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const now=new Date('2026-09-27T01:00:00Z'), at=now.toISOString();
const scope={kind:'account',accountId:account,accountCode:'brokerage',key:`account:${account}`};
const pg=new PGlite(); let read, fx, riskCalls, performancePrices;
const rows=()=>[{key:'a',assetId:ids[0],name:'US',market:'us',currency:'USD',ticker:'AAA',currentValue:500000},{key:'b',assetId:ids[1],name:'국내',market:'korea',currency:'KRW',ticker:'BBB',currentValue:500000}];
before(async()=>{
  await pg.exec(`create role varda_tenant_app;
    create table accounts(id uuid primary key,canonical_owner_user_id uuid,code text,is_active boolean);
    create table etf_masters(ticker text,name text,market text,currency text,is_currency_hedged boolean not null default false,is_active boolean not null default true,is_sample boolean not null default false);
    create table assets(id uuid primary key,canonical_owner_user_id uuid,category text,archived_at timestamptz);
    create table market_regime_daily(account_id uuid,canonical_owner_user_id uuid,legacy_base44_id text,date date,account text,label text,description text,drivers_json jsonb,macro_stress_score numeric,regime_score numeric,news_sentiment_score numeric,avg_correlation numeric,enb numeric,portfolio_volatility numeric,yield_curve numeric,rate_level numeric,stress_badge_count int,base44_updated_at timestamptz,created_at timestamptz,updated_at timestamptz,is_sample boolean);
    grant select on accounts,assets,market_regime_daily to varda_tenant_app;`);
  for(const table of ['accounts','assets','market_regime_daily']) await pg.exec(`alter table ${table} enable row level security; create policy owned on ${table} to varda_tenant_app using(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);`);
  const client={transaction:async build=>pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');const result=[];for(const command of build({query:(text,params=[])=>({text,params})}))result.push((await tx.query(command.text,command.params)).rows);return result;})};
  [read]=await importWithPorts(['src/db/queries/additional-contribution-modifiers.ts'],{
    '@/db/client':{db:drizzle(pg)},
    '@/db/tenant-client':{getTenantSqlClient:()=>client},
    './tenant-client':{getTenantSqlClient:()=>client},
    '@/db/queries/portfolio-fx-rates':{loadUsablePortfolioFxRows:async()=>fx},
    '@/db/queries/portfolio-risk':{loadPortfolioRiskPriceCandidates:async()=>performancePrices,getReadOnlyTenantPortfolioRiskForScope:async input=>{riskCalls.push(input);return {inputHealth:{status:'ready'},provenance:{usableReturnObservations:90,excludedHoldingCount:0,lastServiceDate:'2026-09-26'},calculation:{instruments:rows().map(row=>({...row,volatilityDaily:.02})),portfolio:{correlationMatrix:[[1,0],[0,1]]}}};}},
  });
});
beforeEach(async()=>{
  riskCalls=[];
  performancePrices=[];
  fx=Array.from({length:252},(_,i)=>({rateDate:new Date(now.getTime()-(251-i)*86400000).toISOString().slice(0,10),usdKrw:'1000',source:'reference',fetchedAt:at}));
  await pg.exec(`truncate accounts,assets,market_regime_daily,etf_masters;
    insert into accounts values('${account}','${owner}','brokerage',true),('${foreign}','${other}','brokerage',true);
    insert into assets values('${ids[0]}','${owner}','미국주식',null),('${ids[1]}','${owner}','국내주식',null);
    insert into market_regime_daily(account_id,canonical_owner_user_id,date,account,label,drivers_json,macro_stress_score,regime_score,news_sentiment_score,created_at,updated_at,is_sample) values
    ('${account}','${owner}','2026-09-27','brokerage','경계','{"macro":["fact"],"portfolio":["fact"],"news":["fact"]}',30,30,70,'${at}','${at}',false),
    ('${foreign}','${other}','2026-09-27','brokerage','안정','{"macro":["fact"],"portfolio":["fact"],"news":["fact"]}',90,90,90,'${at}','${at}',false);`);
});
after(()=>pg.close());
const run=(patch={})=>read.readAdditionalContributionModifiers({tenantContext:{ownerUserId:owner},scope,now,rows:rows(),...patch});

it('uses actual owner-scoped regime and asset SQL, then feeds current-weight RC and FX into the shared policy',async()=>{
  const result=await run();
  assert.equal(result.modifiers.regime.value,'경계');assert.equal(result.modifiers.fx.value.multiplier,.634);
  assert.equal(result.rows.b.fxExposureType,'DOMESTIC');assert.equal(result.rows.a.riskContribution.value,.5);
  assert.equal(result.modifiers.eventScore.status,'unavailable');assert.equal(result.modifiers.performance.status,'unavailable');
  assert.equal(riskCalls[0].tenantContext.ownerUserId,owner);assert.equal(riskCalls[0].scope,scope);
  const calculation=calculateExplainableAdditionalContribution({cashAmountKrw:100000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:result.modifiers,rows:rows().map(row=>({allocationKey:row.key,...result.rows[row.key],currentValueKrw:row.currentValue,costBasisKrw:null,targetWeightBps:5000,buyable:true,maRuleEnabled:false,assetType:'etf',metadata:null}))});
  // Raw 50,000 each: 50,000 × .634 × .7 = 22,190; domestic 50,000 × .7 = 35,000.
  assert.equal(calculation.totalAllocatedKrw,57190);assert.equal(calculation.residualCashKrw,42810);
  assert.ok(calculation.rows.every(row=>!row.modifierBreakdown.topupEligible));
});
it('reweights risk covariance using this valuation instead of borrowing stale portfolio weights',async()=>{
  const result=await run({rows:rows().map((row,i)=>({...row,currentValue:i===0?750000:250000}))});
  assert.ok(Math.abs(result.rows.a.riskContribution.value-.9)<1e-12);
  assert.ok(Math.abs(result.rows.b.riskContribution.value-.1)<1e-12);
});
it('never borrows a different owner or an all-account regime and rejects incomplete drivers',async()=>{
  await pg.exec(`update market_regime_daily set drivers_json='{}' where canonical_owner_user_id='${owner}'`);
  assert.equal((await run()).modifiers.regime.status,'unavailable');
  assert.equal((await run({scope:{kind:'all',key:'all'}})).modifiers.regime.status,'unavailable');
  await pg.exec(`delete from market_regime_daily where canonical_owner_user_id='${owner}'`);
  assert.equal((await run()).modifiers.regime.status,'unavailable');
});
it('fails closed on stale or mixed-source FX, unknown exposures and USD-only RC semantics',async()=>{
  fx=fx.map(row=>({...row,fetchedAt:'2026-09-20T00:00:00Z'}));assert.equal((await run()).modifiers.fx.status,'unavailable');
  fx=fx.map((row,i)=>({...row,fetchedAt:at,source:i===251?'changed_source':'reference'}));assert.equal((await run()).modifiers.fx.status,'unavailable');
  await pg.exec(`update assets set category=null where id='${ids[1]}'`);
  assert.equal((await run()).rows.b.fxExposureType,'UNKNOWN');
  const before=riskCalls.length,usd=await run({reportingCurrency:'USD'});assert.equal(riskCalls.length,before);
  assert.equal(usd.rows.a.riskContribution.status,'unavailable');
});
it('connects admitted aligned KRW history to the actual modifier query and shared performance multiplier',async()=>{
  performancePrices=['AAA','BBB','069500'].flatMap(ticker=>Array.from({length:253},(_,i)=>({
    ticker,market:'korea',currency:'KRW',priceDate:new Date(now.getTime()-(253-i)*86400000).toISOString().slice(0,10),
    closePrice:'100',adjustedClosePrice:100*Math.exp((ticker==='069500'?0:-.002)*i+(i%2===0?0:.01)),
    adjustedCloseBasis:'provider_adjusted_close_v1',adjustedCloseProvider:'approved',adjustedCloseSource:'approved_adjusted',adjustedCloseFetchedAt:at,
    providerSymbol:ticker,providerExchange:'KRX',fetchedAt:at,source:'approved',isSample:false,
  })));
  const result=await run({rows:rows().map(row=>({...row,market:'korea',currency:'KRW'}))});
  assert.equal(result.modifiers.performance.status,'ready');
  assert.deepEqual(result.modifiers.performance.value,{alpha90Pct:-16.47,alpha252Pct:-39.59,mddPct:-17.14});
  const calculation=calculateExplainableAdditionalContribution({cashAmountKrw:100000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:result.modifiers,rows:rows().map(row=>({allocationKey:row.key,fxExposureType:'DOMESTIC',currentValueKrw:row.currentValue,costBasisKrw:null,targetWeightBps:5000,buyable:true,maRuleEnabled:false,assetType:'etf',metadata:null}))});
  assert.ok(calculation.rows.every(row=>row.modifierBreakdown.multipliers.performance.value===.9));
});


const koreanRows=name=>rows().map((row,i)=>i===0?{...row,name,market:'korea',currency:'KRW'}:row);
it('distinguishes negative hedge labels, clear positives and conflicting names through the actual reader',async()=>{
  const cases=[
    ['Unhedged US Equity ETF','KR_UNHEDGED_GLOBAL'],
    ['Non-hedged US Equity ETF','KR_UNHEDGED_GLOBAL'],
    ['미국주식 환헤지 안함','KR_UNHEDGED_GLOBAL'],
    ['Hedged US Equity ETF','HEDGED'], ['미국주식 (H)','HEDGED'],
    ['Hedged / Unhedged US Equity ETF','UNKNOWN'], ['미국주식 (H) 환헤지 안함','UNKNOWN'],
    ['미국주식 환헤지 여부 미확인','UNKNOWN'],
  ];
  for(const [name,expected] of cases) assert.equal((await run({rows:koreanRows(name)})).rows.a.fxExposureType,expected,name);
  assert.equal((await run()).rows.a.fxExposureType,'US_LISTED');
  assert.equal((await run()).rows.b.fxExposureType,'DOMESTIC');
  await pg.exec("update assets set category=null where id='"+ids[0]+"'");
  assert.equal((await run({rows:koreanRows('US Equity ETF')})).rows.a.fxExposureType,'UNKNOWN');
});
it('uses exact active non-sample ETF hedge metadata first without treating default false as verified unhedged',async()=>{
  const seed=async(patch={})=>{
    await pg.exec('truncate etf_masters');
    const m={ticker:'AAA',market:'korea',currency:'KRW',hedged:true,active:true,sample:false,...patch};
    await pg.query('insert into etf_masters(ticker,name,market,currency,is_currency_hedged,is_active,is_sample) values($1,$2,$3,$4,$5,$6,$7)',[m.ticker,'Master ETF',m.market,m.currency,m.hedged,m.active,m.sample]);
  };
  await seed();
  assert.equal((await run({rows:koreanRows('Unhedged US Equity ETF')})).rows.a.fxExposureType,'HEDGED');
  for(const patch of [{ticker:'OTHER'},{market:'us'},{currency:'USD'},{active:false},{sample:true},{hedged:false}]) {
    await seed(patch);
    assert.equal((await run({rows:koreanRows('Unhedged US Equity ETF')})).rows.a.fxExposureType,'KR_UNHEDGED_GLOBAL',JSON.stringify(patch));
  }
  await seed({hedged:false});
  assert.equal((await run({rows:koreanRows('Hedged US Equity ETF')})).rows.a.fxExposureType,'HEDGED');
  assert.equal((await run()).rows.a.fxExposureType,'US_LISTED');
});
it('keeps reader exposure, portfolio FX, row reduction and native UI DTO consistent without enabling news topup',async()=>{
  const holdings=koreanRows('Unhedged US Equity ETF'), readResult=await run({rows:holdings});
  // Two equal holdings: global unhedged receives 50% exposure strength, hence portfolio USD exposure = 25%.
  // Flat FX history: .72 percentile factor x .93 exposure factor rounds to .670; row FX = .835.
  assert.equal(readResult.modifiers.fx.status,'ready');
  assert.equal(readResult.modifiers.fx.value.exposureMult,.93);
  assert.equal(readResult.modifiers.fx.value.multiplier,.67);
  const context={status:'ready',scopeKey:scope.key,scopeLabel:'Brokerage',policy:{version:'test',revision:1,universeHash:'u',vectorHash:'v',effectiveServiceDate:'2026-09-27'},nativeSequences:{[account]:1},names:{a:holdings[0].name,b:holdings[1].name},availableCash:[],input:{reportingCurrency:'KRW',asOf:at,fx:[],maxFxAgeMs:86400000,trimDriftThresholdPct:12,minimumExecutionRatioPct:85,modifiers:readResult.modifiers,rows:holdings.map(row=>({allocationKey:row.key,...readResult.rows[row.key],assetType:'etf',buyable:true,targetWeightBps:5000,maRuleEnabled:false,metadata:{accountId:account},value:{amount:String(row.currentValue),currency:'KRW',at,source:'test'},cost:null}))}};
  const plan=buildNativeContributionPlan(context,{id:'55555555-5555-4555-8555-555555555555',scopeKey:scope.key,reportingCurrency:'KRW',newMoney:{amount:'100000',currency:'KRW'},useAvailableCash:false});
  assert.equal(plan.status,'ready');
  const dto=JSON.parse(JSON.stringify(plan.document));
  const first=dto.result.rows.find(row=>row.key==='a'), domestic=dto.result.rows.find(row=>row.key==='b');
  assert.equal(first.modifierBreakdown.multipliers.fx.value,.835);
  assert.equal(first.modifierBreakdown.multipliers.fx.status,'ready');
  assert.equal(domestic.modifierBreakdown.multipliers.fx.status,'not_applicable');
  assert.equal(first.buy,29225); assert.equal(domestic.buy,35000);
  assert.equal(dto.result.buys,64225);assert.equal(dto.result.remainingCash,35775);
  assert.equal(dto.result.modifierEvidence.eventScore.status,'unavailable');
  assert.ok(dto.result.rows.every(row=>!row.modifierBreakdown.topupEligible&&row.modifierBreakdown.topupAllocationKrw===0));
  const unknown=await run({rows:koreanRows('Hedged / Unhedged US Equity ETF')});
  assert.equal(unknown.modifiers.fx.status,'unavailable');
  assert.equal(unknown.modifiers.fx.reason,'portfolio_fx_exposure_unclassified');
});
