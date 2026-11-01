import { shiftRiskDate } from './portfolio-risk-calendar';
import { closeCalendarReferenceDateForAsset } from './snapshots/market-calendar';
export function holdingHistoryRequest(target: { ticker: string; market: string; currency: string }, serviceDate: string) {
  const endDate = closeCalendarReferenceDateForAsset(target, serviceDate);
  return { kind: 'history' as const, ...target, startDate: shiftRiskDate(endDate, -399), endDate };
}
export type HoldingCollectionProgress = {
  state: 'none' | 'pending' | 'running' | 'failed' | 'blocked' | 'done' | 'unavailable';
  completed: number; total: number;
};
export function collectionProgress(states: readonly string[], total: number): HoldingCollectionProgress {
  return { state: states.includes('running') ? 'running' : states.includes('pending') ? 'pending' : states.includes('blocked') ? 'blocked' : states.includes('failed') ? 'failed' : states.length === total && total > 0 && states.every(state => state === 'done') ? 'done' : 'none', completed: states.filter(state => state === 'done').length, total };
}
