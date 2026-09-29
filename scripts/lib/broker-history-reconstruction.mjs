import assert from 'node:assert/strict';
import {MANUAL_VALUATION_HISTORY_POLICY} from '../../src/lib/manual-valuation-history.ts';
import {Decimal} from '../../src/lib/money.ts';
import {buildCycleForSnapshotDate,closeCalendarReferenceDateForAsset,resolveSnapshotCycle} from '../../src/lib/snapshots/market-calendar.ts';
import {readBrokerRecoveryState,recoveryHash} from './broker-securities-recovery.mjs';

export const RECONSTRUCTION_PREFIX='broker_reconstructed_close_v1:';
const shiftDate=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const day=value=>String(value).slice(0,10);
const positive=value=>value!=null && Decimal.from(String(value)).compare(0)>0;
const numeric=value=>Decimal.from(String(value));
const exact=value=>value.toExactString();
/** Date-only evidence is an interval, never an invented execution timestamp. */
export function tradeAtCutoff(trade,date){
  if(trade.tradeDate<date)return 'before';
  if(trade.tradeDate>date)return 'after';
  const cutoff=buildCycleForSnapshotDate(date,new Date()).cycleEndAt.getTime();
  if(trade.executedAt){const at=Date.parse(trade.executedAt);assert.ok(Number.isFinite(at));return at<cutoff?'before':'after';}
  // An order lower-bound can prove exclusion, never an exact fill instant.
  if(trade.executionNotBefore && Date.parse(trade.executionNotBefore)>=cutoff)return 'after';
  return 'unknown';
}

/** Pure historical quantity replay and dated-close valuation. No cash, cost or
 * return is inferred from missing settlement/opening evidence. */
export function buildBrokerHistoryFrames({state,batches,prices,fx,positions,startDate,endDate,confirmation=null}){
  assert.match(startDate,/^\d{4}-\d{2}-\d{2}$/);assert.match(endDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(startDate+'T00:00:00Z').toISOString().slice(0,10),startDate);assert.equal(new Date(endDate+'T00:00:00Z').toISOString().slice(0,10),endDate);
  assert.ok(endDate<=resolveSnapshotCycle().snapshotDate,'future_reconstruction');
  const dateCount=(Date.parse(endDate)-Date.parse(startDate))/86400000+1;
  assert.ok(dateCount>0&&dateCount<=31,'reconstruction_range_exceeds_31_days');
  assert.ok(batches.length>0,'reconstruction_opening_missing');
  batches=[...batches].sort((a,b)=>String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const first=batches[0];assert.equal(first.account_id,state.account.id);
  assert.equal(state.account.native_state,null,'native_account_requires_native_replay');
  const owned=new Map(state.assets.map(a=>[a.id,a]));
  const opening=new Map(first.before_state.assets.map(a=>[a.id,{...a,quantity:String(a.quantity??0)}]));
  const earliestTrade=batches.flatMap(b=>b.manifest.trades).map(t=>t.tradeDate).sort()[0];
  assert.ok(startDate>=earliestTrade,'reconstruction_precedes_confirmed_opening');
  const trades=[],seen=new Set();
  if(confirmation){
    assert.equal(confirmation.ownerId,state.account.canonical_owner_user_id,'confirmation_owner_mismatch');
    assert.equal(confirmation.accountId,state.account.id,'confirmation_account_mismatch');
    assert.ok(typeof confirmation.reference==='string'&&confirmation.reference.length>0,'confirmation_reference_missing');
    assert.ok(Number.isFinite(Date.parse(confirmation.confirmedAt))&&Date.parse(confirmation.confirmedAt)<=Date.now(),'confirmation_time_invalid');
    assert.equal(new Set(confirmation.afterCutoffTradeIds).size,confirmation.afterCutoffTradeIds.length,'duplicate_trade_confirmation');
    const manualKeys=new Set();
    for(const m of confirmation.manualValuations){
      assert.ok(owned.has(m.assetId)&&!owned.get(m.assetId).ticker,'confirmed_asset_not_manual');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.date)&&m.date>=startDate&&m.date<=endDate,'manual_confirmation_date_invalid');
      assert.ok(positive(m.totalValueKrw),'manual_confirmation_value_invalid');
      const key=m.assetId+':'+m.date;assert.ok(!manualKeys.has(key),'duplicate_manual_confirmation');manualKeys.add(key);
    }
  }
  for(const batch of batches){
    assert.equal(batch.canonical_owner_user_id,state.account.canonical_owner_user_id);assert.equal(batch.account_id,state.account.id);
    for(const h of batch.manifest.holdings){
      const asset=owned.get(h.id);assert.ok(asset,'reconstruction_asset_missing');
      if(!opening.has(h.id))opening.set(h.id,{...asset,quantity:'0',fractional_krw_value:null});
      if(batch===first){const initial=opening.get(h.id);initial.quantity=h.startQuantity;if(h.removeFractionalDisplay)initial.fractional_krw_value=null;}
    }
    for(const trade of batch.manifest.trades){assert.ok(!seen.has(trade.id),'duplicate_reconstruction_trade');seen.add(trade.id);const confirmed=confirmation?.afterCutoffTradeIds.includes(trade.id);
      if(confirmed&&trade.executedAt)assert.notEqual(tradeAtCutoff(trade,trade.tradeDate),'before','conflicting_execution_confirmation');
      trades.push(confirmed?{...trade,executionNotBefore:buildCycleForSnapshotDate(trade.tradeDate,new Date()).cycleEndAt.toISOString()}:trade);}
  }
  if(confirmation)assert.ok(confirmation.afterCutoffTradeIds.every(id=>seen.has(id)),'unmapped_trade_confirmation');
  // Original event payload is authority; manifest identities must all exist.
  for(const trade of trades){const event=state.events.find(e=>e.id===trade.id);assert.ok(event,'reconstruction_trade_not_applied');
    assert.equal(event.asset_id,trade.assetId);assert.equal(event.event_date,trade.tradeDate);assert.equal(event.event_type,trade.side);
    assert.equal(numeric(event.quantity_delta).compare(numeric(trade.quantity).mul(trade.side==='buy'?1:-1)),0,'reconstruction_event_delta_mismatch');}
  assert.ok(!state.events.some(e=>e.event_date>=earliestTrade&&['buy','sell','native_buy','native_sell'].includes(e.event_type)&&!seen.has(e.id)),'unmapped_financial_event');
  trades.sort((a,b)=>a.tradeDate.localeCompare(b.tradeDate));
  const latest=new Map([...opening].map(([id,a])=>[id,numeric(a.quantity)]));
  for(const t of trades){const q=latest.get(t.assetId);assert.ok(q);const next=q.add(numeric(t.quantity).mul(t.side==='buy'?1:-1));assert.ok(next.compare(0)>=0,'reconstruction_oversell');latest.set(t.assetId,next);}
  for(const asset of state.assets){assert.ok(latest.has(asset.id),'unmapped_current_holding');assert.equal(latest.get(asset.id).compare(String(asset.quantity??0)),0,'current_quantity_does_not_reconcile');}
  const results=[];
  for(let date=startDate;date<=endDate;date=shiftDate(date,1)){
    const reasons=[],rows=[];const quantities=new Map([...opening].map(([id,a])=>[id,numeric(a.quantity)]));
    for(const t of trades){const boundary=tradeAtCutoff(t,date);if(boundary==='unknown')reasons.push({assetId:t.assetId,reason:'execution_time_unknown'});
      if(boundary==='before')quantities.set(t.assetId,quantities.get(t.assetId).add(numeric(t.quantity).mul(t.side==='buy'?1:-1)));}
    const cutoff=buildCycleForSnapshotDate(date,new Date()).cycleEndAt.toISOString();
    const fxRows=fx.filter(f=>!f.is_sample&&f.status==='ok'&&positive(f.usdkrw)&&day(f.date)<date&&day(f.date)>=shiftDate(date,-3)&&f.source&&!/sample|fixture|fallback/i.test(f.source)).sort((a,b)=>day(b.date).localeCompare(day(a.date))||String(b.fetched_at).localeCompare(String(a.fetched_at)));
    const exchange=fxRows[0];
    for(const [id,initial]of opening){const a=owned.get(id);if(!a)continue;const quantity=quantities.get(id);assert.ok(quantity.compare(0)>=0);
      const base={assetId:id,ticker:a.ticker,name:a.name,market:a.market,currency:a.currency,assetType:a.asset_type,quantity:exact(quantity)};
      if(quantity.compare(0)===0&&!positive(initial.fractional_krw_value)){rows.push({...base,valueKrw:'0',price:null,fx:null,priceDate:null,priceSource:null,basis:'confirmed_zero'});continue;}
      if(!a.ticker||positive(initial.fractional_krw_value)){
        const confirmed=confirmation?.manualValuations.find(m=>m.assetId===id&&m.date===date);
        if(confirmed){
          assert.ok(!trades.some(t=>t.assetId===id),'manual_confirmation_has_trades');
          rows.push({...base,valueKrw:confirmed.totalValueKrw,price:null,fx:null,priceDate:date,priceSource:'user_confirmed_total_valuation',basis:'confirmed_manual_total',confirmationReference:confirmation.reference,observationCapturedAt:confirmation.confirmedAt});continue;
        }
        const candidates=positions.filter(p=>p.asset_id===id&&day(p.snapshot_date)===date&&p.cycle_end_at&&new Date(p.cycle_end_at).toISOString()===cutoff&&!p.is_sample&&p.market_value_krw!=null&&numeric(p.quantity??0).compare(quantity)===0);
        if(candidates.length!==1||trades.some(t=>t.assetId===id)){reasons.push({assetId:id,reason:'manual_cutoff_observation_missing'});continue;}
        const p=candidates[0],policy=MANUAL_VALUATION_HISTORY_POLICY;
        const captured=p.captured_at&&Date.parse(p.captured_at),reference=p.reference_date??p.price_date;
        const stored=p.price_source===policy.capturedStoredStatePriceSource;
        const explicit=p.price_source===policy.explicitObservationPriceSource;
        const validReference=reference&&/^\d{4}-\d{2}-\d{2}$/.test(reference)&&Number.isFinite(Date.parse(reference))&&reference<=date;
        if(p.source!==policy.currentSnapshotSource||p.price_basis!==policy.priceBasis||(!stored&&!explicit)||!Number.isFinite(captured)||(!validReference&&!(stored&&reference==null))||!positive(p.current_price)||numeric(p.market_value_krw).compare(0)<0){reasons.push({assetId:id,reason:'manual_valuation_provenance_invalid'});continue;}
        rows.push({...base,valueKrw:String(p.market_value_krw),price:null,fx:null,priceDate:reference??date,priceSource:p.price_source,basis:stored||reference<date?'preserved_stored_manual_carry':'preserved_manual_observation',observationId:p.id,observationCapturedAt:p.captured_at});continue;
      }
      const reference=closeCalendarReferenceDateForAsset(a,date);
      if(reference<shiftDate(date,-7)){reasons.push({assetId:id,reason:'historical_close_stale'});continue;}
      const quotes=prices.filter(p=>p.ticker===a.ticker&&p.market===a.market&&p.currency===a.currency&&day(p.date)===reference&&!p.is_sample&&positive(p.close_price)&&/^kis_/.test(p.source??'')&&!/adjusted|fallback|sample/i.test(p.source));
      if(quotes.length!==1){reasons.push({assetId:id,reason:'historical_close_missing',reference});continue;}
      if(a.currency!=='KRW'&&a.currency!=='USD'){reasons.push({assetId:id,reason:'unsupported_currency'});continue;}
      if(a.currency==='USD'&&!exchange){reasons.push({assetId:id,reason:'historical_fx_missing'});continue;}
      const p=quotes[0],rate=a.currency==='USD'?String(exchange.usdkrw):'1';
      rows.push({...base,valueKrw:exact(quantity.mul(p.close_price).mul(rate)),price:String(p.close_price),fx:rate,priceDate:reference,priceSource:p.source,basis:'reconstructed_dated_close',priceObservationId:p.id,fxObservationId:a.currency==='USD'?exchange.id:null,fxDate:a.currency==='USD'?day(exchange.date):null});
    }
    const complete=reasons.length===0&&rows.length===owned.size;
    results.push({date,cutoff,complete,reasons,positions:rows,totalMarketValue:complete?exact(rows.reduce((sum,p)=>sum.add(p.valueKrw),numeric(0))):null,cashIncluded:false,costAvailable:false,performanceAvailable:false});
  }
  return results;
}

/** Reads only the supplied owner/account and existing shared dated evidence. */
export async function readBrokerHistoryInput(client,ownerId,accountId,startDate,endDate){
  const state=await readBrokerRecoveryState(client,ownerId,accountId);
  const batches=(await client.query('select to_jsonb(b) value from broker_recovery_batches b where canonical_owner_user_id=$1 and account_id=$2 order by recorded_at,id',[ownerId,accountId])).rows.map(r=>r.value);
  const prices=(await client.query('select to_jsonb(p) value from asset_price_snapshots p where date between $3::date-10 and $4::date and (ticker,market,currency) in(select ticker,market,currency from assets where canonical_owner_user_id=$1 and account_id=$2)',[ownerId,accountId,startDate,endDate])).rows.map(r=>r.value);
  const fx=(await client.query('select to_jsonb(f) value from fx_rates f where date between $1::date-3 and $2::date',[startDate,endDate])).rows.map(r=>r.value);
  const positions=(await client.query("select to_jsonb(p) value from daily_position_snapshots p where canonical_owner_user_id=$1 and account_id=$2 and snapshot_date between $3 and $4 and source not like 'broker_reconstructed_close_v1:%'",[ownerId,accountId,startDate,endDate])).rows.map(r=>r.value);
  return{state,batches,prices,fx,positions,startDate,endDate};
}

/** Immutable snapshots keyed by evidence hash. One owner-bounded transaction;
 * original rows are never updated/deleted and no partial account total is saved. */
export async function reconstructBrokerHistory(client,{ownerId,accountId,startDate,endDate,expectedStateHash,write=false,confirmationHash,confirmedBasis,confirmation=null}){
  await client.query('begin');
  try{
    await client.query("set local lock_timeout='3s'");await client.query("set local statement_timeout='30s'");
    await client.query("select set_config('app.trade_reliability_version','0059',true)");await client.query('select assert_trade_reliability_write(false)');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`varda.portfolio_mutation.v1:${ownerId}`]);
    const input=await readBrokerHistoryInput(client,ownerId,accountId,startDate,endDate);
    assert.equal(recoveryHash(input.state),expectedStateHash,'reconstruction_state_changed');
    const frames=buildBrokerHistoryFrames({...input,confirmation}),complete=frames.filter(f=>f.complete);
    assert.ok(complete.reduce((n,f)=>n+f.positions.length+1,0)<=500,'reconstruction_transaction_too_large');
    const hash=recoveryHash({version:2,confirmation,stateHash:expectedStateHash,batchIds:input.batches.map(b=>b.id),frames}),source=RECONSTRUCTION_PREFIX+hash.slice(0,32);
    if(write){assert.equal(confirmationHash,hash,'reconstruction_confirmation_changed');assert.equal(confirmedBasis,'dated_close_reconstruction','reconstruction_basis_not_approved');}
    let inserted=0,existing=0,preserved=0;
    for(const frame of complete){
      const validOriginal=(await client.query(`select id from daily_portfolio_snapshots s where s.canonical_owner_user_id=$1 and s.account_id=$2 and s.snapshot_date=$3 and s.source='varda_manual_daily_snapshot' and s.is_sample=false and s.cycle_end_at=$4 and s.total_market_value is not null and coalesce(s.captured_at,s.created_at)>(select max(recorded_at) from broker_recovery_batches where canonical_owner_user_id=$1 and account_id=$2) limit 1`,[ownerId,accountId,frame.date,frame.cutoff])).rows;
      if(validOriginal.length){preserved++;continue;}
      const old=(await client.query('select id from daily_portfolio_snapshots where canonical_owner_user_id=$1 and account_id=$2 and snapshot_date=$3 and source=$4',[ownerId,accountId,frame.date,source])).rows;
      if(old.length){existing++;continue;}
      const cycle=buildCycleForSnapshotDate(frame.date,new Date());
      const evidence={version:2,confirmation,hash,stateHash:expectedStateHash,batchIds:input.batches.map(b=>b.id),basis:'reconstructed_dated_close',cashIncluded:false,costAvailable:false,performanceAvailable:false,positions:frame.positions};
      await client.query("insert into daily_portfolio_snapshots(canonical_owner_user_id,account_id,account,snapshot_date,source,rule_version,description,total_market_value,num_assets,captured_at,cycle_start_at,cycle_end_at) values($1,$2,$3,$4,$5,'broker_history_reconstruction_v1',$6,$7,$8,clock_timestamp(),$9,$10)",[ownerId,accountId,input.state.account.code,frame.date,source,JSON.stringify(evidence),frame.totalMarketValue,frame.positions.filter(p=>numeric(p.quantity).compare(0)>0).length,cycle.cycleStartAt,cycle.cycleEndAt]);
      for(const p of frame.positions)await client.query('insert into daily_position_snapshots(canonical_owner_user_id,account_id,account,asset_id,asset_name,ticker,market,currency,asset_type,snapshot_date,source,quantity,total_quantity,current_price,unit_price,close_price,market_value_krw,fx_rate,price_date,reference_date,fx_reference_date,price_source,price_basis,description,captured_at,cycle_start_at,cycle_end_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$13,$13,$14,$15,$16,$16,$17,$18,$19,$20,clock_timestamp(),$21,$22)',[ownerId,accountId,input.state.account.code,p.assetId,p.name,p.ticker,p.market,p.currency,p.assetType,frame.date,source,p.quantity,p.price,p.valueKrw,p.fx,p.priceDate,p.fxDate??null,p.priceSource,p.basis,JSON.stringify(p),cycle.cycleStartAt,cycle.cycleEndAt]);
      inserted++;
    }
    assert.equal(recoveryHash(await readBrokerRecoveryState(client,ownerId,accountId)),expectedStateHash,'reconstruction_changed_ledger_or_holdings');
    await client.query(write?'commit':'rollback');
    return{status:write?'applied':'dry-run',hash,source,inserted,existing,preserved,blocked:frames.filter(f=>!f.complete).map(f=>({date:f.date,reasons:f.reasons})),cashChanged:false,ledgerChanged:false};
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
}
