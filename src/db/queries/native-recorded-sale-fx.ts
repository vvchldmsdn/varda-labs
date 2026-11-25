import "server-only";
import { sqlClient } from "@/db/client";
import type { FxEvidence } from "@/lib/currency-valuation";
import type { TrackedRealizedTrade } from "@/lib/currency-tracked-portfolio";
import { getTwelveDataServerConfig, readTwelveDataHistoricalFx } from "@/lib/market-data/twelve-data-service";

/** Historical references admitted for the sale and its original purchases.
 * Opening a detail panel only reads observations already held by the service. */
export async function readRecordedSaleFx(sales:readonly TrackedRealizedTrade[], asOf:string):Promise<FxEvidence[]> {
  const dates = new Set<string>(), instants = new Set<string>();
  for (const sale of sales) {
    if (!sale.proceeds) continue;
    for (const leg of [{at:sale.at,dateEvidence:sale.dateEvidence}, ...(sale.disposedCostLots ?? [])]) {
      if (!Number.isFinite(Date.parse(leg.at)) || Date.parse(leg.at)>Date.parse(asOf)) continue;
      dates.add(leg.at);
      if (!leg.dateEvidence) instants.add(leg.at);
    }
  }
  if (!dates.size) return [];
  const times = [...dates].map(Date.parse).sort((a,b)=>a-b);
  const start = new Date(times[0]-3*86_400_000).toISOString(), end = new Date(times[times.length-1]).toISOString();
  const config = getTwelveDataServerConfig();
  const [daily, cached] = await Promise.all([
    sqlClient.query(`select usdkrw::text as rate, observed_at::text as "observedAt", fetched_at::text as "fetchedAt", source
      from fx_rates where not is_sample and status='ok' and rate_kind='daily_reference' and observed_at between $1::timestamptz and $2::timestamptz
      and fetched_at <= $3::timestamptz order by observed_at,fetched_at limit 5001`,[start,end,asOf]),
    config?.provider.audience === "member_display" && instants.size
      ? readTwelveDataHistoricalFx({requestedAt:[...instants].sort().slice(0,1000),asOf,knownAt:asOf}, config) : null,
  ]);
  if (daily.length>5000) throw new Error("recorded_sale_fx_scope_too_large");
  return [...daily.map((row):FxEvidence=>({base:"USD",quote:"KRW",rate:String(row.rate),observedAt:String(row.observedAt),
    fetchedAt:String(row.fetchedAt),source:String(row.source??""),kind:"daily_reference"})),
    ...(cached?.fx ?? []).map((row):FxEvidence=>({base:row.baseCurrency,quote:row.quoteCurrency,rate:row.rate,observedAt:row.observedAt,
      fetchedAt:row.fetchedAt,source:row.source,kind:row.kind,requestedAt:row.requestedAt}))];
}
