import type { BetaContext } from './navigation';
import type { BetaHistoryRead, DomainRead } from './read-contract';

export const HISTORY_BINDING_HEADER = 'X-Cairn-Display-Binding';
export type HomeHistoryRead = {
  scope: string; currency: BetaContext['currency']; displayBinding: string;
  readReceipt: string; readEpoch?: string; history: BetaHistoryRead;
};
export function homeHistoryRequest(context: BetaContext, read?: DomainRead) {
  const query = new URLSearchParams({ scope: context.scope, currency: context.currency });
  if (read?.readEpoch) query.set('_betaRead', read.readEpoch);
  return '/beta/api/history/full?' + query;
}
export function homeHistoryGeneration(context: BetaContext, read?: DomainRead) {
  return JSON.stringify([homeHistoryRequest(context, read), read?.displayBinding, read?.readReceipt]);
}
export function matchesHomeHistory(result: HomeHistoryRead, context: BetaContext, read: DomainRead) {
  return result.scope === context.scope && result.history.selectedScope.key === context.scope &&
    result.currency === context.currency && !!result.readReceipt &&
    result.displayBinding === read.displayBinding && result.readEpoch === read.readEpoch;
}
