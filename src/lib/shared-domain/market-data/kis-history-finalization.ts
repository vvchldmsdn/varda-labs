import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from "../snapshots/market-calendar.ts";
type Instrument = {market:string;currency:string};
const newYorkDate = new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"});
/** KIS dailyprice has no final flag and its current US-date clos can still move
 * after regular hours. Admit an US daily bar only after that local date ends.
 * This is a conservative evidence boundary, not a market-return assumption. */
export function latestFinalizedKisPriceDate(instrument:Instrument, receipt:Date) {
 if(!Number.isFinite(receipt.getTime()))return null;
 const serviceDate=instrument.market.toLowerCase()==="us"
  ?newYorkDate.format(receipt):resolveSnapshotCycle(receipt).snapshotDate;
 return closeCalendarReferenceDateForAsset(instrument,serviceDate);
}
export function isFinalizedKisPriceEvidence(row:Instrument & {priceDate:string},receipt:Date|string|null|undefined) {
 const time=receipt instanceof Date?receipt:new Date(receipt??"");
 const limit=latestFinalizedKisPriceDate(row,time);
 return !!limit && /^\d{4}-\d{2}-\d{2}$/.test(row.priceDate) && row.priceDate<=limit;
}
export type SimulationPriceFrontier=Readonly<{
 status:"verified"|"provider_pending";usTradeDate:string|null;serviceDate:string;
 pendingUsTradeDate:string|null;reason:"provider_daily_bar_unfinalized"|null;
 policy:"kis_completed_local_day_v1";
}>;
export function simulationPriceFrontier(input:{endServiceDate:string|null;hasUs:boolean;isLatest:boolean;now:Date}):SimulationPriceFrontier|null{
 if(!input.endServiceDate)return null;
 const target={market:"us",currency:"USD"};
 const usTradeDate=input.hasUs?closeCalendarReferenceDateForAsset(target,input.endServiceDate):null;
 const requested=closeCalendarReferenceDateForAsset(target,resolveSnapshotCycle(input.now).snapshotDate);
 const final=latestFinalizedKisPriceDate(target,input.now);
 const pending=Boolean(input.hasUs&&input.isLatest&&usTradeDate&&requested>usTradeDate&&final&&requested>final);
 return {status:pending?"provider_pending":"verified",usTradeDate,serviceDate:input.endServiceDate,
 pendingUsTradeDate:pending?requested:null,reason:pending?"provider_daily_bar_unfinalized":null,policy:"kis_completed_local_day_v1"};
}


