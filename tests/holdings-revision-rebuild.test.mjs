import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildHoldingsRevisionSnapshot, buildHoldingsRevisionAggregate } from '../src/lib/snapshots/holdings-revision-rebuild.ts';

const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', account='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cutoff=new Date('2026-09-29T22:00:00Z'), captured=new Date('2026-09-29T22:45:00Z');
const lot=(amount,currency='KRW',remaining={n:'1',d:'1'})=>({amount,currency,remaining,at:'2026-09-20T00:00:00Z',source:'synthetic_native_opening'});
const native=(assetId,quantity,costLots=[lot('1000')],currency='KRW')=>({assetId,quantity,costLots,currency});
const state=(positions)=>({version:1,accountId:account,startedAt:'2026-09-20T00:00:00Z',at:'2026-09-29T10:00:00Z',sequence:4,cash:{KRW:'9999999',USD:'10000'},positions});
function position(id='a',patch={}) {
  return {
    id:`snapshot-${id}`,legacyBase44Id:null,canonicalOwnerUserId:owner,snapshotDate:'2026-09-30',assetId:id,legacyAssetId:null,
    ticker:id.toUpperCase(),assetName:`Asset ${id}`,account:'brokerage',accountId:account,source:'varda_manual_daily_snapshot',
    market:'korea',currency:'KRW',assetStatus:'active',assetType:'stock',category:null,sector:null,sourceType:'broker',
    exposureType:'DOMESTIC',legacyGroupId:null,groupName:null,priceSource:'kis_saved',priceBasis:'cutoff_observation',
    description:'price_observed_at=2026-09-29T21:59:00Z; native_revision=1; cost_basis_source=asset_average_cost',belowMa:false,isSample:false,
    quantity:'10',totalQuantity:'10',estimatedFractionalQuantity:'0',avgCost:'100',currentPrice:'120',closePrice:'119',unitPrice:'120',unitValueKrw:'120',
    marketValueLocal:'1200',marketValueKrw:'1200',costKrw:'1000',pnlKrw:'200',pnlPct:'20',currentWeight:'100',
    targetWeight:'50',targetWeightRaw:'50',targetWeightEffective:'50',trimTargetWeight:'50',driftPct:'100',fxRate:'1',
    previousFxRate:'1',previousQuantity:'10',previousUnitPrice:'100',previousUnitValueKrw:'100',previousMarketValueKrw:'1000',
    priceChangeKrw:'200',fxChangeKrw:'0',marketValueChangeKrw:'200',marketValueChangePct:'20',unitValueChangeKrw:'20',unitValueChangePct:'20',
    ma120:null,fractionalKrwValue:'0',fractionalAvgCost:'0',priceDate:'2026-09-29',referenceDate:'2026-09-29',fxReferenceDate:null,
    previousReferenceDate:'2026-09-28',previousSnapshotDate:'2026-09-29',capturedAt:captured,cycleStartAt:new Date('2026-09-28T22:00:00Z'),
    cycleEndAt:cutoff,sourceCreatedAt:captured,base44CreatedAt:null,base44UpdatedAt:null,createdAt:captured,updatedAt:captured,...patch,
  };
}
function portfolio(count=1) {
  return {id:'portfolio',legacyBase44Id:null,canonicalOwnerUserId:owner,snapshotDate:'2026-09-30',account:'brokerage',accountId:account,
    source:'varda_manual_daily_snapshot',ruleVersion:'daily_v1',nativeEvidence:null,
    description:'snapshot_status=complete; expected_positions=1; native_revision=1; return_basis=old; realized_pnl_krw=123; realized_cost_basis_krw=456; realized_sell_events=1',
    isSample:false,cashValue:'0',investedAmount:'1000',totalCost:'1000',totalMarketValue:'1200',totalPnl:'200',totalReturnPct:'20',
    fxRate:'1400',usdKrw:'1400',krWeight:'100',usWeight:'0',usdExposurePct:'0',thematicWeight:'0',numAssets:count,numGroups:0,
    topHoldingName:'Asset a',topHoldingWeight:'100',benchmarkValue:'500',benchmarkIndexValue:null,kodex200Value:null,kospi200Value:null,kospi200Index:null,sp500Index:null,vooValue:null,
    avgCorrelation:'0.5',enb:'2',portfolioVolatility:'10',regimeLabel:'old',regimeScore:'4',capturedAt:captured,
    cycleStartAt:new Date('2026-09-28T22:00:00Z'),cycleEndAt:cutoff,base44CreatedAt:null,base44UpdatedAt:null,createdAt:captured,updatedAt:captured};
}
function run(positions,nativePositions,patch={}) {
  return buildHoldingsRevisionSnapshot({portfolio:portfolio(positions.length),positions,state:state(nativePositions),revision:2,...patch});
}

test('rebuilds partial sale holdings, remaining cost, totals and weights using frozen prices only',()=>{
  const result=run([position(),position('b',{unitPrice:'200',currentPrice:'200',quantity:'2',marketValueKrw:'400'})],
    [native('a','4',[lot('1000','KRW',{n:'2',d:'5'})]),native('b','2',[lot('300')])],
    {assets:[{id:'a',maAssetClass:'thematic'},{id:'b',maAssetClass:'bond'}]});
  assert.equal(result.status,'ready');
  const [a,b]=result.positions;
  assert.equal(a.quantity,'4');assert.equal(a.marketValueKrw,'480');assert.equal(a.costKrw,'400');assert.equal(a.pnlKrw,'80');assert.equal(a.avgCost,'100');
  assert.equal(b.marketValueKrw,'400');assert.equal(b.costKrw,'300');
  assert.equal(result.portfolio.totalMarketValue,'880');assert.equal(result.portfolio.totalCost,'700');assert.equal(result.portfolio.totalPnl,'180');
  assert.equal(a.currentWeight,'54.545455');assert.equal(b.currentWeight,'45.454545');
  assert.equal(result.portfolio.topHoldingName,'Asset a');assert.equal(result.portfolio.thematicWeight,'54.545455');
  assert.equal(result.portfolio.cashValue,'0');assert.equal(result.portfolio.totalReturnPct,null);
});
test('split quantity changes preserve remaining acquisition cost without applying current FX',()=>{
  const result=run([position('a',{unitPrice:'60',currentPrice:'60'})],[native('a','20')]);
  assert.equal(result.status,'ready');
  assert.equal(result.positions[0].marketValueKrw,'1200');assert.equal(result.positions[0].costKrw,'1000');assert.equal(result.positions[0].avgCost,'50');
});
test('zero or absent native positions remove the original listed holding including a full exit',()=>{
  for(const remaining of [[native('a','0',[])],[]]) {
    const result=run([position()],remaining);
    assert.equal(result.status,'ready');assert.deepEqual(result.positions,[]);
    assert.equal(result.portfolio.numAssets,0);assert.equal(result.portfolio.totalMarketValue,'0');assert.equal(result.portfolio.totalCost,'0');
    assert.equal(result.portfolio.topHoldingName,null);assert.equal(result.portfolio.cashValue,'0');
  }
});
test('preserves manual evidence and separate entered fractional KRW amounts',()=>{
  const rows=[position('gold',{ticker:null,sourceType:'manual',marketValueKrw:'1451680',costKrw:'1400000'}),
    position('a',{fractionalKrwValue:'50',fractionalAvgCost:'30'})];
  const result=run(rows,[native('a','4',[lot('400')])]);
  assert.equal(result.status,'ready');
  assert.equal(result.positions[0].marketValueKrw,'1451680');assert.equal(result.positions[0].quantity,'10');
  assert.equal(result.positions[1].marketValueKrw,'530');assert.equal(result.positions[1].costKrw,'430');
  assert.equal(result.positions[1].estimatedFractionalQuantity,null);assert.equal(result.positions[1].totalQuantity,'4');
  assert.equal(result.portfolio.totalMarketValue,'1452210');
  const fixedOnly=run([rows[1]],[native('a','0',[])]);
  assert.equal(fixedOnly.status,'ready');assert.equal(fixedOnly.positions[0].marketValueKrw,'50');assert.equal(fixedOnly.positions[0].costKrw,'30');
});
test('unknown fractional cost remains unknown rather than becoming zero',()=>{
  const result=run([position('a',{fractionalKrwValue:'50',fractionalAvgCost:null})],[native('a','4',[lot('400')])]);
  assert.equal(result.status,'ready');assert.equal(result.positions[0].costKrw,null);assert.equal(result.portfolio.totalCost,null);assert.equal(result.portfolio.totalPnl,null);
});
test('USD valuation uses snapshot FX while USD or mixed-currency acquisition costs remain unavailable',()=>{
  for(const costs of [[lot('100','USD')],[lot('100','USD'),lot('10000')],null]) {
    const result=run([position('a',{market:'us',currency:'USD',exposureType:'US_LISTED',unitPrice:'100',fxRate:'1400'})],[native('a','1.5',costs,'USD')]);
    assert.equal(result.status,'ready');assert.equal(result.positions[0].marketValueKrw,'210000');assert.equal(result.positions[0].marketValueLocal,'150');
    assert.equal(result.positions[0].costKrw,null);assert.equal(result.positions[0].avgCost,null);assert.equal(result.portfolio.totalPnl,null);
    assert.equal(result.portfolio.usWeight,'100');assert.equal(result.portfolio.usdExposurePct,'100');
  }
});
test('KRW-settled cost lots on USD positions retain their KRW cost without an FX conversion',()=>{
  const result=run([position('a',{market:'us',currency:'USD',unitPrice:'100',fxRate:'1400'})],[native('a','1',[lot('120000')],'USD')]);
  assert.equal(result.status,'ready');assert.equal(result.positions[0].costKrw,'120000');assert.equal(result.positions[0].pnlKrw,'20000');assert.equal(result.positions[0].avgCost,null);
});
test('new holdings require separately admitted historical templates at the original cutoff',()=>{
  const noPrice=run([], [native('new','2',[lot('100')])]);
  assert.deepEqual(noPrice,{status:'blocked',reason:'missing_revision_price_evidence',assetIds:['new']});
  const result=run([], [native('new','2',[lot('100')])],{positionTemplates:[position('new')]});
  assert.equal(result.status,'ready');assert.equal(result.positions[0].marketValueKrw,'240');
  const changedCutoff=run([], [native('new','2')],{positionTemplates:[position('new',{cycleEndAt:new Date('2026-09-30T22:00:00Z')})]});
  assert.equal(changedCutoff.reason,'revision_snapshot_scope_mismatch');
});
test('a positive holding with missing frozen price or FX blocks instead of reusing old valuation',()=>{
  for(const patch of [{unitPrice:null,currentPrice:null,closePrice:null},{priceSource:null},{currency:'USD',fxRate:null}]) {
    const result=run([position('a',patch)],[native('a','4',null,patch.currency??'KRW')],
      {portfolio:{...portfolio(),fxRate:null,usdKrw:null}});
    assert.equal(result.reason,'missing_revision_price_evidence');
  }
});
test('scope, sample, duplicate and future-state evidence cannot enter a rebuild',()=>{
  for(const patch of [{canonicalOwnerUserId:'another-owner'},{accountId:'another-account'},{isSample:true},{snapshotDate:'2026-10-01'}]) {
    assert.equal(run([position('a',patch)],[native('a','4')]).reason,'revision_snapshot_scope_mismatch');
  }
  assert.equal(run([position(),position()],[native('a','4')]).reason,'revision_snapshot_identity_duplicate');
  assert.equal(run([position()],[native('a','4'),native('a','4')]).reason,'revision_snapshot_identity_duplicate');
  assert.equal(run([position()],[native('a','4')],{state:{...state([native('a','4')]),at:cutoff.toISOString()}}).reason,'revision_snapshot_scope_mismatch');
  assert.equal(run([position()],[native('a','4')],{portfolio:portfolio(2)}).reason,'revision_snapshot_positions_incomplete');
});
test('drops stale movement and realized summaries while preserving original observations and input rows',()=>{
  const input={portfolio:portfolio(),positions:[position()],state:state([native('a','4')]),revision:2};
  const original=structuredClone(input);
  const result=buildHoldingsRevisionSnapshot(input);
  assert.equal(result.status,'ready');assert.deepEqual(input,original);
  assert.equal(result.portfolio.capturedAt,captured);assert.equal(result.portfolio.cycleEndAt,cutoff);
  assert.equal(result.positions[0].priceSource,'kis_saved');assert.equal(result.positions[0].closePrice,'119');
  assert.equal(result.portfolio.thematicWeight,null,'missing historical classification must not reuse the old weight');
  for(const field of ['previousFxRate','previousQuantity','previousUnitPrice','previousUnitValueKrw','previousMarketValueKrw','priceChangeKrw','fxChangeKrw','marketValueChangeKrw','marketValueChangePct','unitValueChangeKrw','unitValueChangePct','previousReferenceDate','previousSnapshotDate'])assert.equal(result.positions[0][field],null,field);
  assert.match(result.portfolio.description,/native_revision=2/);assert.doesNotMatch(result.portfolio.description,/native_revision=1(?:;|$)/);
  assert.match(result.portfolio.description,/realized_pnl_krw=unknown/);assert.doesNotMatch(result.portfolio.description,/realized_pnl_krw=123/);
  assert.equal(result.portfolio.portfolioVolatility,null);assert.equal(result.portfolio.benchmarkValue,'500');
});
test('execution-time collection includes an equal-time state while pre-cutoff snapshots remain strict',()=>{
  const atBoundary={...state([native('a','4')]),at:cutoff.toISOString()};
  const executionPortfolio={...portfolio(),description:`${portfolio().description}; valuation_policy=execution_collection_v1`};
  const included=run([position()],[native('a','4')],{state:atBoundary,portfolio:executionPortfolio});
  assert.equal(included.status,'ready');assert.equal(included.positions[0].quantity,'4');assert.equal(included.positions[0].marketValueKrw,'480');
  assert.equal(run([position()],[native('a','4')],{state:atBoundary}).reason,'revision_snapshot_scope_mismatch');
  assert.equal(run([position()],[native('a','4')],{state:{...atBoundary,at:new Date(cutoff.getTime()+1).toISOString()},portfolio:executionPortfolio}).reason,'revision_snapshot_scope_mismatch');
});

function aggregateInput() {
  const original={...portfolio(),account:'all',accountId:null,description:'snapshot_status=complete; accounts=2; native_revision=1',numAssets:99};
  const first={...portfolio(),totalMarketValue:'100',totalCost:'80',totalPnl:'20',numAssets:1,numGroups:1,krWeight:'100',usWeight:'0',usdExposurePct:'0',thematicWeight:'20'};
  const second={...portfolio(),accountId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',account:'isa',totalMarketValue:'300',totalCost:'350',totalPnl:'-50',numAssets:2,numGroups:2,krWeight:'0',usWeight:'100',usdExposurePct:'100',thematicWeight:'40',cycleEndAt:new Date('2026-09-29T22:10:00Z')};
  return {original,members:[first,second]};
}
test('aggregates complete accounts with different capture cutoffs and recomputed weights',()=>{
  const input=aggregateInput(), before=structuredClone(input);
  const result=buildHoldingsRevisionAggregate(input.original,input.members,3);
  assert.equal(result.status,'ready');
  assert.equal(result.portfolio.totalMarketValue,'400');assert.equal(result.portfolio.totalCost,'430');assert.equal(result.portfolio.totalPnl,'-30');
  assert.equal(result.portfolio.krWeight,'25');assert.equal(result.portfolio.usWeight,'75');assert.equal(result.portfolio.usdExposurePct,'75');assert.equal(result.portfolio.thematicWeight,'35');
  assert.equal(result.portfolio.numAssets,3);assert.equal(result.portfolio.numGroups,3);assert.equal(result.portfolio.cashValue,'0');
  assert.equal(result.portfolio.capturedAt,captured);assert.equal(result.portfolio.cycleEndAt,cutoff);
  assert.equal(result.portfolio.topHoldingName,null);assert.equal(result.portfolio.topHoldingWeight,null);assert.equal(result.portfolio.totalReturnPct,null);
  assert.match(result.portfolio.description,/snapshot_status=complete/);assert.match(result.portfolio.description,/native_revision=3/);
  assert.equal(result.portfolio.enb,null);assert.deepEqual(input,before);
});
test('aggregate unknown cost, profit or weight remains unknown independently',()=>{
  const {original,members}=aggregateInput();
  members[1]={...members[1],totalCost:null,totalPnl:null,thematicWeight:null};
  const result=buildHoldingsRevisionAggregate(original,members,3);
  assert.equal(result.status,'ready');assert.equal(result.portfolio.totalMarketValue,'400');
  assert.equal(result.portfolio.totalCost,null);assert.equal(result.portfolio.investedAmount,null);assert.equal(result.portfolio.totalPnl,null);
  assert.equal(result.portfolio.thematicWeight,null);assert.equal(result.portfolio.usWeight,'75');
});
test('aggregate rejects missing, duplicate and mismatched account members',()=>{
  const {original,members}=aggregateInput();
  for(const candidates of [members.slice(0,1),[members[0],members[0]],
    [members[0],{...members[1],canonicalOwnerUserId:'other'}], [members[0],{...members[1],snapshotDate:'2026-10-01'}],
    [members[0],{...members[1],source:'other'}], [members[0],{...members[1],description:'snapshot_status=partial'}]]) {
    assert.equal(buildHoldingsRevisionAggregate(original,candidates,3).reason,'revision_aggregate_members_incomplete');
  }
  assert.equal(buildHoldingsRevisionAggregate({...original,description:'snapshot_status=complete'},members,3).status,'blocked');
});
