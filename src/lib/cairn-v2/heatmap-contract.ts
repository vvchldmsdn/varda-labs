import type {PortfolioDashboardHoldingHistory} from './heatmap-model';
// Type-only public price-evidence contract from the original UI. No new price-return engine.
export type HoldingPriceReturn=Readonly<{changePct:number|null;currentPrice:number|null;previousClose:number|null;previousCloseDate:string|null;currency:string;observedAt:string|null;reason:'missing_current_quote'|'missing_previous_close'|'conflicting_previous_close'|null}>;
export type BetaHeatmapRead={state:'ready'|'partial'|'empty'|'unavailable';history:PortfolioDashboardHoldingHistory|null;scopeKey:string;currencyBasis:'KRW';currentDate:string|null;message:string};
export function unavailableHeatmap(scopeKey:string):BetaHeatmapRead{return{state:'unavailable',history:null,scopeKey,currencyBasis:'KRW',currentDate:null,message:'종목 흐름 조회 불가 · 저장 이력을 읽지 못했습니다. 새로고침해 주세요.'};}
export function adaptHeatmap(history:PortfolioDashboardHoldingHistory,scopeKey:string,currentDate:string|null=null):BetaHeatmapRead{
 // Explicit projection: do not pass SQL rows, owner IDs, recovery manifests or transport evidence.
 const safe={dates:[...history.dates],rows:history.rows.map(row=>({holdingId:row.holdingId,name:row.name,ticker:row.ticker,account:row.account,currentWeight:row.currentWeight,cells:row.cells.map(cell=>({date:cell.date,changePct:cell.changePct,marketValueKrw:cell.marketValueKrw,changeKrw:cell.changeKrw,priceChangeKrw:cell.priceChangeKrw,fxChangeKrw:cell.fxChangeKrw,basis:cell.basis}))})),observedCellCount:history.observedCellCount,expectedCellCount:history.expectedCellCount,coveragePct:history.coveragePct};
 const empty=!safe.rows.length;const partial=safe.observedCellCount<safe.expectedCellCount;
 return{state:empty?'empty':partial?'partial':'ready',history:safe,scopeKey,currencyBasis:'KRW',currentDate,message:empty?'조회 범위의 현재 보유 종목이 없습니다':partial?'비교 가능한 관측만 표시 · 회색 빗금은 비교 불가':'확인된 종목별 관측 · 저장 기록과 현재 평가를 구분'};
}
