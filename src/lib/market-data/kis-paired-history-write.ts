import type { ClosePrice } from "./providers/types";

export type KisHistoryClaim = {key:string;claimToken:string};
type Query = (query:string,params:unknown[])=>Promise<Record<string,unknown>[]>;
/** A single statement locks the live claim and guards both inserts and updates.
 * Existing raw price, receipt time, FX and ownership links are never overwritten. */
export async function writeKisPairedHistory(query:Query,claim:KisHistoryClaim,rows:readonly ClosePrice[]) {
 if (!/^kis:history:paired_v1:/.test(claim.key) || !/^[a-f0-9-]{36}$/i.test(claim.claimToken) || rows.length<1 || rows.length>100) throw new Error("kis_paired_write_boundary");
 const seen=new Set<string>();
 for(const r of rows) {
  const key=[r.market,r.currency,r.ticker,r.priceDate].join(":");
  const prefix=r.market==="korea" ? "kis_domestic_itemchartprice" : "kis_overseas_dailyprice:"+r.providerExchange;
  if(seen.has(key) || r.source!==prefix+":raw_v2" || r.adjustedCloseSource!==prefix+":adjusted_v1" ||
    r.status!=="ok" || r.adjustedCloseBasis!=="provider_adjusted_close_v1" || r.adjustedCloseProvider!=="kis" ||
    !(Number(r.closePrice)>0) || !(Number(r.adjustedClosePrice)>0) || !r.providerSymbol || !r.providerExchange || !r.adjustedCloseFetchedAt ||
    !(r.fetchedAt instanceof Date) || !Number.isFinite(r.fetchedAt.getTime()) || !Number.isFinite(r.adjustedCloseFetchedAt.getTime()) ||
    r.fetchedAt.getTime()>Date.now() || r.adjustedCloseFetchedAt.getTime()>Date.now() || r.isSample) throw new Error("kis_paired_provenance_invalid");
  seen.add(key);
 }
 const result=await query(KIS_PAIRED_HISTORY_WRITE_SQL,[claim.key,claim.claimToken,JSON.stringify(rows)]);
 const written=Number(result[0]?.written??0),claimed=Number(result[0]?.claimed??0),inserted=Number(result[0]?.inserted??0);
 return {insertedCount:inserted,updatedCount:written-inserted,skippedCount:0,failedCount:claimed?0:rows.length,conflictCount:claimed?rows.length-written:0,results:[]};
}
export const KIS_PAIRED_HISTORY_WRITE_SQL = `
with claim as materialized (
 select key,ticker,market,currency,start_date,end_date from market_collection_jobs
 where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp() for update
), input as (
 select r.* from jsonb_to_recordset($3::jsonb) as r(
 "ticker" text,"market" text,"currency" text,"priceDate" date,"closePrice" numeric,
 "adjustedClosePrice" numeric,"adjustedCloseBasis" text,"adjustedCloseProvider" text,"adjustedCloseSource" text,
 "adjustedCloseFetchedAt" timestamptz,"providerSymbol" text,"providerExchange" text,"fetchedAt" timestamptz,"source" text)
), written as (
 insert into asset_price_snapshots as existing (ticker,market,currency,date,close_price,adjusted_close_price,
 adjusted_close_basis,adjusted_close_provider,adjusted_close_source,adjusted_close_fetched_at,
 provider_symbol,provider_exchange,fetched_at,source,is_sample)
 select i."ticker",i."market",i."currency",i."priceDate",i."closePrice",i."adjustedClosePrice",i."adjustedCloseBasis",
 i."adjustedCloseProvider",i."adjustedCloseSource",i."adjustedCloseFetchedAt",i."providerSymbol",i."providerExchange",i."fetchedAt",i."source",false
 from input i cross join claim c where i.ticker=c.ticker and i.market=c.market and i.currency=c.currency and i."priceDate" between c.start_date and c.end_date
 on conflict(market,currency,ticker,date) do update set
 adjusted_close_price=excluded.adjusted_close_price,adjusted_close_basis=excluded.adjusted_close_basis,
 adjusted_close_provider=excluded.adjusted_close_provider,adjusted_close_source=excluded.adjusted_close_source,
 adjusted_close_fetched_at=excluded.adjusted_close_fetched_at
 where existing.is_sample=false and existing.close_price=excluded.close_price
 and existing.source in (excluded.source,replace(excluded.source,':raw_v2',''))
 and existing.provider_symbol=excluded.provider_symbol and existing.provider_exchange=excluded.provider_exchange
 and (existing.adjusted_close_price is null or (
 existing.adjusted_close_basis=excluded.adjusted_close_basis and existing.adjusted_close_provider=excluded.adjusted_close_provider
 and existing.adjusted_close_source=excluded.adjusted_close_source and existing.adjusted_close_fetched_at<=excluded.adjusted_close_fetched_at))
 returning id,(xmax=0) as inserted
) select (select count(*) from claim)::int claimed,(select count(*) from written)::int written,(select count(*) from written where inserted)::int inserted`;
