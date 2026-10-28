import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from '../snapshots/market-calendar';
import type { CollectionJob } from './collection-policy';

export const CLOSE_GAP_LOOKBACK_DAYS = 35;
export type CloseInstrument = { ticker: string; market: 'korea' | 'us'; currency: 'KRW' | 'USD'; firstCloseDate?:string };
export const closeIdentity = (p: CloseInstrument, date: string) => [p.market,p.currency,p.ticker,date].join('|');
export function expectedCloseDates(target: CloseInstrument, now: Date) {
  const cycle=resolveSnapshotCycle(now), dates=new Set<string>();
  for(let i=0;i<CLOSE_GAP_LOOKBACK_DAYS;i++){
    const date=new Date(Date.parse(cycle.snapshotDate+'T00:00:00Z')-i*86400000).toISOString().slice(0,10);
    dates.add(closeCalendarReferenceDateForAsset(target,date));
  }
  return [...dates].sort();
}
/** Missing provider dates stay missing. Weekends/holidays are never invented. */
export function planCloseGapJobs(targets: readonly CloseInstrument[], present: ReadonlySet<string>, now: Date): CollectionJob[] {
  const jobs=new Map<string,CollectionJob>();
  for(const target of targets){
    if(!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(target.ticker) ||
      !(target.market==='us'&&target.currency==='USD'||target.market==='korea'&&target.currency==='KRW')) continue;
    const dates=expectedCloseDates(target,now).filter(date=>(!target.firstCloseDate||date>=target.firstCloseDate)&&!present.has(closeIdentity(target,date)));
    if(!dates.length)continue;
    const startDate=dates[0],endDate=dates.at(-1)!;
    const key=['kis:history:raw_close_v1',target.market,target.currency,target.ticker,startDate,endDate].join(':');
    jobs.set(key,{...target,key,kind:'history',startDate,endDate});
  }
  return [...jobs.values()];
}
