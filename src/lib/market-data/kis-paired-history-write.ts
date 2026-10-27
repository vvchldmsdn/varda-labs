import type { ClosePrice } from "./providers/types";
import { confirmedKisHistoryRevisions, isFinalizedKisHistoryDate, KIS_HISTORY_REVISION_POLICY } from "./kis-history-revision-policy";

export type KisHistoryClaim = {key:string;claimToken:string};
type Query = (query:string,params:unknown[])=>Promise<Record<string,unknown>[]>;
/** Locks the live claim and existing prices. Raw revisions require two independent
 * matching provider reads, preserve before/after audit data, and never touch user valuations. */
export async function writeKisPairedHistory(query:Query,claim:KisHistoryClaim,rows:readonly ClosePrice[],firstObservation:readonly ClosePrice[] = []) {
 if (!/^kis:history:paired_v1:/.test(claim.key) || !/^[a-f0-9-]{36}$/i.test(claim.claimToken) || rows.length<1 || rows.length>100) throw new Error("kis_paired_write_boundary");
 const seen=new Set<string>();
 for(const r of rows) {
  const key=[r.market,r.currency,r.ticker,r.priceDate].join(":");
  const prefix=r.market==="korea" ? "kis_domestic_itemchartprice" : "kis_overseas_dailyprice:"+r.providerExchange;
  if(seen.has(key) || r.source!==prefix+":raw_v2" || r.adjustedCloseSource!==prefix+":adjusted_v1" ||
    r.status!=="ok" || r.adjustedCloseBasis!=="provider_adjusted_close_v1" || r.adjustedCloseProvider!=="kis" ||
    !(Number(r.closePrice)>0) || !(Number(r.adjustedClosePrice)>0) || !Number.isFinite(Number(r.closePrice)) || !Number.isFinite(Number(r.adjustedClosePrice)) ||
    !r.providerSymbol || !r.providerExchange || !(r.adjustedCloseFetchedAt instanceof Date) ||
    !(r.fetchedAt instanceof Date) || !Number.isFinite(r.fetchedAt.getTime()) || !Number.isFinite(r.adjustedCloseFetchedAt.getTime()) ||
    r.fetchedAt.getTime()>Date.now() || r.adjustedCloseFetchedAt.getTime()>Date.now() || r.isSample ||
    !isFinalizedKisHistoryDate(r)) throw new Error("kis_paired_provenance_invalid");
  seen.add(key);
 }
 const confirmations=confirmedKisHistoryRevisions(rows,firstObservation);
 const result=await query(KIS_PAIRED_HISTORY_WRITE_SQL,[claim.key,claim.claimToken,JSON.stringify(rows),JSON.stringify(confirmations),KIS_HISTORY_REVISION_POLICY.maximumRelativeRawChange]);
 const written=Number(result[0]?.written??0),claimed=Number(result[0]?.claimed??0),inserted=Number(result[0]?.inserted??0);
 return {insertedCount:inserted,updatedCount:written-inserted,skippedCount:0,failedCount:claimed?0:rows.length,conflictCount:claimed?rows.length-written:0,results:(result[0]?.diagnostics??[]) as Array<{reason:string;existing:unknown;candidate:unknown}>};
}
export const KIS_PAIRED_HISTORY_WRITE_SQL = `
with claim as materialized (
 select key,ticker,market,currency,start_date,end_date from market_collection_jobs
 where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp() for update
), input as materialized (
 select r.* from jsonb_to_recordset($3::jsonb) as r(
 "ticker" text,"market" text,"currency" text,"priceDate" date,"closePrice" numeric,
 "adjustedClosePrice" numeric,"adjustedCloseBasis" text,"adjustedCloseProvider" text,"adjustedCloseSource" text,
 "adjustedCloseFetchedAt" timestamptz,"providerSymbol" text,"providerExchange" text,"fetchedAt" timestamptz,"source" text)
), confirmed as materialized (
 select r.* from jsonb_to_recordset($4::jsonb) as r(
 "ticker" text,"market" text,"currency" text,"priceDate" date,"closePrice" numeric,"fetchedAt" timestamptz,"firstObservation" jsonb)
), previous as materialized (
 select e.* from asset_price_snapshots e join input i
 on e.ticker=i.ticker and e.market=i.market and e.currency=i.currency and e.date=i."priceDate"
 where exists(select 1 from claim) for update of e
), written as (
 insert into asset_price_snapshots as existing (ticker,market,currency,date,close_price,adjusted_close_price,
 adjusted_close_basis,adjusted_close_provider,adjusted_close_source,adjusted_close_fetched_at,
 provider_symbol,provider_exchange,fetched_at,source,is_sample)
 select i."ticker",i."market",i."currency",i."priceDate",i."closePrice",i."adjustedClosePrice",i."adjustedCloseBasis",
 i."adjustedCloseProvider",i."adjustedCloseSource",i."adjustedCloseFetchedAt",i."providerSymbol",i."providerExchange",i."fetchedAt",i."source",false
 from input i cross join claim c where i.ticker=c.ticker and i.market=c.market and i.currency=c.currency and i."priceDate" between c.start_date and c.end_date
 and (select count(*) from previous)>=0
 on conflict(market,currency,ticker,date) do update set
 close_price=excluded.close_price,
 close_price_krw=case when existing.close_price=excluded.close_price then existing.close_price_krw
   when existing.currency='KRW' then excluded.close_price when existing.fx_rate>0 then excluded.close_price*existing.fx_rate else null end,
 source=case when existing.close_price<>excluded.close_price then excluded.source else existing.source end,
 fetched_at=case when existing.close_price<>excluded.close_price or existing.fetched_at is null then excluded.fetched_at else existing.fetched_at end,
 updated_at=case when existing.close_price<>excluded.close_price or existing.fetched_at is null then clock_timestamp() else existing.updated_at end,
 adjusted_close_price=excluded.adjusted_close_price,adjusted_close_basis=excluded.adjusted_close_basis,
 adjusted_close_provider=excluded.adjusted_close_provider,adjusted_close_source=excluded.adjusted_close_source,
 adjusted_close_fetched_at=excluded.adjusted_close_fetched_at
 where existing.is_sample=false and existing.close_price>0
 and (existing.fetched_at is null or existing.fetched_at<=excluded.fetched_at)
 and existing.source in (excluded.source,replace(excluded.source,':raw_v2',''))
 and existing.provider_symbol=excluded.provider_symbol and existing.provider_exchange=excluded.provider_exchange
 and (existing.close_price=excluded.close_price or (
  abs(existing.close_price-excluded.close_price)/existing.close_price<=$5::numeric
  and exists(select 1 from confirmed c where c.ticker=excluded.ticker and c.market=excluded.market and c.currency=excluded.currency
   and c."priceDate"=excluded.date and c."closePrice"=excluded.close_price and c."fetchedAt"=excluded.fetched_at
   and (c."firstObservation"->>'fetchedAt')::timestamptz>existing.fetched_at)))
 and (existing.adjusted_close_price is null or (
 existing.adjusted_close_basis=excluded.adjusted_close_basis and existing.adjusted_close_provider=excluded.adjusted_close_provider
 and existing.adjusted_close_source=excluded.adjusted_close_source and existing.adjusted_close_fetched_at<=excluded.adjusted_close_fetched_at))
 returning *, (xmax=0) as inserted
), revisions as materialized (
 select jsonb_build_object('before',to_jsonb(p),'after',to_jsonb(w)-'inserted','firstObservation',c."firstObservation") as detail
 from written w join previous p using(ticker,market,currency,date)
 join confirmed c on c.ticker=w.ticker and c.market=w.market and c.currency=w.currency and c."priceDate"=w.date
 where p.close_price<>w.close_price
), revision_evidence as (
 insert into market_data_sync_runs(job_type,mode,status,started_at,finished_at,source,requested_count,success_count,metadata_json)
 select 'kis_confirmed_close_revision','history','completed',clock_timestamp(),clock_timestamp(),'kis',count(*),count(*),
 jsonb_build_object('policy','kis_confirmed_history_revision_v2','claimKey',$1::text,'comparisons',jsonb_agg(detail))
 from revisions having count(*)>0 returning id
), diagnostics as materialized (
 select jsonb_build_object('reason',case when e.id is null then 'claim_or_window_rejected'
 when e.source not in(i.source,replace(i.source,':raw_v2','')) then 'protected_existing_provenance'
 when e.provider_symbol is distinct from i."providerSymbol" or e.provider_exchange is distinct from i."providerExchange" then 'provider_identity_mismatch'
 when e.fetched_at>i."fetchedAt" then 'older_provider_observation'
 when e.is_sample or e.close_price<=0 or (e.close_price<>i."closePrice" and e.fetched_at is null) then 'protected_existing_provenance'
 when e.adjusted_close_price is not null and (
  e.adjusted_close_basis is distinct from i."adjustedCloseBasis" or e.adjusted_close_provider is distinct from i."adjustedCloseProvider"
  or e.adjusted_close_source is distinct from i."adjustedCloseSource" or e.adjusted_close_fetched_at is null
  or e.adjusted_close_fetched_at>i."adjustedCloseFetchedAt") then 'protected_existing_provenance'
 when e.close_price<>i."closePrice" and abs(e.close_price-i."closePrice")/nullif(e.close_price,0)>$5::numeric then 'raw_revision_exceeds_review_limit'
 when e.close_price<>i."closePrice" then 'raw_revision_requires_matching_requery'
 else 'protected_existing_provenance' end,
 'existing',jsonb_build_object('closePrice',e.close_price,'source',e.source,'providerSymbol',e.provider_symbol,'providerExchange',e.provider_exchange,'adjustedClosePrice',e.adjusted_close_price,'fetchedAt',e.fetched_at),'candidate',to_jsonb(i)) as detail
 from input i left join asset_price_snapshots e on e.ticker=i.ticker and e.market=i.market and e.currency=i.currency and e.date=i."priceDate"
 where exists(select 1 from claim) and not exists(select 1 from written w where w.ticker=i.ticker and w.market=i.market and w.currency=i.currency and w.date=i."priceDate")
), evidence as (
 insert into market_data_sync_runs(job_type,mode,status,started_at,finished_at,source,requested_count,failed_count,metadata_json)
 select 'kis_paired_history_conflict','history','failed',clock_timestamp(),clock_timestamp(),'kis',
 (select count(*) from input),count(*),jsonb_build_object('claimKey',$1::text,'comparisons',jsonb_agg(detail))
 from diagnostics having count(*)>0 returning id
) select coalesce((select jsonb_agg(detail) from diagnostics),'[]'::jsonb) diagnostics,
(select count(*) from revision_evidence) revision_evidence_count,(select count(*) from revisions)::int revised,
(select count(*) from evidence) evidence_count,(select count(*) from claim)::int claimed,(select count(*) from written)::int written,(select count(*) from written where inserted)::int inserted`;
