import type { ClosePrice } from "./providers/types";
import { isFinalizedKisHistoryDate } from "./kis-history-revision-policy";
import type { KisHistoryClaim } from "./kis-paired-history-write";

type Query = (query: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/** The claim and insert share one statement. A row created after the caller's
 * coverage check wins, including a manual override; this writer never updates it. */
export async function writeKisMissingRawCloses(query: Query, claim: KisHistoryClaim, rows: readonly ClosePrice[]) {
  if (!claim.key.startsWith("kis:history:raw_close_v1:") || !/^[a-f0-9-]{36}$/i.test(claim.claimToken) || rows.length < 1 || rows.length > 100) {
    throw new Error("kis_missing_raw_boundary");
  }
  const seen = new Set<string>();
  for (const row of rows) {
    const key = [row.market, row.currency, row.ticker, row.priceDate].join(":");
    const prefix = row.market === "korea" ? "kis_domestic_itemchartprice" : `kis_overseas_dailyprice:${row.providerExchange}`;
    if (seen.has(key) || row.source !== `${prefix}:raw_v2` || row.status !== "ok" || row.isSample ||
      !Number.isFinite(Number(row.closePrice)) || Number(row.closePrice) <= 0 || !row.providerSymbol || !row.providerExchange ||
      !(row.fetchedAt instanceof Date) || row.fetchedAt.getTime() > Date.now() || !isFinalizedKisHistoryDate(row)) {
      throw new Error("kis_missing_raw_provenance_invalid");
    }
    seen.add(key);
  }
  const [result] = await query(KIS_MISSING_RAW_WRITE_SQL, [claim.key, claim.claimToken, JSON.stringify(rows)]);
  if (!Number(result?.claimed)) throw new Error("raw_close_claim_expired");
  return { insertedCount: Number(result?.written ?? 0) };
}

export const KIS_MISSING_RAW_WRITE_SQL = `
with claim as materialized (
 select ticker,market,currency,start_date,end_date from market_collection_jobs
 where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp() for update
), input as materialized (
 select * from jsonb_to_recordset($3::jsonb) as r(
 "ticker" text,"market" text,"currency" text,"priceDate" date,"closePrice" numeric,
 "source" text,"providerSymbol" text,"providerExchange" text,"fetchedAt" timestamptz)
), written as (
 insert into asset_price_snapshots(ticker,market,currency,date,close_price,source,provider_symbol,provider_exchange,fetched_at,is_sample)
 select i.ticker,i.market,i.currency,i."priceDate",i."closePrice",i.source,i."providerSymbol",i."providerExchange",i."fetchedAt",false
 from input i cross join claim c where i.ticker=c.ticker and i.market=c.market and i.currency=c.currency
 and i."priceDate" between c.start_date and c.end_date
 on conflict(market,currency,ticker,date) do nothing returning *
), evidence as (
 insert into market_data_sync_runs(job_type,mode,status,started_at,finished_at,source,requested_count,success_count,metadata_json)
 select 'kis_missing_raw_close_insert','history','completed',clock_timestamp(),clock_timestamp(),'kis',count(*),count(*),
 jsonb_build_object('policy','kis_missing_raw_insert_only_v1','claimKey',$1::text,'inserted',jsonb_agg(to_jsonb(w)))
 from written w having count(*)>0 returning id
)
select (select count(*) from claim)::int claimed,(select count(*) from written)::int written,(select count(*) from evidence)::int audits`;
