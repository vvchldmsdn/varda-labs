import type {PortfolioDashboardHoldingHistory} from './heatmap-model';
import { percentOrNull } from "../portfolio-math.ts";
import { valuationDateForCutoff } from "./history-date";
import type { ReviewedCurrentMovement } from "./reviewed-current-movement";
import { reviewedHoldingMovement, reviewedPositionKey, type ReviewedHistoryPosition } from "./reviewed-history-positions";
import { withinReview, withinReviewedValuationDates, type AccountHistoryReview } from "./reviewed-history-series";
// Type-only public price-evidence contract from the original UI. No new price-return engine.
export type HoldingPriceReturn=Readonly<{changePct:number|null;currentPrice:number|null;previousClose:number|null;previousCloseDate:string|null;currency:string;observedAt:string|null;reason:'missing_current_quote'|'missing_previous_close'|'conflicting_previous_close'|null}>;
export type BetaHeatmapRead={state:'ready'|'partial'|'empty'|'unavailable';history:PortfolioDashboardHoldingHistory|null;scopeKey:string;currencyBasis:'KRW';currentDate:string|null;message:string};
export type ReviewedDailyImpact = {date:string;value:number|null;price:number|null;fx:number|null};
export function unavailableHeatmap(scopeKey:string):BetaHeatmapRead{return{state:'unavailable',history:null,scopeKey,currencyBasis:'KRW',currentDate:null,message:'종목 흐름 조회 불가 · 저장 이력을 읽지 못했습니다. 새로고침해 주세요.'};}
export function adaptHeatmap(history:PortfolioDashboardHoldingHistory,scopeKey:string,currentDate:string|null=null):BetaHeatmapRead{
 // Explicit projection: do not pass SQL rows, owner IDs, recovery manifests or transport evidence.
 const safe={dates:[...history.dates],rows:history.rows.map(row=>({holdingId:row.holdingId,name:row.name,ticker:row.ticker,market:row.market,account:row.account,currentWeight:row.currentWeight,cells:row.cells.map(cell=>({date:cell.date,changePct:cell.changePct,marketValueKrw:cell.marketValueKrw,changeKrw:cell.changeKrw,priceChangeKrw:cell.priceChangeKrw,fxChangeKrw:cell.fxChangeKrw,basis:cell.basis}))})),observedCellCount:history.observedCellCount,expectedCellCount:history.expectedCellCount,coveragePct:history.coveragePct};
 const empty=!safe.rows.length;const partial=safe.observedCellCount<safe.expectedCellCount;
 return{state:empty?'empty':partial?'partial':'ready',history:safe,scopeKey,currencyBasis:'KRW',currentDate,message:empty?'조회 범위의 현재 보유 종목이 없습니다':partial?'비교 가능한 관측만 표시 · 회색 빗금은 비교 불가':'확인된 종목별 관측 · 저장 기록과 현재 평가를 구분'};
}

function applyReviewedHeatmap(read: BetaHeatmapRead, review: AccountHistoryReview | null | undefined,
  days: ReturnType<typeof reviewedDays>, movement: ReviewedCurrentMovement | null | undefined): BetaHeatmapRead {
  const history = read.history;
  if (!review || !history?.rows.length) return read;
  const points = new Map(days.map(day => [day.date,day]));
  const lastReview = review.points.at(-1);
  const reviewStart = valuationDateForCutoff(review.startDate);
  const latestDate = [history.dates.at(-1) ?? "", lastReview ? valuationDateForCutoff(lastReview.date) : "", read.currentDate ?? ""].sort().at(-1)!;
  const firstDate = new Date(Date.parse(latestDate) - 30 * 86_400_000).toISOString().slice(0, 10);
  const dates = Array.from({length:31}, (_, index) => new Date(Date.parse(firstDate) + index * 86_400_000).toISOString().slice(0,10))
    .filter(date => date >= (history.dates[0] && history.dates[0] < reviewStart ? history.dates[0] : reviewStart));
  const tickers = new Set(review.excludedTickers);
  const labels = new Set(review.excludedLabels.map(label => label.trim().normalize("NFC")));
  const currentDate = read.currentDate && withinReviewedValuationDates(review, read.currentDate) ? null : read.currentDate;
  const holdings = history.rows.filter(row => !tickers.has(row.ticker ?? "") && !labels.has(row.name.trim().normalize("NFC")))
    .map(row => ({ row, key: row.ticker || row.name.trim() === "금현물"
      ? reviewedPositionKey(row.ticker?.trim().toUpperCase() ?? null, row.market ?? "", row.market === "us" ? "USD" : "KRW")
      : null }));
  const liveRows = movement?.cutoffDate === currentDate ? new Map(movement.rows.map(row => [row.key,row])) : undefined;
  const rows = holdings.map(({row,key}) => {
    const cells = new Map(row.cells.map(cell => [cell.date, cell]));
    const live = liveRows && key && holdings.filter(holding => holding.key === key).length === 1 ? liveRows.get(key) : undefined;
    return {...row,cells: dates.map(date => {
      if (date === currentDate && live && live.account === row.account) {
        return {date, changePct:live.returnPct, marketValueKrw:live.currentValueKrw, changeKrw:live.changeKrw,
          priceChangeKrw:live.priceChangeKrw, fxChangeKrw:live.fxChangeKrw,
          basis:live.returnPct === null ? "missing" as const : "live_movement" as const};
      }
      if (!withinReviewedValuationDates(review,date)) return cells.get(date) ?? reviewedHeatmapCell(date);
      const point = points.get(date);
      return key && point
        ? reviewedHeatmapCell(date, point.current.get(key), point.previous?.get(key), point.impacts.get(key))
        : reviewedHeatmapCell(date);
    })};
  });
  const expectedCellCount = rows.length * dates.length;
  const observedCellCount = rows.reduce((sum, row) => sum + row.cells.filter(cell => cell.changePct !== null).length, 0);
  return adaptHeatmap({dates,rows,expectedCellCount,observedCellCount,coveragePct:percentOrNull(observedCellCount,expectedCellCount)}, read.scopeKey, currentDate);
}

function reviewedHeatmapCell(date: string, current?: ReviewedHistoryPosition, previous?: ReviewedHistoryPosition,
  impact?: {priceKrw:number;fxKrw:number}) {
  const changePct = current && previous
    ? percentOrNull(current.price * current.fxRate - previous.price * previous.fxRate, previous.price * previous.fxRate)
    : null;
  return {
    date, changePct, marketValueKrw: current?.valueKrw ?? null,
    changeKrw: current && previous ? current.valueKrw - previous.valueKrw : null,
    priceChangeKrw: impact?.priceKrw ?? null,
    fxChangeKrw: impact?.fxKrw ?? null,
    basis: changePct === null ? "missing" as const : "unit_value" as const,
  };
}

export function projectReviewedHeatmap(read: BetaHeatmapRead, review: AccountHistoryReview | null | undefined, movement?: ReviewedCurrentMovement | null) {
  const days = review ? reviewedDays(review) : [];
  const impacts: ReviewedDailyImpact[] = days.map(day => ({
    date:day.date, value:day.value,
    price:day.complete ? [...day.impacts.values()].reduce((sum, impact) => sum + impact.priceKrw, 0) : null,
    fx:day.complete ? [...day.impacts.values()].reduce((sum, impact) => sum + impact.fxKrw, 0) : null,
  }));
  return {heatmap:applyReviewedHeatmap(read, review, days, movement), impacts};
}

function reviewedDays(review: AccountHistoryReview) {
  const selected = review.points.filter(point => withinReview(review, point.date));
  const roster = (positions: ReviewedHistoryPosition[]) => new Map(positions.map(position => [position.key,position]));
  return selected.flatMap((point,index) => {
    if (!point.positions) return [];
    const prior = selected[index - 1];
    const current = roster(point.positions);
    const previous = prior?.positions && Date.parse(point.date) - Date.parse(prior.date) === 86_400_000 ? roster(prior.positions) : null;
    const impacts = new Map<string,{priceKrw:number;fxKrw:number}>();
    let complete = Boolean(previous && point.trades);
    if (previous && point.trades) {
      for (const key of new Set([...previous.keys(), ...current.keys(), ...point.trades.map(trade => trade.key)])) {
        const impact = reviewedHoldingMovement(previous.get(key), current.get(key), point.trades.filter(trade => trade.key === key));
        if (typeof impact === "string") complete = false;
        else impacts.set(key,impact);
      }
    }
    return [{date:valuationDateForCutoff(point.date),value:point.valueKrw,current,previous,impacts,complete}];
  });
}
