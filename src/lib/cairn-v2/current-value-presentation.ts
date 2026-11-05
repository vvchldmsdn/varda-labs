import type { CurrencyTrackedInput, CurrencyTrackedResult } from "../currency-tracked-portfolio";
import type { DashboardData, DashboardHolding } from "../portfolio-dashboard";
import type { Currency } from "../money";
import type { BetaView } from "./read-contract";
import type { InvestmentReturn } from "./investment-return";
import { availableHoldingValueKrw } from "../home-metrics.ts";
import { compositionCounts, isManualValuationSource, trackedInvestmentComposition, type CurrentInvestmentComposition, type CurrentCompositionPosition } from "../current-investment-composition.ts";
import { Decimal } from "../money.ts";

type LegacyHolding = Pick<DashboardHolding,"name"|"ticker"|"account"|"market"|"currency"|"quantity"|"currentPrice"|"currentWeight"|"assetType"|"groupName"|"valueKrw"|"priceAsOf"|"priceFetchedAt"|"priceSource">;
export type OriginalCurrentValuePresentation =
  | {kind:"tracked";evidence:CurrencyTrackedInput;reports:Readonly<Record<Currency,CurrencyTrackedResult>>}
  | {kind:"legacy";data:Pick<DashboardData,"generatedAt"|"totalValueKrw"|"usdKrwRate"> & {holdings:LegacyHolding[];investmentReturn?:InvestmentReturn}}
  | {kind:"unavailable"};

/** Select the admitted original-home values. Partial legacy reads expose only
 * their verified subtotal; this layer never admits a price or translates FX. */
export function originalCurrentValueSummary(read: OriginalCurrentValuePresentation, currency: Currency) {
  if(read.kind === "legacy") {
    const composition=originalCurrentComposition(read,"KRW");
    const positions=read.data.holdings.length;
    const valued=composition?.counts.valued ?? 0;
    return {amount:currency === "KRW" && composition?.amount !== null && composition?.amount !== undefined ? Number(composition.amount) : null,asOf:read.data.generatedAt,
      coverage:{positions,valued,excludedPositions:positions-valued},complete:currency === "KRW" && valued === positions};
  }
  if(read.kind === "tracked") {
    const current=read.reports[currency].current;
    return {amount:current && current.coverage.valued > 0 ? current.total ?? current.verifiedSubtotal : null,
      asOf:current?.at ?? null,coverage:current?.coverage ?? null,complete:current?.complete ?? false};
  }
  return {amount:null,asOf:null,coverage:null,complete:false};
}

/** Home, chart and detail share the original current-valuation read. The legacy
 * branch remains KRW-only, exactly like the original home's branch selection. */
export function originalCurrentComposition(read: OriginalCurrentValuePresentation, currency: Currency): CurrentInvestmentComposition | null {
  if(read.kind === "tracked")return trackedInvestmentComposition(read.evidence,read.reports[currency]);
  if(read.kind !== "legacy" || currency !== "KRW")return null;
  const {data}=read;
  let subtotal=Decimal.from(0);
  const occurrences=new Map<string,number>();
  const positions=data.holdings.map(row=>{
    const value=availableHoldingValueKrw(row,data.usdKrwRate);
    if(value!==null)subtotal=subtotal.add(value);
    const identity=JSON.stringify([row.account,row.market,row.currency,row.ticker,row.name]);
    const occurrence=occurrences.get(identity) ?? 0;
    occurrences.set(identity,occurrence+1);
    return {key:occurrence ? JSON.stringify([identity,occurrence]) : identity,name:row.name,ticker:row.ticker,
      market:row.market,account:row.account,currency:row.currency,value:value===null ? null : String(value),
      displayWeightPct:null,portfolioWeightPct:value===null ? null : row.currentWeight,
      reason:value!==null ? null : !(row.currentPrice>0) ? "missing_price" : row.currency==="USD" ? "missing_fx" : "unsupported_currency",
      priceAsOf:row.priceAsOf,priceFetchedAt:row.priceFetchedAt,priceReferenceDate:null,priceTimestampBasis:null,
      source:row.priceSource,manuallyEntered:isManualValuationSource(row.priceSource)} satisfies CurrentCompositionPosition;
  });
  const counts=compositionCounts(positions),complete=counts.excluded===0;
  return {reporting:currency,at:data.generatedAt,amount:counts.valued ? complete ? String(data.totalValueKrw) : subtotal.toExactString() : null,
    complete,weightBasis:complete ? "portfolio" : "verified_subtotal",counts,
    positions:positions.map(row=>({...row,displayWeightPct:row.value===null || subtotal.compare(0)<=0 ? null
      : complete ? row.portfolioWeightPct : Decimal.from(row.value).div(subtotal).mul(100).toNumber()}))};
}

/** Keep the existing value-detail and cost sections. Quotes, FX and values are
 * copied from the original read; partial visual shares use the named subtotal. */
export function originalLegacyValueView(view: BetaView, read: Extract<OriginalCurrentValuePresentation,{kind:"legacy"}>): BetaView {
  if(!view.domain)return view;
  const {data}=read;
  const composition=originalCurrentComposition(read,"KRW")!;
  const visible=data.holdings.flatMap((row,index)=>composition.positions[index].value===null ? [] : [{row,position:composition.positions[index]}]);
  const excluded=data.holdings.filter(row=>availableHoldingValueKrw(row,data.usdKrwRate)===null).map(row=>({
    ...row,groupName:row.groupName ?? "미분류",currentPrice:row.currentPrice > 0 ? row.currentPrice : null,
    reason:!(row.currentPrice > 0) ? "missing_price" as const : row.currency === "USD" ? "missing_fx" as const : "unsupported_currency" as const,
  }));
  return {...view,asOf:data.generatedAt,totalKrw:excluded.length ? null : data.totalValueKrw,fxRate:data.usdKrwRate > 0 ? data.usdKrwRate : null,
    rows:visible.map(({row,position},index)=>({...row,key:position.key,weightPct:position.displayWeightPct ?? row.currentWeight,targetPct:null,priceMove:0,fxMove:0,heatmap:[],
      color:view.rows.find(existing=>existing.key===position.key)?.color ?? ["#ef5a32","#343932","#cca17b","#8c9f89","#697f8c"][index%5]})),
    domain:{...view.domain,excluded,valueState:!data.holdings.length ? "empty" : excluded.length ? "partial" : "ready",
      knownSubtotalKrw:composition.amount===null ? null : Number(composition.amount),refreshedAt:data.generatedAt,valuationBasis:"현재 투자자산 평가 · 원본 조회 근거",
      investmentReturn:data.investmentReturn ?? view.domain.investmentReturn,
      moneyBasis:{...view.domain.moneyBasis,structure:{usdKrwRate:data.usdKrwRate > 0 ? data.usdKrwRate : null,rateDate:null}}}};
}
