import 'server-only';
import { sqlClient } from '@/db/client';
import { writeKisMissingRawCloses } from './kis-missing-raw-write';
import type { MarketDataProvider } from './providers/types';
import type { ClaimedCollectionJob } from './collection-queue';
import { isMarketCollectionClaimCurrent } from './collection-queue';
import { closeCalendarReferenceDateForAsset } from '../snapshots/market-calendar';

/** Only absent raw closes are inserted. Existing/adjusted evidence is preserved. */
export async function syncMissingRawCloses(job: ClaimedCollectionJob,provider: MarketDataProvider){
  if(!job.key.startsWith('kis:history:raw_close_v1:')||!job.startDate||!job.endDate)throw Error('raw_close_job_invalid');
  const dates:string[]=[];
  for(let ms=Date.parse(job.startDate+'T00:00:00Z');ms<=Date.parse(job.endDate+'T00:00:00Z');ms+=86400000){
    const date=new Date(ms).toISOString().slice(0,10),next=new Date(ms+86400000).toISOString().slice(0,10);
    if(closeCalendarReferenceDateForAsset(job,next)===date)dates.push(date);
  }
  const read=()=>sqlClient.query('select date::text from asset_price_snapshots where market=$1 and currency=$2 and ticker=$3 and date=any($4::date[])',[job.market,job.currency,job.ticker,dates]);
  const present=new Set((await read()).map(p=>String(p.date))),missing=dates.filter(d=>!present.has(d));
  if(!missing.length)return {complete:true,insertedCount:0};
  const target={...job,key:job.key,accounts:[],assetIds:[],assetNames:[]};
  const result=await provider.fetchHistoricalClosePrices!([target],{dryRun:false,includeAdjusted:false,requestedAt:new Date(),startDate:missing[0],endDate:missing.at(-1)!});
  if(!await isMarketCollectionClaimCurrent(job))throw Error('raw_close_claim_expired');
  const freshPresent=new Set((await read()).map(p=>String(p.date)));
  result.rows=result.rows.filter(p=>p.ticker===job.ticker&&p.market===job.market&&p.currency===job.currency&&missing.includes(p.priceDate)&&!freshPresent.has(p.priceDate));
  const write=result.rows.length ? await writeKisMissingRawCloses((text,params)=>sqlClient.query(text,params),job,result.rows):null;
  const final=new Set((await read()).map(p=>String(p.date)));
  return {complete:dates.every(d=>final.has(d)),insertedCount:write?.insertedCount??0,
    pendingFinalizationCount:result.pendingFinalizationCount??0};
}
