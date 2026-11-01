import { Decimal } from './money.ts';
import type { TrackedPortfolioEvidence } from './currency-tracked-portfolio.ts';
import type { NativeStoredAccount } from '../db/queries/native-portfolio-ledger.ts';
import type { NativeGroupSelection } from './native-group-scope.ts';

export type ContributionHoldingGuard = { revision: number; assets: NativeStoredAccount['assets'] };

/** Current-only investment scope, with the independently read owned universe as guard. */
export function currentInvestmentEvidence(evidence: TrackedPortfolioEvidence, ledger: { accountsComplete: boolean; accounts: NativeStoredAccount[] }, expected: readonly {id: string; accountId: string | null; currency: string; quantity: string}[], selection?: NativeGroupSelection) {
  const includes = (accountId: string, assetId: string) => !selection || selection.wholeAccountIds.includes(accountId) || selection.directAssetIds.includes(assetId);
  const positions = evidence.current.positions.filter(row => {
    if (row.kind === 'cash') return false;
    // The history adapter may retain sold-out positions. Only a reconciled zero
    // in the owned ledger can be removed from today's investment universe.
    const account = ledger.accounts.find(account => account.id === row.accountId);
    const stored = account?.assets.find(asset => asset.id === row.id);
    try { return !(row.ownerId === evidence.ownerId && stored?.archived && includes(account!.id, stored.id) && Decimal.from(stored.quantity).compare(0) === 0 && row.observation && row.observation.currency === stored.currency && Decimal.from(row.observation.quantity).compare(0) === 0); }
    catch { return true; }
  });
  let complete = false;
  try {
    const owned = ledger.accounts.filter(account => account.active !== false).flatMap(account => account.assets.filter(asset => !asset.archived && includes(account.id, asset.id)).map(asset => ({ ...asset, accountId: account.id })));
    complete = ledger.accountsComplete && owned.length === expected.length && owned.every(asset => expected.some(row => row.id === asset.id && row.accountId === asset.accountId)) && positions.length === expected.length && new Set(positions.map(row => row.id)).size === positions.length &&
      expected.every(asset => {
        const account = ledger.accounts.find(row => row.id === asset.accountId);
        const stored = account?.assets.find(row => row.id === asset.id && !row.archived);
        const row = positions.find(row => row.id === asset.id);
        if (!account || account.active === false || !stored || !row || row.ownerId !== evidence.ownerId || row.accountId && row.accountId !== account.id || stored.currency !== asset.currency || Decimal.from(stored.quantity).compare(asset.quantity) !== 0) return false;
        if (row.observation && (row.observation.currency !== asset.currency || Decimal.from(row.observation.quantity).compare(asset.quantity) !== 0)) return false;
        return !account.state || Date.parse(account.state.at) <= Date.parse(evidence.asOf) && account.state.positions.some(position => position.assetId === asset.id && position.currency === asset.currency && Decimal.from(position.quantity).compare(asset.quantity) === 0);
      });
  } catch { complete = false; }
  return { ...evidence, current: { ...evidence.current, source: 'owned_investments_current_only', positions, scopeComplete: complete }, history: [], trades: null, cashFlows: undefined, realizedTrades: undefined, ledgerComplete: false } satisfies TrackedPortfolioEvidence;
}

/** New-money comparisons need current owned holdings, not a reconstructed cash balance.
 * Reconcile the complete asset universe before valuing it; never omit an unpriced holding. */
export function contributionInvestmentEvidence(evidence: TrackedPortfolioEvidence, ledger: { accountsComplete: boolean; accounts: NativeStoredAccount[] }, accountId: string) {
  try {
    const account = ledger.accounts.find(row => row.id === accountId);
    if (!ledger.accountsComplete || ledger.accounts.length !== 1 || !account || account.active === false) return null;
    const assets = account.assets.filter(asset => !asset.archived);
    if (new Set(assets.map(asset => asset.id)).size !== assets.length) return null;
    if (account.state && (Date.parse(account.state.at) > Date.parse(evidence.asOf) ||
      account.state.positions.some(p => !account.assets.some(a => a.id === p.assetId && a.currency === p.currency && Decimal.from(a.quantity).compare(p.quantity) === 0 && a.archived === (Decimal.from(p.quantity).compare(0) === 0))) ||
      assets.some(a => !account.state!.positions.some(p => p.assetId === a.id && p.currency === a.currency && Decimal.from(p.quantity).compare(a.quantity) === 0)))) return null;
    const rows = evidence.current.positions.filter(row => row.kind !== 'cash');
    if (rows.length !== assets.length || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => row.ownerId !== evidence.ownerId || (row.accountId && row.accountId !== accountId) || !assets.some(asset => asset.id === row.id))) return null;
    const positions = rows.map(row => {
      const asset = assets.find(asset => asset.id === row.id)!;
      if (row.observation && (row.observation.currency !== asset.currency || Decimal.from(row.observation.quantity).compare(asset.quantity) !== 0)) throw new Error('quantity_changed');
      return { ...row, accountId, kind: 'holding' as const };
    });
    return {
      evidence: { ...evidence, current: { ...evidence.current, positions, scopeComplete: true }, history: [], trades: null, cashFlows: undefined, ledgerComplete: false } satisfies TrackedPortfolioEvidence,
      sequences: { [accountId]: account.state?.sequence ?? -1 },
      guard: { revision: account.revision ?? 0, assets: account.assets } satisfies ContributionHoldingGuard,
    };
  } catch { return null; }
}
