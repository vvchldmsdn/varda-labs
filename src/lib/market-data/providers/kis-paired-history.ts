import type { ClosePrice } from "./types";

/** Two independent requests; never derive adjusted values from a raw series. */
export function pairKisHistory(raw: readonly ClosePrice[], adjusted: readonly ClosePrice[]): ClosePrice[] {
  const key = (r: ClosePrice) => [r.market,r.currency,r.ticker,r.priceDate].join(":");
  const pairs = new Map(adjusted.map(r=>[key(r),r]));
  if (pairs.size !== adjusted.length) throw new Error("kis_adjusted_duplicate_date");
  return raw.map(row=>{
    const a=pairs.get(key(row));
    if (!a || a.providerSymbol!==row.providerSymbol || a.providerExchange!==row.providerExchange || a.status!=="ok" || !(Number(a.closePrice)>0)) throw new Error("kis_adjusted_pair_missing");
    return {...row,source:row.source+":raw_v2",adjustedClosePrice:a.closePrice,
      adjustedCloseBasis:"provider_adjusted_close_v1",adjustedCloseProvider:"kis",
      adjustedCloseSource:row.source+":adjusted_v1",adjustedCloseFetchedAt:a.fetchedAt};
  });
}

export function mergeKisPairedHistory(series: readonly (readonly ClosePrice[])[]): ClosePrice[] {
 const rows=new Map<string,ClosePrice>();
 for(const row of series.flat()) {
  const key=[row.market,row.currency,row.ticker,row.priceDate].join(":");
  const old=rows.get(key);
  if(old && (old.closePrice!==row.closePrice || old.adjustedClosePrice!==row.adjustedClosePrice || old.source!==row.source || old.providerExchange!==row.providerExchange)) throw new Error("kis_paired_conflicting_duplicate");
  rows.set(key,row);
 }
 return [...rows.values()].sort((a,b)=>a.priceDate.localeCompare(b.priceDate)||a.ticker.localeCompare(b.ticker));
}
