import 'server-only';
import { sqlClient } from '@/db/client';
import { enqueueRawCloseCollection, enqueueMarketCollection } from './collection-queue';
import { drainMarketCollection, scheduleMarketCollection } from './collection-worker';
import { closeIdentity, planCloseGapJobs, type CloseInstrument } from './close-gap-policy';
import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from '../snapshots/market-calendar';
import { isFinalizedKisPriceEvidence } from '../shared-domain/market-data/kis-history-finalization';

export function scheduleRecentCloseCollection(deadline: number){
  scheduleMarketCollection(()=>runRecentCloseCollection({deadline}));
}
/** Machine authority: derive a shared, deduplicated universe from active accounts.
 * Independent of valuation preflight, account cash, UI visits, and cycle claims.
 * The durable queue retains provider failures for the next scheduled invocation. */
export async function runRecentCloseCollection({now=new Date(),deadline=Date.now()+120000}:{now?:Date;deadline?:number}={}){
  const rows=await sqlClient.query(`select distinct upper(trim(a.ticker)) as ticker,a.market,a.currency
    from assets a join accounts c on c.id=a.account_id and c.canonical_owner_user_id=a.canonical_owner_user_id
    where c.is_active and c.account_type<>'cash' and a.archived_at is null and a.ticker is not null
    and a.asset_type in ('stock','etf','pension','commodity')
    and (a.market='us' and a.currency='USD' or a.market='korea' and a.currency='KRW')`);
  const first=await sqlClient.query(`select ticker,market,currency,min(date)::text as first_date from asset_price_snapshots
    where is_sample=false and close_price>0 and source like 'kis_%' group by ticker,market,currency`);
  const earliest=new Map(first.map(p=>[closeIdentity(p as CloseInstrument,''),String(p.first_date)]));
  // No pre-listing inference: new instruments start at their first known close.
  const targets=(rows as CloseInstrument[]).map(t=>({...t,firstCloseDate:earliest.get(closeIdentity(t,''))??
    closeCalendarReferenceDateForAsset(t,resolveSnapshotCycle(now).snapshotDate)}));
  const prices=await sqlClient.query(`select ticker,market,currency,date::text,close_price,source,is_sample,
    adjusted_close_price,adjusted_close_basis,adjusted_close_provider,adjusted_close_source,adjusted_close_fetched_at,
    provider_symbol,provider_exchange,fetched_at from asset_price_snapshots
    where date between ($1::date-interval '45 days') and $1::date`,[now.toISOString().slice(0,10)]);
  const present=new Set(prices.map(p=>closeIdentity(p as CloseInstrument,String(p.date))));
  const jobs=planCloseGapJobs(targets,present,now);
  for(let i=0;i<jobs.length;i+=40)await enqueueRawCloseCollection(jobs.slice(i,i+40));
  // Research needs the provider-adjusted companion as well as the raw close.
  // A raw row alone must not mark this independent coverage task complete.
  const pairedPresent=new Set(prices.filter(p=>p.is_sample===false && Number(p.close_price)>0 &&
    Number(p.adjusted_close_price)>0 && p.adjusted_close_basis==='provider_adjusted_close_v1' &&
    p.adjusted_close_provider==='kis' && String(p.adjusted_close_source).endsWith(':adjusted_v1') &&
    p.adjusted_close_fetched_at && p.provider_symbol && p.provider_exchange && p.fetched_at &&
    isFinalizedKisPriceEvidence({market:String(p.market),currency:String(p.currency),priceDate:String(p.date)},p.adjusted_close_fetched_at as Date)
  ).map(p=>closeIdentity(p as CloseInstrument,String(p.date))));
  const pairedJobs=planCloseGapJobs(targets,pairedPresent,now).map(job=>({
    kind:'history' as const,ticker:job.ticker,market:job.market,currency:job.currency,
    startDate:job.startDate!,endDate:job.endDate!,
  }));
  for(let i=0;i<pairedJobs.length;i+=40)await enqueueMarketCollection(pairedJobs.slice(i,i+40));
  const remaining=Math.min(120000,deadline-Date.now());
  const result=remaining>=5000 ? await drainMarketCollection({partition:{provider:'kis',historyOnly:true},budgetMs:remaining,maximumJobs:40}):{status:'deferred'};
  return {queuedCount:jobs.length,pairedQueuedCount:pairedJobs.length,...result};
}
