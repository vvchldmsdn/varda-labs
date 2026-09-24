import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Decimal } from '../../src/lib/money.ts';
import { resolveSnapshotCycle } from '../../src/lib/snapshots/market-calendar.ts';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const decimal = /^\d{1,14}(?:\.\d{1,6})?$/;
export function projectBrokerAcquisitionAverageCost(totalAmount, quantity) {
  assert.ok(Decimal.from(totalAmount).compare(0)>0 && Decimal.from(quantity).compare(0)>0,'invalid_acquisition_basis');
  const units=Decimal.from(totalAmount).div(quantity).mul(10000).minor('KRW','nearest');
  return new Decimal(units,10000n).toExactString();
}
export function recoveryHash(value) {
  const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,normalize(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}
export async function readBrokerRecoveryState(client, ownerId, accountId) {
  assert.match(ownerId,uuid); assert.match(accountId,uuid);
  const account = (await client.query('select to_jsonb(a) as value from accounts a where id=$1 and canonical_owner_user_id=$2',[accountId,ownerId])).rows;
  assert.equal(account.length,1,'recovery_account_not_unique');
  assert.equal(account[0].value.is_active,true,'recovery_account_inactive');
  assert.equal(account[0].value.native_state,null,'recovery_native_account_forbidden');
  const assets = (await client.query('select to_jsonb(a) as value from assets a where account_id=$1 and canonical_owner_user_id=$2 order by id',[accountId,ownerId])).rows.map(r=>r.value);
  const events = (await client.query('select id::text,event_date::text,event_type,asset_id::text,legacy_asset_id,ticker,source,quantity_delta::text,amount_krw::text,price::text,fx_rate::text,before_value,after_value from event_ledger_entries where account_id=$1 and canonical_owner_user_id=$2 order by id',[accountId,ownerId])).rows;
  const memberships=(await client.query('select to_jsonb(m) as value from portfolio_group_asset_memberships m join assets a on a.id=m.asset_id where a.account_id=$1 and m.canonical_owner_user_id=$2 order by m.id',[accountId,ownerId])).rows.map(r=>r.value);
  return { account: account[0].value, assets, events, memberships };
}
export function validateBrokerRecoveryPlan(plan) {
  assert.equal(plan.version,1); assert.equal(plan.cashValuation,'excluded');
  for (const id of [plan.id,plan.ownerId,plan.accountId]) assert.match(id,uuid);
  assert.match(plan.expectedStateHash,/^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(plan.holdings) && plan.holdings.length>0 && plan.holdings.length<=200);
  assert.ok(Array.isArray(plan.trades) && plan.trades.length>0 && plan.trades.length<=1000);
  const holdings = new Map(), instruments = new Set();
  for (const holding of plan.holdings) {
    assert.match(holding.id,uuid); assert.ok(!holdings.has(holding.id),'duplicate_recovery_asset');
    assert.ok(['korea','us'].includes(holding.market)); assert.ok(['KRW','USD'].includes(holding.currency));
    assert.equal(holding.currency,holding.market==='us'?'USD':'KRW');
    assert.match(holding.ticker,/^[A-Z0-9.\-]{1,32}$/);
    const instrument = `${holding.market}:${holding.ticker}`;
    assert.ok(!instruments.has(instrument),'duplicate_recovery_instrument'); instruments.add(instrument); assert.ok(typeof holding.name==='string' && holding.name.length>0 && holding.name.length<=255);
    assert.ok(['stock','etf'].includes(holding.assetType));
    assert.match(holding.startQuantity,decimal); assert.match(holding.endQuantity,decimal);
    assert.match(holding.fractionalQuantityBefore ?? '0',decimal);
    assert.ok(typeof holding.removeFractionalDisplay === 'boolean');
    if (holding.averageCost !== null) { assert.match(holding.averageCost,/^\d{1,16}(?:\.\d{1,4})?$/); assert.ok(Decimal.from(holding.averageCost).compare(0)>0); }
    holdings.set(holding.id,{holding,quantity:Decimal.from(holding.startQuantity),lastDate:''});
  }
  const seen = new Set();
  for (const trade of plan.trades) {
    assert.match(trade.id,uuid); assert.ok(!seen.has(trade.id),'duplicate_recovery_event'); seen.add(trade.id);
    assert.match(trade.rowId,/^[a-zA-Z0-9_-]{1,120}$/);
    assert.ok(['buy','sell'].includes(trade.side)); assert.match(trade.quantity,decimal); assert.ok(Decimal.from(trade.quantity).compare(0)>0);
    assert.match(trade.tradeDate,/^\d{4}-\d{2}-\d{2}$/); assert.equal(new Date(trade.tradeDate+'T00:00:00Z').toISOString().slice(0,10),trade.tradeDate);
    assert.ok(trade.tradeDate<=new Date().toISOString().slice(0,10),'future_recovery_trade');
    const entry=holdings.get(trade.assetId); assert.ok(entry,'recovery_trade_asset_missing');
    if(trade.orderUnitPrice != null) {
      assert.equal(trade.orderUnitPrice.currency,entry.holding.currency,'order_currency_mismatch');
      assert.match(trade.orderUnitPrice.amount,/^\d{1,16}(?:\.\d{1,12})?$/);
      assert.ok(Decimal.from(trade.orderUnitPrice.amount).compare(0)>0,'invalid_order_unit_price');
    }
    assert.ok(trade.tradeDate>=entry.lastDate,'recovery_trade_order'); entry.lastDate=trade.tradeDate;
    entry.quantity=entry.quantity.add(Decimal.from(trade.quantity).mul(trade.side==='buy'?1:-1)); assert.ok(entry.quantity.compare(0)>=0,'recovery_oversell');
    for (const money of [trade.executionGross,trade.originalDisplay,trade.cashSettlement]) if (money) {
      assert.ok(['KRW','USD'].includes(money.currency)); assert.equal(typeof money.amount,'string');
      assert.ok(Decimal.from(money.amount).compare(0)>0); Decimal.from(money.amount).minor(money.currency,'exact');
    }
    if (trade.cashSettlement) {
      assert.match(trade.cashSettlement.date,/^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(trade.cashSettlement.date+'T00:00:00Z').toISOString().slice(0,10),trade.cashSettlement.date);
      assert.ok(trade.cashSettlement.date>=trade.tradeDate,'settlement_precedes_trade');
    }
    assert.equal(trade.fee,null); assert.equal(trade.tax,null); // no invented breakdown
    assert.ok(Array.isArray(trade.evidence) && trade.evidence.length>0,'recovery_evidence_missing');
  }
  for (const {holding,quantity} of holdings.values()) assert.equal(quantity.compare(holding.endQuantity),0,'recovery_final_quantity_mismatch');
  for(const {holding} of holdings.values()) if(holding.acquisitionBasis != null) {
    const basis=holding.acquisitionBasis, trades=plan.trades.filter(t=>t.assetId===holding.id);
    assert.equal(basis.policy,'gross_buys_half_up_4dp_v1'); assert.equal(basis.feesIncluded,false);
    assert.equal(basis.currency,holding.currency);
    assert.equal(Decimal.from(holding.startQuantity).compare(0),0,'acquisition_basis_requires_zero_start');
    assert.ok(trades.length>0 && trades.every(t=>t.side==='buy' && t.executionGross?.currency===holding.currency),'acquisition_basis_requires_known_buys');
    const total=trades.reduce((sum,t)=>sum.add(t.executionGross.amount),Decimal.from(0));
    const quantity=trades.reduce((sum,t)=>sum.add(t.quantity),Decimal.from(0));
    assert.equal(typeof basis.totalAmount,'string'); assert.equal(typeof basis.quantity,'string');
    assert.equal(total.compare(basis.totalAmount),0,'acquisition_basis_total_mismatch');
    assert.equal(quantity.compare(basis.quantity),0,'acquisition_basis_quantity_mismatch');
    assert.equal(quantity.compare(holding.endQuantity),0,'acquisition_basis_quantity_mismatch');
    assert.equal(Decimal.from(holding.averageCost).compare(projectBrokerAcquisitionAverageCost(basis.totalAmount,basis.quantity)),0,'acquisition_basis_rounding_mismatch');
  }
  assert.equal(new Set(plan.trades.map(t=>t.rowId)).size,plan.trades.length,'duplicate_recovery_row');
  return recoveryHash(plan);
}

/** Dedicated operator only. Inject an already-authorized pg Client. No URL/env discovery.
 * Default dry-run executes all constraints and assertions, then rolls back.
 * Cash/native state and existing snapshots are deliberately not mutated. */
export async function recoverBrokerSecurities(client, plan, { write = false, confirmation, restoreVerified = false } = {}) {
  const manifestHash=validateBrokerRecoveryPlan(plan);
  if (write) { assert.equal(confirmation,manifestHash,'recovery_confirmation_mismatch'); assert.equal(restoreVerified,true,'restore_not_verified'); }
  await client.query('begin');
  try {
    await client.query("set local lock_timeout='3s'"); await client.query("set local statement_timeout='20s'");
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`varda.portfolio_mutation.v1:${plan.ownerId}`]);
    const prior=(await client.query('select id,manifest_hash,after_state from broker_recovery_batches where canonical_owner_user_id=$1 and account_id=$2 and (id=$3 or manifest_hash=$4)',[plan.ownerId,plan.accountId,plan.id,manifestHash])).rows;
    if(prior.length) {
      assert.equal(prior.length,1); assert.equal(prior[0].id,plan.id); assert.equal(prior[0].manifest_hash,manifestHash,'recovery_id_conflict');
      await client.query('rollback'); return {status:'existing',manifestHash,holdings:plan.holdings.length,trades:plan.trades.length};
    }
    await client.query('select id from accounts where id=$1 and canonical_owner_user_id=$2 for update',[plan.accountId,plan.ownerId]);
    await client.query('select id from assets where account_id=$1 and canonical_owner_user_id=$2 order by id for update',[plan.accountId,plan.ownerId]);
    const before=await readBrokerRecoveryState(client,plan.ownerId,plan.accountId);
    assert.equal(recoveryHash(before),plan.expectedStateHash,'recovery_state_changed');
    assert.ok((await client.query("select id from app_users where id=$1 and status='active'",[plan.ownerId])).rows.length===1,'recovery_owner_inactive');
    const existing=new Map(before.assets.map(a=>[a.id,a]));
    for(const holding of plan.holdings) {
      const old=existing.get(holding.id);
      assert.equal(before.assets.filter(a=>a.ticker?.toUpperCase()===holding.ticker && a.market===holding.market).length,old?1:0,'recovery_instrument_collision');
      if(old) {
        assert.equal(old.ticker?.toUpperCase(),holding.ticker); assert.equal(old.currency,holding.currency); assert.equal(old.market,holding.market);
        // Recovered fractional quantities must be explicitly linked to the old manual display.
        assert.ok(holding.removeFractionalDisplay || !old.fractional_krw_value || Decimal.from(old.fractional_krw_value).compare(0)===0,'unresolved_fractional_display');
        const extra=Decimal.from(holding.fractionalQuantityBefore??'0');
        assert.equal(Decimal.from(old.quantity).add(extra).compare(holding.startQuantity),0,'recovery_start_quantity_mismatch');
        if(extra.compare(0)>0) assert.equal(holding.removeFractionalDisplay,true,'fractional_quantity_requires_display_conversion');
      } else assert.equal(holding.startQuantity,'0','new_recovery_asset_not_zero');
    }
    // Any possibly corresponding earlier trade must be resolved before replay.
    for(const trade of plan.trades) {
      const h=plan.holdings.find(h=>h.id===trade.assetId), old=existing.get(trade.assetId);
      assert.ok(!before.events.some(e=>e.event_date===trade.tradeDate && [trade.side,`native_${trade.side}`].includes(e.event_type) &&
        (e.asset_id===trade.assetId || (!e.asset_id && ((old?.legacy_base44_id && e.legacy_asset_id===old.legacy_base44_id) || e.ticker?.toUpperCase()===h.ticker)))),'possible_duplicate_trade');
    }
    const snapshotBefore=(await client.query('select id::text,source,snapshot_date::text,updated_at::text from daily_portfolio_snapshots where canonical_owner_user_id=$1 order by id',[plan.ownerId])).rows;
    await client.query('insert into broker_recovery_batches(id,canonical_owner_user_id,account_id,manifest_hash,expected_state_hash,before_state,after_state,manifest) values($1,$2,$3,$4,$5,$6,$7,$8)',[plan.id,plan.ownerId,plan.accountId,manifestHash,plan.expectedStateHash,JSON.stringify(before),'{}',JSON.stringify(plan)]);
    for(const holding of plan.holdings) {
      if(!existing.has(holding.id)) {
        // A verified stored quote is allowed; an execution or settlement is not a current quote.
        const quote=(await client.query("select price::text,source,status,price_as_of,fetched_at,quote_type from live_price_quotes where ticker=$1 and market=$2 and currency=$3 and provider='kis' and source like 'kis%' and status='ok' and quote_type in ('live','close') and price>0 and price_as_of<=fetched_at and fetched_at<=now() and price_as_of>=now()-interval '10 days' order by fetched_at desc limit 1",[holding.ticker,holding.market,holding.currency])).rows[0];
        assert.ok(quote || Decimal.from(holding.endQuantity).compare(0)===0,'recovery_new_holding_quote_missing');
        await client.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,price_source,price_status,price_as_of,price_fetched_at,price_quote_type) values($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,$14,$15)",[holding.id,plan.ownerId,plan.accountId,before.account.code,holding.name,holding.ticker,holding.market,holding.currency,holding.assetType,quote?.price??'0',quote?.source??'broker_recovery_unpriced',quote?.status??'missing',quote?.price_as_of??null,quote?.fetched_at??null,quote?.quote_type??null]);
      }
      const result=await client.query("update assets set quantity=$4,average_cost=$5,fractional_krw_value=case when $6 then null else fractional_krw_value end,fractional_avg_cost=case when $6 then null else fractional_avg_cost end,archived_at=case when $4::numeric=0 then coalesce(archived_at,now()) else null end,updated_at=greatest(now(),updated_at+interval '1 millisecond') where id=$1 and canonical_owner_user_id=$2 and account_id=$3 returning id,archived_at::text,updated_at::text",[holding.id,plan.ownerId,plan.accountId,holding.endQuantity,holding.averageCost,holding.removeFractionalDisplay]);
      assert.equal(result.rowCount,1,'recovery_asset_update_mismatch');
      const old=existing.get(holding.id), current=result.rows[0];
      if(old && Boolean(old.archived_at)!==Boolean(current.archived_at)) {
        const type=current.archived_at?'archived':'restored';
        if(type==='archived') {
          const serviceDate=resolveSnapshotCycle().snapshotDate;
          await client.query('delete from portfolio_group_asset_memberships where asset_id=$1 and canonical_owner_user_id=$2 and valid_from >= $3::date',[holding.id,plan.ownerId,serviceDate]);
          await client.query('update portfolio_group_asset_memberships set valid_to=$3::date where asset_id=$1 and canonical_owner_user_id=$2 and valid_from<$3::date and (valid_to is null or valid_to>$3::date)',[holding.id,plan.ownerId,serviceDate]);
        }
        await client.query("insert into holding_lifecycle_events(canonical_owner_user_id,asset_id,account_id,event_type,previous_archived_at,resulting_archived_at,previous_asset_updated_at,resulting_asset_updated_at,reason,policy_version,occurred_at) values($1,$2,$3,$4,$5,$6,$7,$8,'Broker evidence recovery','holding_lifecycle_v1',$8)",[plan.ownerId,holding.id,plan.accountId,type,old.archived_at,current.archived_at,old.updated_at,current.updated_at]);
      }
    }
    const projected=new Map(plan.holdings.map(h=>[h.id,Decimal.from(h.startQuantity)]));
    for(const trade of plan.trades) {
      const holding=plan.holdings.find(h=>h.id===trade.assetId), priorQuantity=projected.get(trade.assetId);
      const quantityDelta=Decimal.from(trade.quantity).mul(trade.side==='buy'?1:-1), afterQuantity=priorQuantity.add(quantityDelta); projected.set(trade.assetId,afterQuantity);
      const amountKrw=trade.executionGross?.currency==='KRW'?trade.executionGross.amount:null;
      const data={...trade,version:1,timePrecision:'date_only',chargeClassification:'unconfirmed'};
      await client.query("insert into event_ledger_entries(id,canonical_owner_user_id,account_id,account,asset_id,legacy_asset_id,ticker,asset_name,event_date,event_type,source,rule_version,recorded_at,quantity_delta,amount_krw,price,fx_rate,before_value,after_value,broker_recovery_batch_id,broker_recovery_data) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'broker_recovery_v1','broker_recovery_v1',now(),$11,$12,null,null,$13,$14,$15,$16)",[trade.id,plan.ownerId,plan.accountId,before.account.code,trade.assetId,existing.get(trade.assetId)?.legacy_base44_id??null,holding.ticker,holding.name,trade.tradeDate,trade.side,quantityDelta.toExactString(),amountKrw,JSON.stringify({quantity:priorQuantity.toExactString()}),JSON.stringify({quantity:afterQuantity.toExactString()}),plan.id,JSON.stringify(data)]);
    }
    const after=await readBrokerRecoveryState(client,plan.ownerId,plan.accountId);
    assert.deepEqual(after.account,before.account,'recovery_account_or_cash_changed');
    for(const h of plan.holdings) {
      const actual=after.assets.find(a=>a.id===h.id); assert.ok(actual); assert.equal(Decimal.from(actual.quantity).compare(h.endQuantity),0);
      assert.equal(actual.average_cost===null,h.averageCost===null);
      if(h.averageCost!==null) assert.equal(Decimal.from(actual.average_cost).compare(h.averageCost),0,'recovery_cost_mismatch');
      if(h.removeFractionalDisplay) {assert.equal(actual.fractional_krw_value,null);assert.equal(actual.fractional_avg_cost,null);}
    }
    assert.equal(after.events.length,before.events.length+plan.trades.length);
    const snapshotAfter=(await client.query('select id::text,source,snapshot_date::text,updated_at::text from daily_portfolio_snapshots where canonical_owner_user_id=$1 order by id',[plan.ownerId])).rows;
    assert.deepEqual(snapshotAfter,snapshotBefore,'recovery_snapshot_changed');
    await client.query('update broker_recovery_batches set after_state=$2 where id=$1',[plan.id,JSON.stringify(after)]);
    await client.query(write?'commit':'rollback');
    return {status:write?'applied':'dry-run',manifestHash,holdings:plan.holdings.length,trades:plan.trades.length,cashChanged:false,snapshotsChanged:false};
  } catch(error) { await client.query('rollback').catch(()=>{}); throw error; }
}
