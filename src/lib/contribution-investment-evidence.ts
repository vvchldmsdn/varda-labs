import { Decimal } from './money.ts';
import type { TrackedPortfolioEvidence } from './currency-tracked-portfolio.ts';
import type { NativeStoredAccount } from '../db/queries/native-portfolio-ledger.ts';

export type ContributionHoldingGuard = { revision: number; assets: NativeStoredAccount['assets'] };

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
