import 'server-only';
import { sqlClient } from '@/db/client';
import { enqueueRawCloseCollection } from './collection-queue';
import { drainMarketCollection, scheduleMarketCollection } from './collection-worker';
import { closeIdentity, planCloseGapJobs, type CloseInstrument } from './close-gap-policy';
import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from '../snapshots/market-calendar';

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
  const prices=await sqlClient.query(`select ticker,market,currency,date::text from asset_price_snapshots
    where date between ($1::date-interval '45 days') and $1::date`,[now.toISOString().slice(0,10)]);
  const present=new Set(prices.map(p=>closeIdentity(p as CloseInstrument,String(p.date))));
  const jobs=planCloseGapJobs(targets,present,now);
  for(let i=0;i<jobs.length;i+=40)await enqueueRawCloseCollection(jobs.slice(i,i+40));
  const remaining=Math.min(120000,deadline-Date.now());
  const result=remaining>=5000 ? await drainMarketCollection({partition:{provider:'kis',rawCloses:true},budgetMs:remaining,maximumJobs:40}):{status:'deferred'};
  return {queuedCount:jobs.length,...result};
}
