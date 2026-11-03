import type { CurrencyTrackedInput, CurrencyTrackedResult } from "../currency-tracked-portfolio";
import type { DashboardData, DashboardHolding } from "../portfolio-dashboard";
import type { Currency } from "../money";
import type { BetaView } from "./read-contract";
import type { InvestmentReturn } from "./investment-return";
import { availableHoldingValueKrw } from "../home-metrics.ts";

type LegacyHolding = Pick<DashboardHolding,"name"|"ticker"|"account"|"market"|"currency"|"quantity"|"currentPrice"|"currentWeight"|"assetType"|"groupName"|"valueKrw"|"priceAsOf"|"priceFetchedAt"|"priceSource">;
export type OriginalCurrentValuePresentation =
  | {kind:"tracked";evidence:CurrencyTrackedInput;reports:Readonly<Record<Currency,CurrencyTrackedResult>>}
  | {kind:"legacy";data:Pick<DashboardData,"generatedAt"|"totalValueKrw"|"usdKrwRate"> & {holdings:LegacyHolding[];investmentReturn?:InvestmentReturn}}
  | {kind:"unavailable"};

/** Select existing original-home display fields; never calculate or translate a valuation here. */
export function originalCurrentValueSummary(read: OriginalCurrentValuePresentation, currency: Currency) {
  if(read.kind === "legacy") {
    const positions=read.data.holdings.length;
    const valued=read.data.holdings.filter(row=>availableHoldingValueKrw(row,read.data.usdKrwRate)!==null).length;
    return {amount:currency === "KRW" ? read.data.totalValueKrw : null,asOf:read.data.generatedAt,
      coverage:{positions,valued,excludedPositions:positions-valued},complete:currency === "KRW" && valued === positions};
  }
  if(read.kind === "tracked") {
    const current=read.reports[currency].current;
    return {amount:current && current.coverage.valued > 0 ? current.total ?? current.verifiedSubtotal : null,
      asOf:current?.at ?? null,coverage:current?.coverage ?? null,complete:current?.complete ?? false};
  }
  return {amount:null,asOf:null,coverage:null,complete:false};
}

/** Keep the existing value-detail composition and cost sections. All numeric
 * fields below are copied from the original read; no quote/FX/weight recalculation. */
export function originalLegacyValueView(view: BetaView, read: Extract<OriginalCurrentValuePresentation,{kind:"legacy"}>): BetaView {
  if(!view.domain)return view;
  const {data}=read;
  const key=(row:LegacyHolding)=>JSON.stringify([row.account,row.market,row.currency,row.ticker,row.name]);
  const visible=data.holdings.filter(row=>availableHoldingValueKrw(row,data.usdKrwRate)!==null);
  const excluded=data.holdings.filter(row=>availableHoldingValueKrw(row,data.usdKrwRate)===null).map(row=>({
    ...row,groupName:row.groupName ?? "미분류",currentPrice:row.currentPrice > 0 ? row.currentPrice : null,
    reason:!(row.currentPrice > 0) ? "missing_price" as const : row.currency === "USD" ? "missing_fx" as const : "unsupported_currency" as const,
  }));
  return {...view,asOf:data.generatedAt,totalKrw:excluded.length ? null : data.totalValueKrw,fxRate:data.usdKrwRate > 0 ? data.usdKrwRate : null,
    rows:visible.map((row,index)=>({...row,key:key(row),weightPct:row.currentWeight,targetPct:null,priceMove:0,fxMove:0,heatmap:[],
      color:view.rows.find(existing=>existing.key===key(row))?.color ?? ["#ef5a32","#343932","#cca17b","#8c9f89","#697f8c"][index%5]})),
    domain:{...view.domain,excluded,valueState:!data.holdings.length ? "empty" : excluded.length ? "partial" : "ready",
      knownSubtotalKrw:data.totalValueKrw,refreshedAt:data.generatedAt,valuationBasis:"현재 투자자산 평가 · 원본 조회 근거",
      investmentReturn:data.investmentReturn ?? view.domain.investmentReturn,
      moneyBasis:{...view.domain.moneyBasis,structure:{usdKrwRate:data.usdKrwRate > 0 ? data.usdKrwRate : null,rateDate:null}}}};
}
